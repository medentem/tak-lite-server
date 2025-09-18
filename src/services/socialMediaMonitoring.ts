import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { ThreatDetectionService } from './threatDetection';
import { SyncService } from './sync';
import { SocialMediaConfigService } from './socialMediaConfig';
import { logger } from '../utils/logger';

export interface SocialMediaMonitor {
  id: string;
  name: string;
  platform: string;
  api_provider: string;
  api_credentials: any;
  search_query: string;
  query_type: 'Latest' | 'Top';
  monitoring_interval: number;
  is_active: boolean;
  last_checked_at?: Date;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TwitterPost {
  id: string;
  text: string;
  author: {
    userName: string;
    name: string;
    location?: string;
    followers: number;
    isBlueVerified: boolean;
    profilePicture?: string;
  };
  retweetCount: number;
  likeCount: number;
  replyCount: number;
  quoteCount: number;
  viewCount?: number;
  createdAt: string;
  entities?: {
    hashtags: Array<{ text: string; indices: number[] }>;
    urls: Array<{ url: string; expanded_url: string; display_url: string }>;
    user_mentions: Array<{ screen_name: string; name: string; id_str: string }>;
  };
}

export class SocialMediaMonitoringService {
  private activeMonitors = new Map<string, NodeJS.Timeout>();
  
  constructor(
    private db: DatabaseService,
    private threatDetection: ThreatDetectionService,
    private syncService: SyncService,
    private configService: SocialMediaConfigService
  ) {}

  async createMonitor(monitorData: Partial<SocialMediaMonitor>, createdBy: string): Promise<SocialMediaMonitor> {
    const id = uuidv4();
    const monitor: SocialMediaMonitor = {
      id,
      name: monitorData.name!,
      platform: monitorData.platform || 'twitter',
      api_provider: monitorData.api_provider || 'twitterapi_io',
      api_credentials: monitorData.api_credentials!,
      search_query: monitorData.search_query!,
      query_type: monitorData.query_type || 'Latest',
      monitoring_interval: monitorData.monitoring_interval || 300,
      is_active: monitorData.is_active !== false,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    };

    await this.db.client('social_media_monitors').insert(monitor);
    
    logger.info('Created social media monitor', { id, name: monitor.name });
    
    // Start monitoring if active
    if (monitor.is_active) {
      await this.startMonitoring(id);
    }

    return monitor;
  }

  async getMonitors(): Promise<SocialMediaMonitor[]> {
    try {
      return await this.db.client('social_media_monitors')
        .orderBy('created_at', 'desc');
    } catch (error: any) {
      logger.error('Error getting monitors', { error: error.message });
      // Return empty array to prevent crashes
      return [];
    }
  }

  async getMonitor(monitorId: string): Promise<SocialMediaMonitor | null> {
    return await this.db.client('social_media_monitors')
      .where('id', monitorId)
      .first() || null;
  }

  async updateMonitor(monitorId: string, updates: Partial<SocialMediaMonitor>): Promise<SocialMediaMonitor> {
    const updateData = {
      ...updates,
      updated_at: new Date()
    };

    await this.db.client('social_media_monitors')
      .where('id', monitorId)
      .update(updateData);

    const updated = await this.getMonitor(monitorId);
    
    // Restart monitoring if settings changed
    if (updated && updated.is_active) {
      await this.startMonitoring(monitorId);
    } else {
      await this.stopMonitoring(monitorId);
    }

    logger.info('Updated social media monitor', { monitorId, updates });
    return updated!;
  }

  async deleteMonitor(monitorId: string): Promise<void> {
    await this.stopMonitoring(monitorId);
    await this.db.client('social_media_monitors')
      .where('id', monitorId)
      .del();
    
    logger.info('Deleted social media monitor', { monitorId });
  }

  async startMonitoring(monitorId: string): Promise<void> {
    // Check if service is globally enabled
    const serviceEnabled = await this.configService.isServiceEnabled();
    if (!serviceEnabled) {
      throw new Error('Social media monitoring service is disabled globally');
    }

    const monitor = await this.getMonitor(monitorId);
    if (!monitor || !monitor.is_active) {
      throw new Error('Monitor not found or inactive');
    }

    // Clear existing interval if any
    await this.stopMonitoring(monitorId);

    // Start new monitoring interval
    const interval = setInterval(async () => {
      try {
        // Check service status before each monitoring cycle
        const serviceEnabled = await this.configService.isServiceEnabled();
        if (!serviceEnabled) {
          logger.info('Service disabled globally, stopping monitor', { monitorId });
          await this.stopMonitoring(monitorId);
          return;
        }

        await this.checkForNewPosts(monitor);
      } catch (error) {
        logger.error('Error in monitoring interval', { monitorId, error });
      }
    }, monitor.monitoring_interval * 1000);

    this.activeMonitors.set(monitorId, interval);
    logger.info('Started monitoring', { monitorId, interval: monitor.monitoring_interval });
  }

