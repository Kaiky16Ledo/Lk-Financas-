import { Router, Request, Response, CookieOptions } from 'express';
import crypto from 'node:crypto';
import { addAuditLog, runInTransaction, UserRecord, users } from '../db/database';
import {
  generateRecoveryKey,
  hashSecret,
  normalizeRecoveryKey,
  unwrapDek,
  verifySecret,
  wrapDek,
} from '../crypto/envelope';
import {
  authRateLimiter,
  createSession,
  destroyAllUserSessions,
  destroySession,
  lockSessionPin,
  requireAuth,
  requireRole,
  requireUnlockedVault,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSessionToken,
  unlockSessionPin,
} from '../middlewares/security';

const router = Router();

const MAX_PASSWORD_ATTEMPTS = 5;
const MAX_PIN_ATTEMPTS = 3;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 10;

// Hash fictício usado quando o e-mail não existe, para que a resposta demore o mesmo tempo
// e não revele quais e-mails estão cadastrados (proteção contra enumeração de usuários).
const DUMMY_HASH = hashSecret(crypto.randomBytes(16).toString('hex'));

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

function clearSessionCookie(res: Response): void {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(SESSION_COOKIE, opts);
}

/** IP real do cliente. Com `trust proxy` configurado, o Express já resolve o X-Forwarded-For com segurança. */
function getClientMeta(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'Unknown Device',
  };
}

function publicUser(user: UserRecord, pinLocked: boolean) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    fontSizePref: user.font_size_pref,
    themePref: user.theme_pref,
    recoveryKeyHint: user.recovery_key_hint,
    pinLocked,
  };
}

/**
 * POST /api/auth/login
 * Autentica Titular ou Suporte. Para o Titular, desencapsula a DEK com a senha.
 */
router.post('/login', authRateLimiter, (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const { ipAddress, userAgent } = getClientMeta(req);

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Informe seu e-mail e sua senha.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = users.byEmail(normalizedEmail);

  if (!user) {
    verifySecret(password, DUMMY_HASH);
    addAuditLog({
      userId: null,
      actorRole: 'ANONYMOUS',
      action: 'LOGIN_FAILED_UNKNOWN_USER',
      details: `Tentativa de login com e-mail não cadastrado: ${normalizedEmail.slice(0, 80)}`,
      ipAddress,
      userAgent,
    });
    res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    return;
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    res.status(423).json({
      error: `Conta temporariamente protegida após várias tentativas incorretas. Aguarde ${minutesLeft} min ou peça desbloqueio ao Suporte.`,
      accountLocked: true,
    });
    return;
  }

  if (!verifySecret(password, user.password_hash)) {
    const attempts = user.failed_login_attempts + 1;
    const locked = attempts >= MAX_PASSWORD_ATTEMPTS;
    users.update(user.id, {
      failed_login_attempts: attempts,
      locked_until: locked ? new Date(Date.now() + LOCKOUT_MS).toISOString() : user.locked_until,
    });
    addAuditLog({
      userId: user.id,
      actorRole: user.role,
      action: locked ? 'ACCOUNT_LOCKED_BRUTE_FORCE' : 'LOGIN_FAILED_BAD_PASSWORD',
      details: locked
        ? `Conta bloqueada por 15 min após ${MAX_PASSWORD_ATTEMPTS} erros de senha.`
        : `Senha incorreta (tentativa ${attempts}/${MAX_PASSWORD_ATTEMPTS}).`,
      ipAddress,
      userAgent,
    });

    const remaining = Math.max(0, MAX_PASSWORD_ATTEMPTS - attempts);
    res.status(401).json({
      error:
        remaining > 0
          ? `E-mail ou senha incorretos. Restam ${remaining} tentativa(s) antes do bloqueio de segurança.`
          : 'Conta bloqueada por segurança por 15 minutos. O Suporte pode destravar antes.',
    });
    return;
  }

  let dekHex: string | null = null;
  if (user.role === 'TITULAR') {
    if (!user.wrapped_dek_password) {
      res.status(500).json({ error: 'Cofre criptográfico não inicializado para o titular.' });
      return;
    }
    try {
      dekHex = unwrapDek(user.wrapped_dek_password, password);
    } catch {
      res.status(500).json({ error: 'Falha ao abrir o cofre criptográfico.' });
      return;
    }
  }

  users.update(user.id, { failed_login_attempts: 0, failed_pin_attempts: 0, locked_until: null });

  const sessionId = crypto.randomUUID();
  createSession({ sessionId, userId: user.id, role: user.role, dekHex });

  const token = signSessionToken({
    sessionId,
    userId: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions());

  addAuditLog({
    userId: user.id,
    actorRole: user.role,
    action: 'LOGIN_SUCCESS',
    details: `Acesso realizado com sucesso (${user.role}).`,
    ipAddress,
    userAgent,
  });

  res.json({ user: publicUser(user, false) });
});

/** GET /api/auth/me — estado da sessão atual. */
router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = users.byId(req.userSession!.userId);
  if (!user) {
    res.status(401).json({ error: 'Usuário não encontrado.' });
    return;
  }
  res.json({ user: publicUser(user, Boolean(req.vault?.pinLocked)) });
});

