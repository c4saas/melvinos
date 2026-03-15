import type { Request, Response, NextFunction } from 'express';
import { generateCsrfToken, secureCompare } from './secure-compare';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

export function attachCsrfToken(req: Request, res: Response, next: NextFunction) {
  // Prefer session-stored token; fall back to incoming cookie; otherwise generate fresh.
  // Token is stored on req so downstream handlers can read it without re-parsing the response.
  let token: string;
  if (req.session?.csrfToken) {
    token = req.session.csrfToken;
  } else if (req.cookies?.['XSRF-TOKEN']) {
    token = req.cookies['XSRF-TOKEN'];
    // Persist into session if one exists
    if (req.session) req.session.csrfToken = token;
  } else {
    token = generateCsrfToken();
    if (req.session) req.session.csrfToken = token;
  }

  // Expose to route handlers via req.csrfToken
  (req as any).csrfToken = token;

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

  const submitted = (req.headers['x-csrf-token'] as string | undefined)
    || (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, any>)._csrf : undefined);

  if (!submitted) {
    return res.status(403).json({ error: 'Missing CSRF token' });
  }

  // Authenticated session: compare against session-stored token
  if (req.session?.csrfToken) {
    if (!secureCompare(submitted, req.session.csrfToken)) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    return next();
  }

  // Unauthenticated (pre-login): double-submit cookie pattern —
  // submitted header must match the XSRF-TOKEN cookie sent with the request.
  const cookieToken = req.cookies?.['XSRF-TOKEN'];
  if (!cookieToken || !secureCompare(submitted, cookieToken)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  return next();
}