  async stopMonitoring(monitorId: string): Promise<void> {
    const interval = this.activeMonitors.get(monitorId);
    if (interval) {
      clearInterval(interval);
      this.activeMonitors.delete(monitorId);
      logger.info('Stopped monitoring', { monitorId });
    }
  }

  async testConnection(apiKey: string, searchQuery: string): Promise<{ success: boolean; error?: string; samplePosts?: number }> {
    try {
      const response = await axios.get('https://api.twitterapi.io/twitter/tweet/advanced_search', {
        headers: {
          'X-API-Key': apiKey
        },
        params: {
          query: searchQuery,
          queryType: 'Latest',
          cursor: ''
        },
        timeout: 10000 // 10 second timeout
      });

      const posts = response.data.tweets || [];
      return {
        success: true,
        samplePosts: posts.length
      };
    } catch (error: any) {
      logger.error('Connection test failed', { error: error.message });
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Connection failed'
      };
    }
  }

  private async checkForNewPosts(monitor: SocialMediaMonitor): Promise<void> {
    try {
      const posts = await this.fetchPostsFromTwitterAPI(monitor);
      
      for (const post of posts) {
        // Check if post already exists
        const existing = await this.db.client('social_media_posts')
          .where({ monitor_id: monitor.id, platform_post_id: post.id })
          .first();

        if (!existing) {
          // Store new post
          const postId = await this.storePost(monitor.id, post);
          
          // Analyze for threats
          const threatAnalysis = await this.threatDetection.analyzePost(post);
          
          if (threatAnalysis && threatAnalysis.threat_level !== 'LOW') {
            await this.createThreatAnnotation(postId, threatAnalysis, post);
          }
        }
      }

      // Update last checked timestamp
      await this.db.client('social_media_monitors')
        .where('id', monitor.id)
        .update({ last_checked_at: new Date() });

      logger.debug('Checked for new posts', { 
        monitorId: monitor.id, 
        postsFound: posts.length
      });

    } catch (error) {
      logger.error('Error checking for new posts', { monitorId: monitor.id, error });
    }
  }

  private async fetchPostsFromTwitterAPI(monitor: SocialMediaMonitor): Promise<TwitterPost[]> {
    const response = await axios.get('https://api.twitterapi.io/twitter/tweet/advanced_search', {
      headers: {
        'X-API-Key': monitor.api_credentials.api_key
      },
      params: {
        query: monitor.search_query,
        queryType: monitor.query_type,
        cursor: '' // Start from beginning for each check
      },
      timeout: 30000 // 30 second timeout
    });

    return response.data.tweets || [];
  }

  private async storePost(monitorId: string, post: TwitterPost): Promise<string> {
    const postId = uuidv4();
    
    await this.db.client('social_media_posts').insert({
      id: postId,
      monitor_id: monitorId,
      platform_post_id: post.id,
      content: post.text,
      author_info: post.author,
      engagement_metrics: {
        retweetCount: post.retweetCount,
        likeCount: post.likeCount,
        replyCount: post.replyCount,
        quoteCount: post.quoteCount,
        viewCount: post.viewCount
      },
      entities: post.entities,
      raw_data: post
    });

    return postId;
  }

  private async createThreatAnnotation(
    postId: string, 
    threatAnalysis: any, 
    originalPost: TwitterPost
  ): Promise<void> {
    // Extract location from post or author
    const location = this.extractLocation(threatAnalysis, originalPost);
    
    if (location) {
      const annotationId = uuidv4();
      
      // Determine color and shape based on threat level
      const { color, shape } = this.getThreatVisual(threatAnalysis.threat_level);
      
      // Create TAK-Lite compatible annotation data
      const annotationData = {
        type: 'poi',
        position: { lt: location.lat, lng: location.lng },
        shape: shape,
        color: color,
        label: this.generateThreatLabel(threatAnalysis),
        description: threatAnalysis.ai_summary || 'Social media threat detected',
        timestamp: Date.now(),
        metadata: {
          source: 'social_media',
          threat_level: threatAnalysis.threat_level,
          threat_type: threatAnalysis.threat_type,
          confidence_score: threatAnalysis.confidence_score,
          source_post_url: `https://twitter.com/i/web/status/${originalPost.id}`,
          source_author: originalPost.author.userName,
          keywords: threatAnalysis.keywords || []
        }
      };

      // Store threat annotation in database (global, no team_id)
      await this.db.client('threat_annotations').insert({
        id: annotationId,
        threat_analysis_id: threatAnalysis.id,
        position: { lat: location.lat, lng: location.lng },
        threat_level: threatAnalysis.threat_level,
        threat_type: threatAnalysis.threat_type,
        title: this.generateThreatTitle(threatAnalysis),
        description: threatAnalysis.ai_summary,
        source_post_url: `https://twitter.com/i/web/status/${originalPost.id}`,
        source_author: originalPost.author.userName,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      });

      // Note: TAK-Lite annotation creation removed since we don't have a team context
      // The threat annotation is stored in the database for admin review

      // Note: Threat alert broadcasting removed since we don't have a team context
      // The threat annotation is stored in the database for admin review

      logger.info('Created threat annotation', { 
        annotationId, 
        threatLevel: threatAnalysis.threat_level,
        threatType: threatAnalysis.threat_type,
        color,
        shape
      });
    }
  }

