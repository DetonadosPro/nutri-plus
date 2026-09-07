import { createHash } from 'node:crypto';
import type { Express, CookieOptions, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { securityPolicy } from './security-policy';

export function sessionCookieOptions(security: ReturnType<typeof securityPolicy>): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure: security.cookieSecure, path: '/' };
}

export function configureSecurity(app: Express, production: boolean, appUrl?: string) {
  app.disable('x-powered-by');
  // Only a local reverse proxy can supply the client's address.
  app.set('trust proxy', 'loopback');
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  if (production && appUrl) {
    const origin = new URL(appUrl).origin;
    app.use('/api', (req, res, next) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== origin) {
        res.status(403).json({ error: 'Origem da solicitação não permitida.' });
        return;
      }
      next();
    });
  }
}

export function authenticationLimits(options: { windowMs?: number; ipLimit?: number; accountLimit?: number } = {}): RequestHandler[] {
  const base = {
    windowMs: options.windowMs ?? 15 * 60_000,
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' },
  };
  return [
    rateLimit({ ...base, limit: options.ipLimit ?? 60 }),
    rateLimit({
      ...base,
      limit: options.accountLimit ?? 15,
      skip: (req) => typeof req.body?.email !== 'string',
      keyGenerator: (req) => createHash('sha256').update(String(req.body?.email || '').trim().toLowerCase()).digest('hex'),
    }),
  ];
}

export function accountMailLimit() {
  return rateLimit({
    windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    skip: (req) => req.method !== 'POST' || !(
      /\/(password-reset-email|email-verification|activation-code)$/.test(req.path) ||
      (/\/access$/.test(req.path) && ['activation', 'verification', 'password_reset'].includes(req.body?.action))
    ),
    message: { error: 'Muitas solicitações de acesso. Aguarde alguns minutos para reenviar.' },
  });
}
