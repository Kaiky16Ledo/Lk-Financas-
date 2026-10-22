import { Router, Request, Response } from 'express';
import {
  accounts,
  addAuditLog,
  auditLogs,
  creditCards,
  exportSnapshot,
  investments,
  transactions,
  users,
} from '../db/database';
import { requireAuth, requireRole } from '../middlewares/security';

const router = Router();

// Exclusivo para o perfil SUPORTE (Filho)
router.use(requireAuth, requireRole('SUPORTE'));

/**
 * GET /api/support/dashboard
 * Retorna diagnóstico técnico, logs de auditoria e prova criptográfica Zero-Knowledge
 * (mostrando que o perfil de suporte NÃO possui a chave DEK e vê apenas textos cifrados).
 */
router.get('/dashboard', (_req: Request, res: Response) => {
  const titular = users.titular();

  if (!titular) {
    res.status(404).json({ error: 'Conta de titular não localizada.' });
    return;
  }

  const isLocked = Boolean(
    titular.locked_until && new Date(titular.locked_until).getTime() > Date.now()
  );

  const accList = accounts.list(titular.id);
  const txList = transactions.sample(2);
  const invList = investments.list(titular.id);

  const encryptedSamples = [
    ...accList.slice(0, 2).map((a) => ({
      table: 'accounts',
      recordId: a.id.slice(0, 8),
      encryptedName: a.name_enc,
      encryptedValue: a.balance_enc,
    })),
    ...txList.map((t) => ({
      table: 'transactions',
      recordId: t.id.slice(0, 8),
      encryptedName: t.description_enc,
      encryptedValue: t.amount_enc,
    })),
    ...invList.slice(0, 1).map((i) => ({
      table: 'investments',
      recordId: i.id.slice(0, 8),
      encryptedName: i.name_enc,
      encryptedValue: i.current_value_enc,
    })),
  ];

  res.json({
    titularStatus: {
      id: titular.id,
      name: titular.name,
      email: titular.email,
      isLocked,
      lockedUntil: titular.locked_until,
      failedLoginAttempts: titular.failed_login_attempts,
      failedPinAttempts: titular.failed_pin_attempts,
      resetAuthorizedBySupport: titular.reset_authorized_by_support,
      recoveryKeyHint: titular.recovery_key_hint,
      wrappedDekPreview: titular.wrapped_dek_password
        ? `${titular.wrapped_dek_password.slice(0, 38)}...`
        : null,
    },
    vaultStats: {
      encryptedAccountsCount: accounts.count(),
      encryptedCardsCount: creditCards.count(),
      encryptedInvestmentsCount: investments.count(),
      encryptedTransactionsCount: transactions.count(),
      auditLogsCount: auditLogs.count(),
    },
    encryptedSamples,
    auditLogs: auditLogs.recent(60),
  });
});

/**
 * POST /api/support/unlock-titular
 * Destrava imediatamente a conta do Pai caso tenha sido bloqueada por excesso de tentativas.
 */
router.post('/unlock-titular', (req: Request, res: Response) => {
  const titular = users.titular();
  if (!titular) {
    res.status(404).json({ error: 'Titular não encontrado.' });
    return;
  }

  users.update(titular.id, {
    failed_login_attempts: 0,
    failed_pin_attempts: 0,
    locked_until: null,
  });

  addAuditLog({
    userId: req.userSession!.userId,
    actorRole: 'SUPORTE',
    action: 'SUPPORT_UNLOCKED_TITULAR_ACCOUNT',
    details: 'Conta do titular desbloqueada manualmente pelo Suporte Técnico.',
    ipAddress: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'Web',
  });

  res.json({ message: 'Conta do seu pai desbloqueada com sucesso!' });
});

/**
 * POST /api/support/toggle-reset-authorization
 * Habilita ou desabilita a permissão para que o Pai redefina sua Senha/PIN usando a Chave de Emergência.
 */
router.post('/toggle-reset-authorization', (req: Request, res: Response) => {
  const { authorize } = req.body as { authorize?: boolean };
  const titular = users.titular();
  if (!titular) {
    res.status(404).json({ error: 'Titular não encontrado.' });
    return;
  }

  const nextVal = Boolean(authorize);
  users.update(titular.id, {
    reset_authorized_by_support: nextVal,
    ...(nextVal ? { failed_login_attempts: 0, locked_until: null } : {}),
  });

  addAuditLog({
    userId: req.userSession!.userId,
    actorRole: 'SUPORTE',
    action: nextVal ? 'SUPPORT_AUTHORIZED_PASSWORD_RESET' : 'SUPPORT_REVOKED_PASSWORD_RESET',
    details: nextVal
      ? 'Suporte liberou a recuperação de senha com Chave de Emergência para o titular.'
      : 'Suporte cancelou a autorização de recuperação de senha.',
    ipAddress: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'Web',
  });

  res.json({
    resetAuthorizedBySupport: nextVal,
    message: nextVal
      ? 'Recuperação de senha liberada! Agora seu pai pode usar a Chave de Emergência na tela de login.'
      : 'Autorização de recuperação desativada.',
  });
});

/**
 * GET /api/support/encrypted-backup
 * Exporta o snapshot criptografado do cofre SQLite (onde todos os valores continuam protegidos em AES-256-GCM).
 */
router.get('/encrypted-backup', (req: Request, res: Response) => {
  addAuditLog({
    userId: req.userSession!.userId,
    actorRole: 'SUPORTE',
    action: 'SUPPORT_EXPORTED_ENCRYPTED_BACKUP',
    details: 'Download de backup criptografado (.enc.json) realizado pelo Suporte.',
    ipAddress: req.ip || '127.0.0.1',
    userAgent: req.headers['user-agent'] || 'Web',
  });

  const backupPayload = {
    system: 'LK Finanças - Zero-Knowledge SQLite Vault Backup',
    encryptionStandard: 'AES-256-GCM + scrypt Envelope Encryption',
    exportedAt: new Date().toISOString(),
    vaultData: exportSnapshot(),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="lk-financas-backup-cifrado-${new Date().toISOString().slice(0, 10)}.enc.json"`
  );
  res.send(JSON.stringify(backupPayload, null, 2));
});

export default router;