/** POST /api/auth/lock-pin — trava a tela e remove a DEK da memória. */
router.post('/lock-pin', requireAuth, requireRole('TITULAR'), (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getClientMeta(req);
  lockSessionPin(req.userSession!.sessionId);
  addAuditLog({
    userId: req.userSession!.userId,
    actorRole: 'TITULAR',
    action: 'SESSION_PIN_LOCKED',
    details: 'Tela bloqueada com PIN (chave removida da memória).',
    ipAddress,
    userAgent,
  });
  res.json({ pinLocked: true });
});

/** POST /api/auth/unlock-pin — 3 erros encerram a sessão e exigem a senha completa. */
router.post('/unlock-pin', authRateLimiter, requireAuth, requireRole('TITULAR'), (req: Request, res: Response) => {
  const { pin } = req.body as { pin?: string };
  const { ipAddress, userAgent } = getClientMeta(req);

  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin.trim())) {
    res.status(400).json({ error: 'Digite seu PIN de 4 a 6 dígitos.' });
    return;
  }

  const user = users.byId(req.userSession!.userId);
  if (!user || !user.pin_hash || !user.wrapped_dek_pin) {
    res.status(400).json({ error: 'PIN não configurado. Faça login com sua senha principal.' });
    return;
  }

  if (!verifySecret(pin.trim(), user.pin_hash)) {
    const attempts = user.failed_pin_attempts + 1;

    if (attempts >= MAX_PIN_ATTEMPTS) {
      users.update(user.id, { failed_pin_attempts: 0 });
      destroySession(req.userSession!.sessionId);
      clearSessionCookie(res);
      addAuditLog({
        userId: user.id,
        actorRole: 'TITULAR',
        action: 'PIN_LOCKOUT_SESSION_TERMINATED',
        details: `Sessão encerrada após ${MAX_PIN_ATTEMPTS} PINs incorretos.`,
        ipAddress,
        userAgent,
      });
      res.status(401).json({
        error: `${MAX_PIN_ATTEMPTS} tentativas incorretas de PIN. Por segurança, entre novamente com sua senha.`,
        forceRelogin: true,
      });
      return;
    }

    users.update(user.id, { failed_pin_attempts: attempts });
    const attemptsLeft = MAX_PIN_ATTEMPTS - attempts;
    addAuditLog({
      userId: user.id,
      actorRole: 'TITULAR',
      action: 'PIN_UNLOCK_FAILED',
      details: `PIN incorreto (${attemptsLeft} tentativa(s) restante(s)).`,
      ipAddress,
      userAgent,
    });
    res.status(401).json({
      error: `PIN incorreto. Restam ${attemptsLeft} tentativa(s) antes de exigir a senha completa.`,
      attemptsLeft,
    });
    return;
  }

  try {
    const dekHex = unwrapDek(user.wrapped_dek_pin, pin.trim());
    users.update(user.id, { failed_pin_attempts: 0 });
    unlockSessionPin(req.userSession!.sessionId, dekHex);
    addAuditLog({
      userId: user.id,
      actorRole: 'TITULAR',
      action: 'PIN_UNLOCK_SUCCESS',
      details: 'Tela desbloqueada via PIN.',
      ipAddress,
      userAgent,
    });
    res.json({ pinLocked: false });
  } catch {
    res.status(500).json({ error: 'Erro ao abrir o cofre com o PIN. Faça login com sua senha.' });
  }
});

