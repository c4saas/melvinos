import { Request, Response, NextFunction } from 'express';
import * as bcrypt from 'bcryptjs';
import { pbkdf2Sync, timingSafeEqual } from 'crypto';
import type { PlatformSettingsData, User } from '@shared/schema';
import { IStorage } from './storage';
import { ensureAdminRole } from './security/admin';
import { getDefaultModel } from './ai-models';

const isNonEmptyEnvVar = (value?: string | null): boolean =>
  typeof value === 'string' && value.trim().length > 0;

export class AuthService {
  constructor(private storage: IStorage) {}


  // Hash password using bcrypt
  hashPassword(password: string): string {
    const saltRounds = 10; // Recommended default for bcrypt
    return bcrypt.hashSync(password, saltRounds);
  }

  private parseLegacyPbkdf2Hash(
    hashedPassword: string,
  ): { algorithm: string; iterations: number; salt: string; derivedKey: string } | null {
    const normalized = hashedPassword.trim();
    if (!normalized) {
      return null;
    }

    const colonParts = normalized.split(':');
    if (colonParts[0]?.startsWith('pbkdf2')) {
      if (colonParts.length === 4) {
        const [, iterationsStr, salt, derivedKey] = colonParts;
        const iterations = Number.parseInt(iterationsStr, 10);
        if (!Number.isFinite(iterations)) {
          return null;
        }
        const algorithm = this.resolvePbkdf2Algorithm(colonParts[0]);
        return { algorithm, iterations, salt, derivedKey };
      }
      if (colonParts.length === 5) {
        const [, algorithmName, iterationsStr, salt, derivedKey] = colonParts;
        const iterations = Number.parseInt(iterationsStr, 10);
        if (!Number.isFinite(iterations)) {
          return null;
        }
        return { algorithm: algorithmName.toLowerCase(), iterations, salt, derivedKey };
      }
    }

    const dollarParts = normalized.split('$');
    if (dollarParts[0]?.startsWith('pbkdf2')) {
      if (dollarParts.length >= 4) {
        const [, iterationsStr, salt, derivedKey] = dollarParts.slice(0, 4);
        const iterations = Number.parseInt(iterationsStr, 10);
        if (!Number.isFinite(iterations)) {
          return null;
        }
        const algorithm = this.resolvePbkdf2Algorithm(dollarParts[0]);
        return { algorithm, iterations, salt, derivedKey };
      }
    }

    if (colonParts.length === 3 && /^\d+$/.test(colonParts[0])) {
      const [iterationsStr, salt, derivedKey] = colonParts;
      const iterations = Number.parseInt(iterationsStr, 10);
      if (!Number.isFinite(iterations)) {
        return null;
      }
      return { algorithm: 'sha256', iterations, salt, derivedKey };
    }

    return null;
  }

  private resolvePbkdf2Algorithm(input: string): string {
    const schemeParts = input.split(/[:_]/);
    return (schemeParts[1] ?? 'sha256').toLowerCase();
  }

