import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { ConfigService } from './config';
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

export class SecurityService {
  constructor(private config: ConfigService) {}

  async getJwtSecret(): Promise<string> {
    const env = process.env.JWT_SECRET?.trim();
    if (env) return env;
    const stored = await this.config.get<string>('security.jwt_secret');
    if (stored && stored.trim().length >= 32) return stored;
    throw new Error('Server not configured: missing JWT secret');
  }

  static generateStrongSecret(bytes = 64): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  async signJwt(payload: object, opts?: jwt.SignOptions): Promise<string> {
    const secret = await this.getJwtSecret();
    return jwt.sign(payload as any, secret, opts);
  }

  async verifyJwt<T = any>(token: string): Promise<T> {
    const secret = await this.getJwtSecret();
    return jwt.verify(token, secret) as T;
  }

  // Password hashing helpers (argon2id primary, bcrypt fallback)
  async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  }

  async verifyPassword(plain: string, hash: string): Promise<{ ok: boolean; needsRehash: boolean }> {
    if (hash.startsWith('$argon2')) {
      const ok = await argon2.verify(hash, plain);
      // Rehash policy could be checked; for now, keep false
      return { ok, needsRehash: false };
    }
    // bcrypt fallback
    const ok = await bcrypt.compare(plain, hash);
    return { ok, needsRehash: ok };
  }
}


