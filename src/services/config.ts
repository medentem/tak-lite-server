import { DatabaseService } from './database';

type ConfigKey =
  | 'setup.completed'
  | 'security.jwt_secret'
  | 'security.encryption_key'
  | 'security.cors_origin'
  | 'org.name'
  | 'features.redis_enabled'
  | 'features.retention_days';

export class ConfigService {
  constructor(private db: DatabaseService) {}

  async get<T = unknown>(key: ConfigKey): Promise<T | undefined> {
    // Simple in-memory cache with no TTL (can be enhanced)
    if (!ConfigCache.instance) ConfigCache.instance = new ConfigCache(this.db);
    return (await ConfigCache.instance.get<T>(key));
  }

  async set<T = unknown>(key: ConfigKey, value: T): Promise<void> {
    // Ensure JSONB values are valid JSON (strings must be quoted)
    const jsonValue = this.db.client.raw('?::jsonb', [JSON.stringify(value)]);
    const exists = await this.db.client('config').where({ key }).first();
    if (exists) {
      await this.db.client('config').where({ key }).update({ value: jsonValue, updated_at: this.db.client.fn.now() });
    } else {
      await this.db.client('config').insert({ key, value: jsonValue });
    }
    if (!ConfigCache.instance) ConfigCache.instance = new ConfigCache(this.db);
    ConfigCache.instance.invalidate(key);
  }
}

class ConfigCache {
  static instance: ConfigCache | null = null;
  private cache = new Map<string, { value: unknown; ts: number }>();
  private ttlMs = 60_000; // 60s default TTL

  constructor(private db: DatabaseService) {}

  async get<T>(key: ConfigKey): Promise<T | undefined> {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && now - entry.ts < this.ttlMs) {
      return entry.value as T;
    }
    const row = await this.db.client('config').where({ key }).first();
    const value = row ? (row.value as T) : undefined;
    this.cache.set(key, { value, ts: now });
    return value;
  }

  invalidate(key?: ConfigKey) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}