  private decodeKeyMaterial(value: string): Buffer {
    const trimmed = value.trim();
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
      return Buffer.from(trimmed, 'hex');
    }
    try {
      return Buffer.from(trimmed, 'base64');
    } catch {
      return Buffer.from(trimmed, 'utf8');
    }
  }

  private verifyLegacyPbkdf2(password: string, hashedPassword: string): boolean {
    const parsed = this.parseLegacyPbkdf2Hash(hashedPassword);
    if (!parsed) {
      return false;
    }

    try {
      const saltBuffer = this.decodeKeyMaterial(parsed.salt);
      const storedKeyBuffer = this.decodeKeyMaterial(parsed.derivedKey);
      if (storedKeyBuffer.length === 0) {
        return false;
      }

      const derived = pbkdf2Sync(
        password,
        saltBuffer,
        parsed.iterations,
        storedKeyBuffer.length,
        parsed.algorithm,
      );

      if (derived.length !== storedKeyBuffer.length) {
        return false;
      }

      return timingSafeEqual(derived, storedKeyBuffer);
    } catch {
      return false;
    }
  }

  // Verify password using bcrypt or legacy PBKDF2 hashes
  verifyPassword(
    password: string,
    hashedPassword: string,
  ): { isValid: boolean; needsRehash: boolean } {
    if (!hashedPassword) {
      return { isValid: false, needsRehash: false };
    }

    const isLegacyMatch = this.verifyLegacyPbkdf2(password, hashedPassword);
    if (isLegacyMatch) {
      return { isValid: true, needsRehash: true };
    }

    const isValid = bcrypt.compareSync(password, hashedPassword);
    return { isValid, needsRehash: false };
  }

  // Register new user
  async register(username: string, password: string, email?: string): Promise<User> {
    // Check if username already exists
    const existingUser = await this.storage.getUserByUsername(username);
    if (existingUser) {
      throw new Error('Username already exists');
    }

    // Hash password
    const hashedPassword = this.hashPassword(password);

    // Create user
    const user = await this.storage.createUser({
      username,
      password: hashedPassword,
      email: email || null,
      avatar: null,
      plan: 'free',
      proAccessCode: null,
      role: 'user',
    });

    return user;
  }

  // Login user
  async login(username: string, password: string): Promise<User> {
    const user = await this.storage.getUserByUsername(username);
    
    if (!user) {
      throw new Error('Invalid username or password');
    }

    // If user doesn't have a password (legacy user), update it
    if (!user.password) {
      const hashedPassword = this.hashPassword(password);
      await this.storage.updateUser(user.id, { password: hashedPassword });
      return user;
    }

    // Verify password
    const verification = this.verifyPassword(password, user.password);
    if (!verification.isValid) {
      throw new Error('Invalid username or password');
    }

    if (verification.needsRehash) {
      const hashedPassword = this.hashPassword(password);
      await this.storage.updateUser(user.id, { password: hashedPassword });
      user.password = hashedPassword;
    }

    const status = user.status ?? 'active';
    if (status !== 'active') {
      if (status === 'suspended') {
        throw new Error('Account suspended. Please contact support.');
      }
      throw new Error('Account is inactive. Please contact support.');
    }

    return user;
  }

  // Get user limits based on user's plan tier
  async getUserLimits(userId: string) {
    const user = await this.storage.getUser(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const settingsRecord = await this.storage.getPlatformSettings();
    const settings: PlatformSettingsData = structuredClone(settingsRecord.data);
    const userPlan = (user.plan as 'free' | 'pro' | 'enterprise') || 'enterprise';
    const planSettings = settings.planTiers[userPlan] ?? settings.planTiers.enterprise;
    const ttsProviders = settings.ttsProviders ?? {};
    const hasConfiguredTtsProvider = Object.values(ttsProviders).some(
      (p: any) => p.enabled && p.defaultApiKey
    );
    // The actual TTS implementation uses OpenAI's Realtime API via env vars
    const hasOpenAIVoiceKey = isNonEmptyEnvVar(process.env.OPENAI_VOICE_API_KEY) ||
      isNonEmptyEnvVar(process.env.OPENAI_API_KEY);
    const voiceEnabled = hasConfiguredTtsProvider || hasOpenAIVoiceKey;
    // Voice input needs a Groq key (for Whisper transcription) or OpenAI key (for Whisper via OpenAI)
    const groqProvider = settings.apiProviders.groq;
    const hasGroqKey = isNonEmptyEnvVar(process.env.GROQ_API_KEY) ||
      !!(groqProvider && (groqProvider as any).defaultApiKey);
    const voiceInputEnabled = hasGroqKey || hasOpenAIVoiceKey;

    // Derive allowed models from apiProviders (the source of truth admins edit)
    const derivedModels: string[] = [];
    for (const [, providerConfig] of Object.entries(settings.apiProviders)) {
      if ((providerConfig as any).enabled && (providerConfig as any).allowedModels?.length) {
        derivedModels.push(...(providerConfig as any).allowedModels);
      }
    }

    const allowedModels = derivedModels.length > 0 ? derivedModels : [...planSettings.allowedModels];

    // Determine default model: prefer admin-configured, then server-available, then first allowed
    let defaultModel = (settings as any).defaultModel ?? getDefaultModel();
    if (!allowedModels.includes(defaultModel) && allowedModels.length > 0) {
      defaultModel = allowedModels[0];
    }

    return {
      plan: userPlan,
      messageLimitPerDay: planSettings.messageLimitPerDay ?? null,
      allowedModels,
      features: [...planSettings.features],
      fileUploadLimitMb: planSettings.fileUploadLimitMb,
      chatHistoryEnabled: true,
      knowledgeBase: structuredClone(settings.knowledgeBase),
      memory: structuredClone(settings.memory),
      templates: structuredClone(settings.templates),
      projects: structuredClone(settings.projects),
      apiProviders: structuredClone(settings.apiProviders),
      legacyModels: [...(settings.legacyModels ?? [])],
      isAdmin: user.role === 'super_admin' || user.role === 'admin',
      voiceEnabled,
      voiceInputEnabled,
      defaultModel,
    };
  }

  // Middleware to check if user is authenticated
  async requireAuth(req: Request, res: Response, next: NextFunction) {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = await this.storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const normalized = await ensureAdminRole(user, this.storage);
    let effectiveUser = normalized ?? user;

    if (normalized && normalized.role !== user.role) {
      const updated = await this.storage.updateUser(user.id, { role: normalized.role });
      effectiveUser = updated ?? normalized;
    }

    const status = effectiveUser.status ?? 'active';
    if (status !== 'active') {
      const message = status === 'suspended'
        ? 'Account suspended. Please contact support.'
        : 'Account is inactive.';
      return res.status(403).json({ error: message });
    }

    (req as any).user = effectiveUser;
    next();
  }

  // Single-user: no rate limiting
  async checkRateLimit(_userId: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }
}

// Session type definition
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    csrfToken?: string;
  }
}