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

  // API key encryption/decryption
  async getEncryptionKey(): Promise<string> {
    const env = process.env.ENCRYPTION_KEY?.trim();
    if (env) return env;
    
    let stored = await this.config.get<string>('security.encryption_key');
    if (stored && stored.trim().length >= 32) return stored;
    
    // Auto-generate encryption key if none exists
    const generatedKey = SecurityService.generateStrongSecret(32); // 64 character hex string
    await this.config.set('security.encryption_key', generatedKey);
    return generatedKey;
  }

  async encryptApiKey(apiKey: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    
    // Create a proper key from the hex string
    const keyBuffer = Buffer.from(key, 'hex');
    
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  async decryptApiKey(encryptedApiKey: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const parts = encryptedApiKey.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted API key format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    // Create a proper key from the hex string
    const keyBuffer = Buffer.from(key, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}