  private extractLocation(threatAnalysis: any, post: TwitterPost): { lat: number; lng: number } | null {
    // Try to extract location from analysis first
    if (threatAnalysis.extracted_locations && threatAnalysis.extracted_locations.length > 0) {
      return threatAnalysis.extracted_locations[0];
    }
    
    // Try to extract from author location
    if (post.author.location) {
      // This would need geocoding in a real implementation
      // For now, return a default location
      return { lat: 47.6062, lng: -122.3321 }; // Seattle default
    }
    
    // No location found
    return null;
  }

  private generateThreatTitle(threatAnalysis: any): string {
    const type = threatAnalysis.threat_type?.toLowerCase().replace('_', ' ') || 'threat';
    return `${threatAnalysis.threat_level} ${type} detected`;
  }

  private getThreatVisual(threatLevel: string): { color: string; shape: string } {
    switch (threatLevel) {
      case 'CRITICAL':
        return { color: 'red', shape: 'exclamation' };
      case 'HIGH':
        return { color: 'red', shape: 'triangle' };
      case 'MEDIUM':
        return { color: 'yellow', shape: 'exclamation' };
      case 'LOW':
        return { color: 'yellow', shape: 'triangle' };
      default:
        return { color: 'yellow', shape: 'exclamation' };
    }
  }

  private generateThreatLabel(threatAnalysis: any): string {
    // Create a concise label for the map annotation
    const level = threatAnalysis.threat_level;
    const type = threatAnalysis.threat_type?.toLowerCase().replace('_', ' ') || 'threat';
    const summary = threatAnalysis.ai_summary || 'Threat detected';
    
    // Truncate summary if too long
    const maxLength = 50;
    const truncatedSummary = summary.length > maxLength 
      ? summary.substring(0, maxLength) + '...' 
      : summary;
    
    return `${level} ${type}: ${truncatedSummary}`;
  }

  private broadcastThreatAlert(teamId: string, threatData: any): void {
    // Access the socket gateway through the sync service
    const socketGateway = (this.syncService as any).socketGateway;
    if (socketGateway && typeof socketGateway.emitThreatAlert === 'function') {
      socketGateway.emitThreatAlert(teamId, threatData);
    } else {
      // Fallback: emit to all connected clients in the team
      logger.warn('Socket gateway not available for threat broadcast', { teamId });
    }
  }

  // Service-level controls
  async startAllMonitors(): Promise<{ started: number; failed: number; errors: string[] }> {
    const serviceEnabled = await this.configService.isServiceEnabled();
    if (!serviceEnabled) {
      throw new Error('Social media monitoring service is disabled globally');
    }

    const monitors = await this.db.client('social_media_monitors')
      .where('is_active', true);

    let started = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const monitor of monitors) {
      try {
        await this.startMonitoring(monitor.id);
        started++;
      } catch (error: any) {
        failed++;
        errors.push(`Monitor ${monitor.name}: ${error.message}`);
      }
    }

    logger.info('Started all monitors', { started, failed, total: monitors.length });
    return { started, failed, errors };
  }

  async stopAllMonitors(): Promise<{ stopped: number }> {
    const stopped = this.activeMonitors.size;
    
    for (const [monitorId, interval] of this.activeMonitors.entries()) {
      clearInterval(interval);
      logger.info('Stopped monitoring', { monitorId });
    }
    
    this.activeMonitors.clear();
    logger.info('Stopped all monitors', { stopped });
    return { stopped };
  }

  async getServiceStatus(): Promise<{
    service_enabled: boolean;
    active_monitors: number;
    total_monitors: number;
    estimated_monthly_cost: number;
    posts_processed_today: number;
  }> {
    return await this.configService.getServiceStatus();
  }

  async toggleService(enabled: boolean): Promise<void> {
    await this.configService.toggleService(enabled);
    
    if (enabled) {
      // Auto-start monitors if configured
      const config = await this.configService.getServiceConfig();
      if (config.auto_start_monitors) {
        await this.startAllMonitors();
      }
    } else {
      // Stop all monitors when service is disabled
      await this.stopAllMonitors();
    }
  }

  // Cleanup method for graceful shutdown
  async shutdown(): Promise<void> {
    for (const [monitorId, interval] of this.activeMonitors.entries()) {
      clearInterval(interval);
      logger.info('Stopped monitoring during shutdown', { monitorId });
    }
    this.activeMonitors.clear();
  }
}
