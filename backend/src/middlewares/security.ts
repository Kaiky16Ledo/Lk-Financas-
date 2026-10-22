import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { UserRole } from '../db/database';

/**
 * Segredo de assinatura das sessões.
 * - Se JWT_SECRET estiver definido, precisa ter pelo menos 32 caracteres.
 * - Se não estiver, um segredo aleatório é gerado a cada inicialização. Como as sessões
 *   (e a DEK) vivem só na memória, um reinício já encerra todas as sessões de qualquer
 *   forma — então um segredo efêmero é seguro e evita valores padrão fracos no código.
 */
const JWT_SECRET = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
    }
    return fromEnv;
  }
  return crypto.randomBytes(48).toString('hex');
})();

export const SESSION_COOKIE = 'lk_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionPayload {
  sessionId: string;
  userId: string;
  role: UserRole;
  email: string;
  name: string;
}

export interface ActiveSessionVault {
  userId: string;
  role: UserRole;
  /**
   * A DEK (Data Encryption Key) do titular fica apenas em memória volátil na sessão ativa.
   * Quando o pai bloqueia a tela por PIN (ou por inatividade), dekHex é limpa da sessão
   * até que ele digite o PIN de 4-6 dígitos para desencapsular wrapped_dek_pin novamente.
   */
  dekHex: string | null;
  pinLocked: boolean;
  lastActivityAt: number;
}

// Cofre volátil de sessões em memória RAM (nunca vai para o disco)
const sessionVault = new Map<string, ActiveSessionVault>();

// Rate limiter em memória contra ataques de força bruta por IP
const ipRateLimits = new Map<string, { count: number; resetAt: number }>();

export function createSession(params: {
  sessionId: string;
  userId: string;
  role: UserRole;
  dekHex: string | null;
}): void {
  sessionVault.set(params.sessionId, {
    userId: params.userId,
    role: params.role,
    dekHex: params.dekHex,
    pinLocked: false,
    lastActivityAt: Date.now(),
  });
}

export function getSessionVault(sessionId: string): ActiveSessionVault | undefined {
  return sessionVault.get(sessionId);
}

export function lockSessionPin(sessionId: string): void {
  const entry = sessionVault.get(sessionId);
  if (entry) {
    entry.dekHex = null; // Remove a DEK da memória RAM enquanto estiver bloqueado por PIN!
    entry.pinLocked = true;
  }
}

export function unlockSessionPin(sessionId: string, dekHex: string): void {
  const entry = sessionVault.get(sessionId);
  if (entry) {
    entry.dekHex = dekHex;
    entry.pinLocked = false;
    entry.lastActivityAt = Date.now();
  }
}

export function destroySession(sessionId: string): void {
  sessionVault.delete(sessionId);
}

export function destroyAllUserSessions(userId: string): void {
  for (const [sid, data] of sessionVault.entries()) {
    if (data.userId === userId) {
      sessionVault.delete(sid);
    }
  }
}

export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

declare global {
  namespace Express {
    interface Request {
      userSession?: SessionPayload;
      vault?: ActiveSessionVault;
    }
  }
}

/**
 * Rate Limiter para proteger rotas sensíveis (Login, PIN, Recuperação)
 */
export function authRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 5 * 60 * 1000; // 5 minutos
  const maxRequests = 30;

  // Limpeza periódica para não acumular IPs indefinidamente
  if (ipRateLimits.size > 5000) {
    for (const [key, value] of ipRateLimits) {
      if (now > value.resetAt) ipRateLimits.delete(key);
    }
  }

  const record = ipRateLimits.get(ip);
  if (!record || now > record.resetAt) {
    ipRateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }

  record.count += 1;
  if (record.count > maxRequests) {
    res.status(429).json({
      error: 'Muitas tentativas seguidas a partir deste endereço. Aguarde alguns minutos por segurança.',
    });
    return;
  }
  next();
}

/**
 * Middleware que exige sessão autenticada válida
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Somente cookie HttpOnly: o token nunca fica acessível ao JavaScript da página (proteção contra XSS).
  const token = req.cookies?.[SESSION_COOKIE];

  if (!token) {
    res.status(401).json({ error: 'Sessão não autenticada. Faça login novamente.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionPayload;
    const vault = sessionVault.get(decoded.sessionId);

    if (!vault) {
      res.status(401).json({ error: 'Sessão expirada ou encerrada por segurança. Faça login novamente.' });
      return;
    }

    // Verifica inatividade automática no servidor (15 min sem requisição trava por PIN para o Titular)
    const idleMs = Date.now() - vault.lastActivityAt;
    if (vault.role === 'TITULAR' && !vault.pinLocked && idleMs > 15 * 60 * 1000) {
      lockSessionPin(decoded.sessionId);
    } else {
      vault.lastActivityAt = Date.now();
    }

    req.userSession = decoded;
    req.vault = vault;
    next();
  } catch {
    res.status(401).json({ error: 'Token de segurança inválido ou expirado.' });
  }
}

/**
 * Middleware Role Guard: Garante segregação estrita entre TITULAR (Pai) e SUPORTE (Filho)
 */
export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userSession || req.userSession.role !== role) {
      res.status(403).json({
        error: `Acesso negado. Esta área é exclusiva do perfil ${role}.`,
      });
      return;
    }
    next();
  };
}

/**
 * Middleware que exige que a tela de PIN esteja desbloqueada e a DEK esteja presente em memória
 */
export function requireUnlockedVault(req: Request, res: Response, next: NextFunction): void {
  if (!req.vault || req.vault.pinLocked || !req.vault.dekHex) {
    res.status(423).json({
      error: 'Sessão bloqueada por PIN. Digite seu PIN de 4 a 6 dígitos para acessar os dados.',
      pinLocked: true,
    });
    return;
  }
  next();
}