/**
 * GET /api/auth/recovery-status
 * Informa apenas se a recuperação está liberada. Não expõe e-mail nem dica da chave
 * (a tela de login é pública).
 */
router.get('/recovery-status', authRateLimiter, (_req: Request, res: Response) => {
  const titular = users.titular();
  res.json({ resetAuthorizedBySupport: Boolean(titular?.reset_authorized_by_support) });
});

/**
 * POST /api/auth/recover-password
 * Recuperação em 2 fatores: autorização do Suporte + Chave de Emergência do Titular.
 */
router.post('/recover-password', authRateLimiter, (req: Request, res: Response) => {
  const { recoveryKey, newPassword, newPin } = req.body as {
    recoveryKey?: string;
    newPassword?: string;
    newPin?: string;
  };
  const { ipAddress, userAgent } = getClientMeta(req);

  if (typeof recoveryKey !== 'string' || typeof newPassword !== 'string' || typeof newPin !== 'string') {
    res.status(400).json({ error: 'Informe a Chave de Emergência, a nova senha e o novo PIN.' });
    return;
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
    return;
  }
  if (!/^\d{4,6}$/.test(newPin.trim())) {
    res.status(400).json({ error: 'O novo PIN deve conter de 4 a 6 números.' });
    return;
  }

  const titular = users.titular();
  if (!titular || !titular.wrapped_dek_recovery) {
    res.status(404).json({ error: 'Conta de titular não localizada.' });
    return;
  }
  if (!titular.reset_authorized_by_support) {
    res.status(403).json({
      error: 'Por segurança, peça primeiro para o Suporte liberar a redefinição de senha.',
    });
    return;
  }

  let dekHex: string;
  try {
    dekHex = unwrapDek(titular.wrapped_dek_recovery, normalizeRecoveryKey(recoveryKey));
  } catch {
    addAuditLog({
      userId: titular.id,
      actorRole: 'TITULAR',
      action: 'RECOVERY_FAILED_INVALID_KEY',
      details: 'Tentativa de recuperação com Chave de Emergência inválida.',
      ipAddress,
      userAgent,
    });
    res.status(401).json({ error: 'Chave de Emergência incorreta. Verifique os caracteres digitados.' });
    return;
  }

  runInTransaction(() => {
    users.update(titular.id, {
      password_hash: hashSecret(newPassword),
      pin_hash: hashSecret(newPin.trim()),
      wrapped_dek_password: wrapDek(dekHex, newPassword),
      wrapped_dek_pin: wrapDek(dekHex, newPin.trim()),
      failed_login_attempts: 0,
      failed_pin_attempts: 0,
      locked_until: null,
      reset_authorized_by_support: false,
    });
  });
  destroyAllUserSessions(titular.id);

  addAuditLog({
    userId: titular.id,
    actorRole: 'TITULAR',
    action: 'PASSWORD_RECOVERED',
    details: 'Senha e PIN redefinidos via Chave de Emergência (dados preservados).',
    ipAddress,
    userAgent,
  });

  res.json({ message: 'Senha e PIN atualizados! Todos os seus dados foram preservados.' });
});

/**
 * POST /api/auth/change-security
 * Titular altera senha, PIN e/ou gera nova Chave de Emergência.
 */
