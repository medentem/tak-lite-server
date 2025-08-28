import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';

export class TokenService {
  constructor(private db: DatabaseService) {}

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  generate(): { jti: string; token: string } {
    const jti = uuidv4();
    const token = crypto.randomBytes(48).toString('hex');
    return { jti, token };
  }

  async persist(userId: string, jti: string, token: string, ttlDays = 14): Promise<void> {
    const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await this.db.client('refresh_tokens').insert({ id: jti, user_id: userId, token_hash: this.hash(token), expires_at: expires });
  }

  async rotate(userId: string, oldJti: string | null, oldToken: string | null): Promise<{ jti: string; token: string }> {
    const { jti, token } = this.generate();
    await this.persist(userId, jti, token);
    if (oldJti && oldToken) {
      await this.revoke(oldJti, oldToken);
    }
    return { jti, token };
  }

  async revoke(jti: string, token: string): Promise<void> {
    await this.db.client('refresh_tokens').where({ id: jti, token_hash: this.hash(token) }).update({ revoked: true });
  }

  async verify(jti: string, token: string): Promise<{ userId: string } | null> {
    const row = await this.db.client('refresh_tokens').where({ id: jti, token_hash: this.hash(token), revoked: false }).first();
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) return null;
    return { userId: row.user_id };
  }
}


