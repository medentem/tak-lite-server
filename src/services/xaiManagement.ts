/**
 * xAI Management API integration for actual balance and usage.
 * Uses a separate Management API key (not the Grok inference key).
 * See: https://docs.x.ai/docs/key-information/using-management-api
 * Base URL: https://management-api.x.ai
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { SecurityService } from './security';
import { ConfigService } from './config';
import { logger } from '../utils/logger';

const MANAGEMENT_API_BASE = 'https://management-api.x.ai';

export interface XaiManagementConfig {
  id: string;
  management_key_encrypted: string | null;
  team_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface XaiPrepaidBalance {
  balance_usd?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface XaiUsageResponse {
  usage?: Array<{ date?: string; cost_usd?: number; tokens?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}

export class XaiManagementService {
  private security: SecurityService;

  constructor(private db: DatabaseService) {
    const configService = new ConfigService(db);
    this.security = new SecurityService(configService);
  }

  /** Get the single management config row, if any. */
  async getConfig(): Promise<XaiManagementConfig | null> {
    const hasTable = await this.db.client.schema.hasTable('xai_management_config');
    if (!hasTable) return null;
    const row = await this.db.client('xai_management_config').first();
    return row ? (row as XaiManagementConfig) : null;
  }

  /** Whether we have enough config to call the Management API (key + team_id). */
  async isConfigured(): Promise<boolean> {
    const c = await this.getConfig();
    return !!(c?.management_key_encrypted?.trim() && c?.team_id?.trim());
  }

  /**
   * Set or update Management API key and team ID.
   * Key is encrypted at rest. Team ID is the xAI Console team ID for billing/usage URLs.
   */
  async setConfig(managementApiKey: string, teamId: string): Promise<XaiManagementConfig> {
    const key = (managementApiKey || '').trim();
    const tid = (teamId || '').trim();
    if (!key || !tid) {
      throw new Error('Management API key and team ID are required');
    }
    const encrypted = await this.security.encryptApiKey(key);
    const hasTable = await this.db.client.schema.hasTable('xai_management_config');
    if (!hasTable) {
      throw new Error('xai_management_config table not found; run migrations');
    }
    const existing = await this.db.client('xai_management_config').first();
    const now = new Date();
    if (existing) {
      await this.db.client('xai_management_config')
        .where({ id: existing.id })
        .update({
          management_key_encrypted: encrypted,
          team_id: tid,
          updated_at: now,
        });
      const updated = await this.db.client('xai_management_config').where({ id: existing.id }).first();
      return updated as XaiManagementConfig;
    }
    const id = uuidv4();
    await this.db.client('xai_management_config').insert({
      id,
      management_key_encrypted: encrypted,
      team_id: tid,
      created_at: now,
      updated_at: now,
    });
    const row = await this.db.client('xai_management_config').where({ id }).first();
    return row as XaiManagementConfig;
  }

  /**
   * Clear the management key (and optionally team_id). Call when user wants to remove actual-usage integration.
   */
  async clearConfig(): Promise<void> {
    const existing = await this.db.client('xai_management_config').first();
    if (existing) {
      await this.db.client('xai_management_config')
        .where({ id: existing.id })
        .update({
          management_key_encrypted: null,
          team_id: null,
          updated_at: new Date(),
        });
    }
  }

  /**
   * Fetch prepaid balance from xAI Management API. Returns null if not configured or request fails.
   * 501/404: endpoint not implemented or not enabled for this account — we log at debug only.
   */
  async fetchBalance(): Promise<XaiPrepaidBalance | null> {
    const config = await this.getConfig();
    if (!config?.management_key_encrypted || !config?.team_id) return null;
    try {
      const key = await this.security.decryptApiKey(config.management_key_encrypted);
      const cleanKey = key.trim().replace(/[\r\n\t]/g, '');
      const url = `${MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(config.team_id)}/prepaid/balance`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${cleanKey}` },
        timeout: 15000,
      });
      return (res.data ?? {}) as XaiPrepaidBalance;
    } catch (err: any) {
      const status = err.response?.status;
      const notAvailable = status === 501 || status === 404;
      if (notAvailable) {
        logger.debug('xAI Management API balance not available (endpoint may not be enabled)', { status });
      } else {
        logger.warn('xAI Management API balance fetch failed', { status, message: err.message });
      }
      return null;
    }
  }

  /**
   * Fetch historical usage from xAI Management API.
   * Returns null if not configured or request fails.
   * 501/404: endpoint not implemented or not enabled for this account — we log at debug only.
   */
  async fetchUsage(): Promise<XaiUsageResponse | null> {
    const config = await this.getConfig();
    if (!config?.management_key_encrypted || !config?.team_id) return null;
    try {
      const key = await this.security.decryptApiKey(config.management_key_encrypted);
      const cleanKey = key.trim().replace(/[\r\n\t]/g, '');
      const url = `${MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(config.team_id)}/usage`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${cleanKey}` },
        timeout: 15000,
      });
      return (res.data ?? {}) as XaiUsageResponse;
    } catch (err: any) {
      const status = err.response?.status;
      const notAvailable = status === 501 || status === 404;
      if (notAvailable) {
        logger.debug('xAI Management API usage not available (endpoint may not be enabled)', { status });
      } else {
        logger.warn('xAI Management API usage fetch failed', { status, message: err.message });
      }
      return null;
    }
  }
}