router.post(
  '/change-security',
  authRateLimiter,
  requireAuth,
  requireRole('TITULAR'),
  requireUnlockedVault,
  (req: Request, res: Response) => {
    const { currentPassword, newPassword, newPin, regenerateRecovery } = req.body as {
      currentPassword?: string;
      newPassword?: string;
      newPin?: string;
      regenerateRecovery?: boolean;
    };
    const { ipAddress, userAgent } = getClientMeta(req);

    const user = users.byId(req.userSession!.userId);
    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (typeof currentPassword !== 'string' || !verifySecret(currentPassword, user.password_hash)) {
      res.status(401).json({ error: 'Sua senha atual está incorreta.' });
      return;
    }
    if (newPassword && newPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `A nova senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.` });
      return;
    }
    if (newPin && !/^\d{4,6}$/.test(newPin.trim())) {
      res.status(400).json({ error: 'O PIN deve conter de 4 a 6 números.' });
      return;
    }

    const dekHex = req.vault!.dekHex!;
    const patch: Partial<UserRecord> = {};
    let generatedRecoveryKey: string | null = null;

    if (newPassword) {
      patch.password_hash = hashSecret(newPassword);
      patch.wrapped_dek_password = wrapDek(dekHex, newPassword);
    }
    if (newPin) {
      patch.pin_hash = hashSecret(newPin.trim());
      patch.wrapped_dek_pin = wrapDek(dekHex, newPin.trim());
    }
    if (regenerateRecovery) {
      generatedRecoveryKey = generateRecoveryKey();
      patch.wrapped_dek_recovery = wrapDek(dekHex, normalizeRecoveryKey(generatedRecoveryKey));
      patch.recovery_key_hint = `${generatedRecoveryKey.slice(0, 4)}-****-****-****-****-${generatedRecoveryKey.slice(-4)}`;
    }

    runInTransaction(() => users.update(user.id, patch));

    addAuditLog({
      userId: user.id,
      actorRole: 'TITULAR',
      action: 'SECURITY_CREDENTIALS_UPDATED',
      details: `Atualizado: ${[newPassword && 'senha', newPin && 'PIN', regenerateRecovery && 'chave de emergência']
        .filter(Boolean)
        .join(', ') || 'nada'}.`,
      ipAddress,
      userAgent,
    });

    res.json({
      message: 'Configurações de segurança atualizadas!',
      newRecoveryKey: generatedRecoveryKey,
      recoveryKeyHint: patch.recovery_key_hint ?? user.recovery_key_hint,
    });
  }
);

/** PUT /api/auth/preferences — tamanho da letra e tema. */
router.put('/preferences', requireAuth, (req: Request, res: Response) => {
  const { fontSizePref, themePref } = req.body as {
    fontSizePref?: 'NORMAL' | 'LARGE';
    themePref?: 'LIGHT' | 'DARK';
  };
  const patch: Partial<UserRecord> = {};
  if (fontSizePref === 'NORMAL' || fontSizePref === 'LARGE') patch.font_size_pref = fontSizePref;
  if (themePref === 'LIGHT' || themePref === 'DARK') patch.theme_pref = themePref;
  users.update(req.userSession!.userId, patch);

  const user = users.byId(req.userSession!.userId);
  res.json({ fontSizePref: user?.font_size_pref, themePref: user?.theme_pref });
});

/** POST /api/auth/logout */
router.post('/logout', requireAuth, (req: Request, res: Response) => {
  const { ipAddress, userAgent } = getClientMeta(req);
  destroySession(req.userSession!.sessionId);
  clearSessionCookie(res);
  addAuditLog({
    userId: req.userSession!.userId,
    actorRole: req.userSession!.role,
    action: 'LOGOUT',
    details: 'Sessão encerrada pelo usuário.',
    ipAddress,
    userAgent,
  });
  res.json({ message: 'Sessão encerrada com segurança.' });
});

export default router;
