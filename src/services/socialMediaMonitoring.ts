import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { ThreatDetectionService } from './threatDetection';
import { GrokService, GeographicalSearch } from './grokService';
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

// Legacy interface - now using GeographicalSearch from GrokService
export interface GeographicalMonitor {
  id: string;
  name: string;
  geographical_area: string;
  search_query?: string;
  monitoring_interval: number;
  is_active: boolean;
  last_searched_at?: Date;
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
  private activeGeographicalSearches = new Map<string, NodeJS.Timeout>();
  private grokService: GrokService;
  
  constructor(
    private db: DatabaseService,
    private threatDetection: ThreatDetectionService,
    private syncService: SyncService,
    private configService: SocialMediaConfigService
  ) {
    this.grokService = new GrokService(db);
  }

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

        // Legacy monitoring disabled - using Grok geographical search instead
        logger.warn('Legacy monitoring attempted - please use geographical monitoring', { monitorId: monitor.id });
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
    // Test Grok API connection instead of Twitter API
    const result = await this.grokService.testGrokConnection(apiKey);
    if (result.success) {
      return {
        success: true,
        samplePosts: 0 // Grok doesn't return sample posts in connection test
      };
    } else {
      return {
        success: false,
        error: result.error || 'Connection failed'
      };
    }
  }

  // New geographical monitoring methods
  async createGeographicalMonitor(monitorData: Partial<GeographicalSearch>, createdBy: string): Promise<GeographicalSearch> {
    return await this.grokService.createGeographicalSearch(monitorData, createdBy);
  }

  async getGeographicalMonitors(): Promise<GeographicalSearch[]> {
    return await this.grokService.getGeographicalSearches();
  }

  async updateGeographicalMonitor(monitorId: string, updates: Partial<GeographicalSearch>): Promise<GeographicalSearch> {
    return await this.grokService.updateGeographicalSearch(monitorId, updates);
  }

  async deleteGeographicalMonitor(monitorId: string): Promise<void> {
    await this.stopGeographicalMonitoring(monitorId);
    await this.grokService.deleteGeographicalSearch(monitorId);
  }

  async startGeographicalMonitoring(monitorId: string): Promise<void> {
    const serviceEnabled = await this.configService.isServiceEnabled();
    if (!serviceEnabled) {
      throw new Error('Social media monitoring service is disabled globally');
    }

    const searches = await this.grokService.getGeographicalSearches();
    const search = searches.find(s => s.id === monitorId);
    
    if (!search || !search.is_active) {
      throw new Error('Geographical search not found or inactive');
    }

    // Clear existing interval if any
    await this.stopGeographicalMonitoring(monitorId);

    // Start new monitoring interval
    const interval = setInterval(async () => {
      try {
        const serviceEnabled = await this.configService.isServiceEnabled();
        if (!serviceEnabled) {
          logger.info('Service disabled globally, stopping geographical search', { monitorId });
          await this.stopGeographicalMonitoring(monitorId);
          return;
        }

        await this.performGeographicalSearch(search);
      } catch (error) {
        logger.error('Error in geographical monitoring interval', { monitorId, error });
      }
    }, search.monitoring_interval * 1000);

    this.activeGeographicalSearches.set(monitorId, interval);
    logger.info('Started geographical monitoring', { monitorId, interval: search.monitoring_interval });
  }

  async stopGeographicalMonitoring(monitorId: string): Promise<void> {
    const interval = this.activeGeographicalSearches.get(monitorId);
    if (interval) {
      clearInterval(interval);
      this.activeGeographicalSearches.delete(monitorId);
      logger.info('Stopped geographical monitoring', { monitorId });
    }
  }

  private async performGeographicalSearch(search: GeographicalSearch): Promise<void> {
    try {
      const threats = await this.grokService.searchThreats(search.geographical_area, search.search_query || undefined);
      
      for (const threat of threats) {
        await this.createThreatAnnotationFromGrok(threat, search);
      }

      // Update last searched timestamp
      await this.grokService.updateGeographicalSearch(search.id, { last_searched_at: new Date() });

      logger.debug('Performed geographical search', { 
        searchId: search.id, 
        threatsFound: threats.length
      });

    } catch (error) {
      logger.error('Error performing geographical search', { searchId: search.id, error });
    }
  }

  private async createThreatAnnotationFromGrok(threat: any, search: GeographicalSearch): Promise<void> {
    if (threat.threat_level === 'LOW') {
      return; // Skip low-level threats
    }

    const annotationId = uuidv4();
    
    // Determine color and shape based on threat level
    const { color, shape } = this.getThreatVisual(threat.threat_level);
    
    // Create TAK-Lite compatible annotation data
    const annotationData = {
      type: 'poi',
      position: { lt: threat.locations[0]?.lat || 0, lng: threat.locations[0]?.lng || 0 },
      shape: shape,
      color: color,
      label: this.generateThreatLabel(threat),
      description: threat.summary || 'Geographical threat detected',
      timestamp: Date.now(),
      metadata: {
        source: 'grok_geographical_search',
        threat_level: threat.threat_level,
        threat_type: threat.threat_type,
        confidence_score: threat.confidence_score,
        geographical_area: search.geographical_area,
        search_query: search.search_query,
        keywords: threat.keywords || []
      }
    };

    // Store threat annotation in database
    await this.db.client('threat_annotations').insert({
      id: annotationId,
      threat_analysis_id: threat.id,
      position: { lat: threat.locations[0]?.lat || 0, lng: threat.locations[0]?.lng || 0 },
      threat_level: threat.threat_level,
      threat_type: threat.threat_type,
      title: this.generateThreatTitle(threat),
      description: threat.summary,
      source_post_url: null, // No specific post for geographical searches
      source_author: 'Grok Geographical Search',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });

    logger.info('Created threat annotation from Grok', { 
      annotationId, 
      threatLevel: threat.threat_level,
      threatType: threat.threat_type,
      color,
      shape
    });
  }

  // Legacy Twitter API methods removed - now using Grok geographical search

  // Legacy threat annotation methods removed - now handled by createThreatAnnotationFromGrok

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

    // Start legacy monitors
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

    // Start geographical monitors
    const geographicalSearches = await this.grokService.getGeographicalSearches();
    const activeSearches = geographicalSearches.filter(s => s.is_active);

    for (const search of activeSearches) {
      try {
        await this.startGeographicalMonitoring(search.id);
        started++;
      } catch (error: any) {
        failed++;
        errors.push(`Geographical Search ${search.geographical_area}: ${error.message}`);
      }
    }

    logger.info('Started all monitors', { started, failed, total: monitors.length + activeSearches.length });
    return { started, failed, errors };
  }

  async stopAllMonitors(): Promise<{ stopped: number }> {
    let stopped = 0;
    
    // Stop legacy monitors
    for (const [monitorId, interval] of this.activeMonitors.entries()) {
      clearInterval(interval);
      logger.info('Stopped monitoring', { monitorId });
      stopped++;
    }
    this.activeMonitors.clear();
    
    // Stop geographical monitors
    for (const [monitorId, interval] of this.activeGeographicalSearches.entries()) {
      clearInterval(interval);
      logger.info('Stopped geographical monitoring', { monitorId });
      stopped++;
    }
    this.activeGeographicalSearches.clear();
    
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
    // Stop legacy monitors
    for (const [monitorId, interval] of this.activeMonitors.entries()) {
      clearInterval(interval);
      logger.info('Stopped monitoring during shutdown', { monitorId });
    }
    this.activeMonitors.clear();
    
    // Stop geographical monitors
    for (const [monitorId, interval] of this.activeGeographicalSearches.entries()) {
      clearInterval(interval);
      logger.info('Stopped geographical monitoring during shutdown', { monitorId });
    }
    this.activeGeographicalSearches.clear();
  }
}

