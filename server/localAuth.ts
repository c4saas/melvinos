// Single-user session authentication (no Passport.js)
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
    disableTouch: true, // Prevent INSERT/UPDATE on unmodified sessions (avoids session row leak)
  });
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET must be configured');
  }
  const secureCookies = process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
  return session({
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: secureCookies,
      maxAge: sessionTtl,
      sameSite: 'lax',
    },
  });
}

// Paths that must always have session (they write to req.session)
const SESSION_REQUIRED_PATHS = new Set([
  '/api/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/enroll',
  '/api/auth/csrf-token', // must establish session so the returned token is usable for login
]);

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  const sessionMiddleware = getSession();
  // Only run session middleware if:
  //   1. Request already has a session cookie (authenticated user), OR
  //   2. Route is one that needs to CREATE a session (login, setup)
  // This prevents connect-pg-simple from creating empty rows for anonymous traffic.
  app.use((req, res, next) => {
    if (req.headers.cookie?.includes('connect.sid') || SESSION_REQUIRED_PATHS.has(req.path)) {
      return sessionMiddleware(req, res, next);
    }
    return next();
  });

  // Load user from session on every request
  app.use(async (req, _res, next) => {
    if (req.session?.userId) {
      try {
        const user = await storage.getUser(req.session.userId);
        if (user) {
          (req as any).user = user;
        }
      } catch {
        // Session references a deleted user — continue unauthenticated
      }
    }
    next();
  });
}

// Middleware to check if user is authenticated
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.session?.userId && (req as any).user) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};
