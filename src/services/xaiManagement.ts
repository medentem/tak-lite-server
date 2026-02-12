/**
 * xAI Management API integration for actual balance and usage.
 *
 * DOCUMENTATION (definitive):
 * - Using Management API: https://docs.x.ai/docs/key-information/using-management-api
 * - Management API Reference (billing): https://docs.x.ai/developers/management-api (Billing Management section)
 * - Base URL: https://management-api.x.ai
 *
 * ENDPOINTS USED:
 * - Prepaid balance: GET /v1/billing/teams/{team_id}/prepaid/balance
 *   Ref: https://docs.x.ai/developers/management-api/billing
 * - Historical usage: POST /v1/billing/teams/{team_id}/usage (body: { startDate, endDate })
 *   Ref: https://docs.x.ai/developers/management-api/billing
 *
 * REQUIRED PERMISSION:
 * The management key only needs read access to billing (we only call GET for balance and usage).
 * Obtain the key at: xAI Console → Settings → Management Keys. Ensure the key has billing read access.
 * For Cost Today / Cost This Month the usage endpoint must succeed; if you get 501, the usage API may not
 * be enabled for your key—check that billing read is granted for the key.
 *
 * This uses a separate Management API key, not the Grok inference API key.
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
      const raw = res.data ?? {};
      const data = raw as Record<string, unknown>;
      const keys = Object.keys(data);
      logger.info('xAI Management: fetchBalance success', { status: res.status, response_keys: keys });

      // Normalize balance from various possible response shapes (xAI docs don't specify; try common patterns)
      const balance_usd =
        typeof (data as XaiPrepaidBalance).balance_usd === 'number' ? (data as XaiPrepaidBalance).balance_usd
        : typeof data.balance === 'number' ? data.balance
        : typeof data.amount === 'number' ? data.amount
        : typeof data.credits === 'number' ? data.credits
        : typeof data.current_balance === 'number' ? data.current_balance
        : data.balance && typeof data.balance === 'object' && data.balance !== null
          ? typeof (data.balance as Record<string, unknown>).amount === 'number'
            ? (data.balance as Record<string, unknown>).amount as number
            : typeof (data.balance as Record<string, unknown>).value === 'number'
              ? (data.balance as Record<string, unknown>).value as number
              : typeof (data.balance as Record<string, unknown>).balance_usd === 'number'
                ? (data.balance as Record<string, unknown>).balance_usd as number
                : undefined
          : undefined;
      if (balance_usd !== undefined) {
        (data as XaiPrepaidBalance).balance_usd = balance_usd;
        logger.info('xAI Management: fetchBalance normalized', { balance_usd });
      } else {
        logger.info('xAI Management: fetchBalance could not normalize balance from response', { response_keys: keys });
      }
      return data as XaiPrepaidBalance;
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
   * Per https://docs.x.ai/developers/management-api/billing the usage endpoint is POST with analyticsRequest body.
   */
  async fetchUsage(): Promise<XaiUsageResponse | null> {
    const config = await this.getConfig();
    if (!config?.management_key_encrypted || !config?.team_id) {
      logger.info('xAI Management: fetchUsage skipped (not configured)', { has_key: !!config?.management_key_encrypted, team_id: config?.team_id ?? null });
      return null;
    }
    const key = await this.security.decryptApiKey(config.management_key_encrypted);
    const cleanKey = key.trim().replace(/[\r\n\t]/g, '');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const startTime = `${startOfMonth.getFullYear()}-${String(startOfMonth.getMonth() + 1).padStart(2, '0')}-${String(startOfMonth.getDate()).padStart(2, '0')} 00:00:00`;
    const endTime = `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth() + 1).padStart(2, '0')}-${String(endOfMonth.getDate()).padStart(2, '0')} 23:59:59`;
    const url = `${MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(config.team_id)}/usage`;
    const headers = { Authorization: `Bearer ${cleanKey}`, 'Content-Type': 'application/json' };
    const body = {
      analyticsRequest: {
        timeRange: {
          startTime,
          endTime,
          timezone: 'Etc/GMT',
        },
        timeUnit: 'TIME_UNIT_DAY',
        values: [
          { name: 'usd', aggregation: 'AGGREGATION_SUM' },
        ],
        groupBy: ['description'],
        filters: [],
      },
    };

    try {
      logger.info('xAI Management: fetchUsage POST', { url, team_id: config.team_id, startTime, endTime });
      const res = await axios.post(url, body, { headers, timeout: 15000 });
      const data = this.normalizeUsageResponse(res.data);
      if (data) {
        const usageArr = Array.isArray(data.usage) ? data.usage : [];
        logger.info('xAI Management: fetchUsage success', { usage_rows: usageArr.length, status: res.status });
        return data;
      }
      logger.info('xAI Management: fetchUsage response shape not recognized', { response_keys: res.data && typeof res.data === 'object' ? Object.keys(res.data) : [] });
      return null;
    } catch (err: any) {
      const status = err.response?.status;
      const responseBody = err.response?.data;
      if (status === 501 || status === 404) {
        logger.info('xAI Management: fetchUsage endpoint not available', { status, responseBody });
      } else {
        logger.warn('xAI Management: fetchUsage failed', { status, message: err.message, responseBody });
      }
      return null;
    }
  }

  private mapAnalyticsRowsToUsage(rows: Array<Record<string, unknown>>): Array<{ date?: string; cost_usd?: number; [key: string]: unknown }> {
    return rows.map((row) => {
      const dateStr = row.startTime ?? row.date ?? row.timeBucket ?? (row.timeRange as Record<string, unknown>)?.startTime;
      let date: string | undefined;
      if (typeof dateStr === 'string') date = dateStr.slice(0, 10);
      const cost = typeof row.usd === 'number' ? row.usd : typeof row.cost_usd === 'number' ? row.cost_usd : typeof row.value === 'number' ? row.value : 0;
      return { date, cost_usd: cost };
    });
  }

  /**
   * Normalize usage response to { usage: [{ date, cost_usd }, ...] } for the route.
   * Handles the documented format: { timeSeries: [{ dataPoints: [{ timestamp, values: [usd] }] }] }.
   * Aggregates by date: sums values[0] (USD) across all series and dataPoints for each date.
   */
  private normalizeUsageResponse(raw: unknown): XaiUsageResponse | null {
    if (raw == null) return null;
    const obj = raw as Record<string, unknown>;
    let usageArr: Array<{ date?: string; cost_usd?: number; tokens?: number; [key: string]: unknown }> | undefined;

    if (Array.isArray(obj.timeSeries)) {
      const byDate: Record<string, number> = {};
      for (const series of obj.timeSeries as Array<{ dataPoints?: Array<{ timestamp?: string; values?: number[] }> }>) {
        const points = series.dataPoints;
        if (!Array.isArray(points)) continue;
        for (const dp of points) {
          const ts = dp.timestamp;
          const date = typeof ts === 'string' ? ts.slice(0, 10) : undefined;
          if (!date) continue;
          const val = Array.isArray(dp.values) && dp.values.length > 0 ? Number(dp.values[0]) : 0;
          byDate[date] = (byDate[date] ?? 0) + val;
        }
      }
      usageArr = Object.entries(byDate).map(([date, cost_usd]) => ({ date, cost_usd }));
    } else if (Array.isArray(obj.usage)) usageArr = obj.usage;
    else if (Array.isArray((obj.data as Record<string, unknown>)?.usage)) usageArr = (obj.data as Record<string, unknown>).usage as typeof usageArr;
    else if (Array.isArray(obj.daily_usage)) usageArr = obj.daily_usage;
    else if (Array.isArray(obj.rows)) {
      usageArr = this.mapAnalyticsRowsToUsage(obj.rows as Array<Record<string, unknown>>);
    } else if (obj.data && typeof obj.data === 'object' && Array.isArray((obj.data as Record<string, unknown>).rows)) {
      usageArr = this.mapAnalyticsRowsToUsage((obj.data as Record<string, unknown>).rows as Array<Record<string, unknown>>);
    } else if (Array.isArray(obj)) usageArr = obj;

    if (!usageArr || usageArr.length === 0) return null;
    return { usage: usageArr };
  }
}
