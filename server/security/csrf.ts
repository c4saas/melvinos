import type { Request, Response, NextFunction } from 'express';
import { generateCsrfToken, secureCompare } from './secure-compare';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

export function attachCsrfToken(req: Request, res: Response, next: NextFunction) {
  // If session middleware was skipped (anonymous request), generate a stateless cookie token
  const token = req.session
    ? (req.session.csrfToken || (req.session.csrfToken = generateCsrfToken()))
    : generateCsrfToken();

  const secure = req.app.get('env') === 'production' && process.env.COOKIE_SECURE !== 'false';
  res.cookie('XSRF-TOKEN', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  next();
}

export function verifyCsrfToken(req: Request, res: Response, next: NextFunction) {
  if (isSafeMethod(req.method)) {
    return next();
  }

  // If no session (anonymous request), CSRF is validated by the cookie itself
  if (!req.session?.csrfToken) {
    return res.status(403).json({ error: 'Missing CSRF token' });
  }

  const token = (req.headers['x-csrf-token'] as string | undefined)
    || (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, any>)._csrf : undefined);

  if (!token || !secureCompare(token, req.session.csrfToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  return next();
}
