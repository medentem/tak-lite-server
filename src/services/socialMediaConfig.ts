import { DatabaseService } from './database';
import { logger } from '../utils/logger';

export interface SocialMediaServiceConfig {
  id: string;
  service_enabled: boolean;
  auto_start_monitors: boolean;
  max_monitors_per_team: number;
  default_monitoring_interval: number;
  service_settings: {
    max_posts_per_hour: number;
  };
  created_at: Date;
  updated_at: Date;
}

export class SocialMediaConfigService {
  private config: SocialMediaServiceConfig | null = null;
  private configUpdateCallbacks: Array<(config: SocialMediaServiceConfig) => void> = [];

  constructor(private db: DatabaseService) {}

  async getServiceConfig(): Promise<SocialMediaServiceConfig> {
    if (!this.config) {
      await this.loadConfig();
    }
    return this.config!;
  }

  async updateServiceConfig(updates: Partial<SocialMediaServiceConfig>): Promise<SocialMediaServiceConfig> {
    const currentConfig = await this.getServiceConfig();
    
    const updatedConfig = {
      ...currentConfig,
      ...updates,
      updated_at: new Date()
    };

    await this.db.client('social_media_service_config')
      .where('id', currentConfig.id)
      .update(updatedConfig);

    this.config = updatedConfig;
    
    // Notify callbacks
    this.configUpdateCallbacks.forEach(callback => {
      try {
        callback(updatedConfig);
      } catch (error) {
        logger.error('Error in config update callback', { error });
      }
    });

    logger.info('Updated social media service config', { 
      service_enabled: updatedConfig.service_enabled,
      updates 
    });

    return updatedConfig;
  }

  async toggleService(enabled: boolean): Promise<SocialMediaServiceConfig> {
    return await this.updateServiceConfig({ service_enabled: enabled });
  }

  async isServiceEnabled(): Promise<boolean> {
    const config = await this.getServiceConfig();
    return config.service_enabled;
  }


  async getUsageLimits(): Promise<{ max_monitors_per_team: number; max_posts_per_hour: number }> {
    const config = await this.getServiceConfig();
    return {
      max_monitors_per_team: config.max_monitors_per_team,
      max_posts_per_hour: config.service_settings.max_posts_per_hour
    };
  }

  async updateUsageLimits(limits: { max_monitors_per_team?: number; max_posts_per_hour?: number }): Promise<void> {
    const currentConfig = await this.getServiceConfig();
    const updates: Partial<SocialMediaServiceConfig> = {};
    
    if (limits.max_monitors_per_team !== undefined) {
      updates.max_monitors_per_team = limits.max_monitors_per_team;
    }
    
    if (limits.max_posts_per_hour !== undefined) {
      updates.service_settings = {
        ...currentConfig.service_settings,
        max_posts_per_hour: limits.max_posts_per_hour
      };
    }

    await this.updateServiceConfig(updates);
  }

  // Subscribe to configuration changes
  onConfigUpdate(callback: (config: SocialMediaServiceConfig) => void): () => void {
    this.configUpdateCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.configUpdateCallbacks.indexOf(callback);
      if (index > -1) {
        this.configUpdateCallbacks.splice(index, 1);
      }
    };
  }

  // Get service status summary
  async getServiceStatus(): Promise<{
    service_enabled: boolean;
    total_monitors: number;
    active_monitors: number;
    estimated_monthly_cost: number;
    posts_processed_today: number;
  }> {
    const config = await this.getServiceConfig();
    
    // Get monitor statistics
    const monitorStats = await this.db.client('social_media_monitors')
      .select(
        this.db.client.raw('COUNT(*) as total_monitors'),
        this.db.client.raw('COUNT(CASE WHEN is_active = true THEN 1 END) as active_monitors'),
        this.db.client.raw('SUM(posts_processed_today) as posts_processed_today')
      )
      .first();

    // Estimate monthly cost (rough calculation)
    const estimatedMonthlyCost = this.estimateMonthlyCost(
      monitorStats.active_monitors || 0,
      monitorStats.posts_processed_today || 0
    );

    return {
      service_enabled: config.service_enabled,
      total_monitors: parseInt(monitorStats.total_monitors) || 0,
      active_monitors: parseInt(monitorStats.active_monitors) || 0,
      estimated_monthly_cost: estimatedMonthlyCost,
      posts_processed_today: parseInt(monitorStats.posts_processed_today) || 0
    };
  }

  private async loadConfig(): Promise<void> {
    const config = await this.db.client('social_media_service_config')
      .first();

    if (!config) {
      // Create default config if none exists
      const defaultConfig = {
        id: require('uuid').v4(),
        service_enabled: false,
        auto_start_monitors: false,
        max_monitors_per_team: 5,
        default_monitoring_interval: 300,
        service_settings: {
          max_posts_per_hour: 1000
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.db.client('social_media_service_config').insert(defaultConfig);
      this.config = defaultConfig;
    } else {
      this.config = config;
    }
  }

  private estimateMonthlyCost(activeMonitors: number, postsToday: number): number {
    // Rough cost estimation based on typical API pricing
    const twitterApiCostPerPost = 0.001; // $0.001 per post (estimated)
    const openAiCostPerPost = 0.002; // $0.002 per post (estimated)
    const baseCost = 50; // Base monthly cost for TwitterAPI.io

    const dailyPosts = postsToday;
    const monthlyPosts = dailyPosts * 30;
    const totalCost = baseCost + (monthlyPosts * (twitterApiCostPerPost + openAiCostPerPost));

    return Math.round(totalCost * 100) / 100; // Round to 2 decimal places
  }

  // Reset daily usage counters (should be called daily)
  async resetDailyUsage(): Promise<void> {
    await this.db.client('social_media_monitors')
      .update({
        posts_processed_today: 0,
        last_cost_check: new Date()
      });

    logger.info('Reset daily usage counters for social media monitors');
  }

}
