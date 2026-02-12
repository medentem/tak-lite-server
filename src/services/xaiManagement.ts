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
    if (!hasTable) {
      logger.debug('xAI Management: xai_management_config table not found');
      return null;
    }
    const row = await this.db.client('xai_management_config').first();
    const config = row ? (row as XaiManagementConfig) : null;
    if (!config) logger.debug('xAI Management: no config row in xai_management_config');
    else logger.debug('xAI Management: config present', { team_id: config.team_id, has_key: !!config.management_key_encrypted?.trim() });
    return config;
  }

  /** Whether we have enough config to call the Management API (key + team_id). */
  async isConfigured(): Promise<boolean> {
    const c = await this.getConfig();
    const configured = !!(c?.management_key_encrypted?.trim() && c?.team_id?.trim());
    logger.info('xAI Management: isConfigured', { configured, team_id: c?.team_id ?? null });
    return configured;
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
      logger.info('xAI Management: setConfig updated existing', { team_id: tid });
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
    logger.info('xAI Management: setConfig created new', { team_id: tid });
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
    if (!config?.management_key_encrypted || !config?.team_id) {
      logger.info('xAI Management: fetchBalance skipped (not configured)', { has_key: !!config?.management_key_encrypted, team_id: config?.team_id ?? null });
      return null;
    }
    const url = `${MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(config.team_id)}/prepaid/balance`;
    logger.info('xAI Management: fetchBalance calling', { url, team_id: config.team_id });
    try {
      const key = await this.security.decryptApiKey(config.management_key_encrypted);
      const cleanKey = key.trim().replace(/[\r\n\t]/g, '');
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${cleanKey}` },
        timeout: 15000,
      });
      const data = (res.data ?? {}) as XaiPrepaidBalance;
      logger.info('xAI Management: fetchBalance success', { balance_usd: data.balance_usd, status: res.status });
      return data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseBody = err.response?.data;
      const notAvailable = status === 501 || status === 404;
      if (notAvailable) {
        logger.info('xAI Management: fetchBalance endpoint not available', { status, responseBody });
      } else {
        logger.warn('xAI Management: fetchBalance failed', { status, message: err.message, responseBody });
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
    if (!config?.management_key_encrypted || !config?.team_id) {
      logger.info('xAI Management: fetchUsage skipped (not configured)', { has_key: !!config?.management_key_encrypted, team_id: config?.team_id ?? null });
      return null;
    }
    const url = `${MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(config.team_id)}/usage`;
    logger.info('xAI Management: fetchUsage calling', { url, team_id: config.team_id });
    try {
      const key = await this.security.decryptApiKey(config.management_key_encrypted);
      const cleanKey = key.trim().replace(/[\r\n\t]/g, '');
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${cleanKey}` },
        timeout: 15000,
      });
      const data = (res.data ?? {}) as XaiUsageResponse;
      const usageArr = Array.isArray(data.usage) ? data.usage : [];
      logger.info('xAI Management: fetchUsage success', { usage_rows: usageArr.length, status: res.status, sample_dates: usageArr.slice(0, 3).map((r: any) => r?.date) });
      return data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseBody = err.response?.data;
      const notAvailable = status === 501 || status === 404;
      if (notAvailable) {
        logger.info('xAI Management: fetchUsage endpoint not available', { status, responseBody });
      } else {
        logger.warn('xAI Management: fetchUsage failed', { status, message: err.message, responseBody });
      }
      return null;
    }
  }
}
