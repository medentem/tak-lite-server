import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { GrokService, GeographicalSearch, ThreatAnalysis as GrokThreatAnalysis } from './grokService';
import { SyncService } from './sync';
import { SocialMediaConfigService } from './socialMediaConfig';
import { logger } from '../utils/logger';

// Legacy interfaces removed - now using GeographicalSearch from GrokService

export class SocialMediaMonitoringService {
  private activeGeographicalSearches = new Map<string, NodeJS.Timeout>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;
  private grokService: GrokService;
  
  constructor(
    private db: DatabaseService,
    private syncService: SyncService,
    private configService: SocialMediaConfigService,
    private io?: any
  ) {
    this.grokService = new GrokService(db, io);
  }

  // Legacy monitor methods removed - use geographical monitoring instead

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

  // AI Configuration methods (moved from ThreatDetectionService)
  async getAIConfiguration(): Promise<any> {
    return await this.grokService.getGrokConfiguration();
  }

  async createAIConfiguration(configData: any, createdBy: string): Promise<any> {
    return await this.grokService.createGrokConfiguration(configData, createdBy);
  }

  async updateAIConfiguration(configId: string, updates: any): Promise<any> {
    return await this.grokService.updateGrokConfiguration(configId, updates);
  }

  async testAIConnection(apiKey: string, model: string = 'grok-4-fast-reasoning-latest'): Promise<{ success: boolean; error?: string; model?: string }> {
    return await this.grokService.testGrokConnection(apiKey, model);
  }

  // Threat analysis methods (moved from ThreatDetectionService)
  async getThreatAnalyses(filters: {
    threat_level?: string;
    threat_type?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    try {
      let query = this.db.client('threat_analyses')
        .select('*')
        .orderBy('created_at', 'desc');

      if (filters.threat_level) {
        query = query.where('threat_level', filters.threat_level);
      }

      if (filters.threat_type) {
        query = query.where('threat_type', filters.threat_type);
      }

      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      return await query;
    } catch (error: any) {
      logger.error('Error getting threat analyses', { error: error.message });
      return [];
    }
  }

  async getThreatStatistics(days: number = 7): Promise<{
    total_threats: number;
    by_level: Record<string, number>;
    by_type: Record<string, number>;
    recent_trend: Array<{ date: string; count: number }>;
  }> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get total threats
      const totalResult = await this.db.client('threat_analyses')
        .count('* as count')
        .where('created_at', '>=', startDate)
        .first();

      // Get threats by level
      const levelResults = await this.db.client('threat_analyses')
        .select('threat_level')
        .count('* as count')
        .where('created_at', '>=', startDate)
        .groupBy('threat_level');

      // Get threats by type
      const typeResults = await this.db.client('threat_analyses')
        .select('threat_type')
        .count('* as count')
        .where('created_at', '>=', startDate)
        .whereNotNull('threat_type')
        .groupBy('threat_type');

      // Get recent trend (daily counts)
      const trendResults = await this.db.client('threat_analyses')
        .select(this.db.client.raw('DATE(created_at) as date'))
        .count('* as count')
        .where('created_at', '>=', startDate)
        .groupBy(this.db.client.raw('DATE(created_at)'))
        .orderBy('date', 'asc');

      const byLevel: Record<string, number> = {};
      levelResults.forEach((row: any) => {
        byLevel[row.threat_level] = parseInt(String(row.count));
      });

      const byType: Record<string, number> = {};
      typeResults.forEach((row: any) => {
        byType[row.threat_type] = parseInt(String(row.count));
      });

      const recentTrend = trendResults.map((row: any) => ({
        date: row.date,
        count: parseInt(String(row.count))
      }));

      return {
        total_threats: parseInt(String(totalResult?.count || '0')),
        by_level: byLevel,
        by_type: byType,
        recent_trend: recentTrend
      };
    } catch (error: any) {
      logger.error('Error getting threat statistics', { error: error.message });
      return {
        total_threats: 0,
        by_level: {},
        by_type: {},
        recent_trend: []
      };
    }
  }

  async searchGeographicalThreats(geographicalArea: string, searchQuery?: string, lastSearchTime?: Date): Promise<GrokThreatAnalysis[]> {
    return await this.grokService.searchThreats(geographicalArea, searchQuery, lastSearchTime);
  }

  // New geographical monitoring methods
  async createGeographicalMonitor(monitorData: Partial<GeographicalSearch>, createdBy: string): Promise<GeographicalSearch> {
    return await this.grokService.createGeographicalSearch(monitorData, createdBy);
  }

  async getGeographicalMonitors(): Promise<(GeographicalSearch & { is_running: boolean })[]> {
    const searches = await this.grokService.getGeographicalSearches();
    const serviceEnabled = await this.configService.isServiceEnabled();
    
    // Add runtime status to each monitor
    return searches.map(search => ({
      ...search,
      is_running: this.activeGeographicalSearches.has(search.id) && serviceEnabled
    }));
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
    
    if (!search) {
      throw new Error('Geographical search not found');
    }

    // Clear existing interval if any (this will also update DB flag to false)
    await this.stopGeographicalMonitoring(monitorId);

    // Update database flag to active before starting
    await this.grokService.updateGeographicalSearch(monitorId, { is_active: true });

    // Start new monitoring interval
    const interval = setInterval(async () => {
      try {
        const serviceEnabled = await this.configService.isServiceEnabled();
        if (!serviceEnabled) {
          logger.info('Service disabled globally, stopping geographical search', { monitorId });
          await this.stopGeographicalMonitoring(monitorId);
          return;
        }

        // Refresh search data in case it was updated
        const currentSearches = await this.grokService.getGeographicalSearches();
        const currentSearch = currentSearches.find(s => s.id === monitorId);
        if (currentSearch) {
          await this.performGeographicalSearch(currentSearch);
        }
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
    
    // Always update database flag to inactive when stop is called
    // This ensures DB state matches runtime state even if monitor wasn't running
    try {
      await this.grokService.updateGeographicalSearch(monitorId, { is_active: false });
    } catch (error) {
      // Log but don't throw - monitor is stopped in memory even if DB update fails
      logger.warn('Failed to update monitor DB flag on stop', { monitorId, error });
    }
  }

  private async performGeographicalSearch(search: GeographicalSearch): Promise<void> {
    try {
      // Use the last search time to create a dynamic time window
      const lastSearchTime = search.last_searched_at;
      const threats = await this.grokService.searchThreats(
        search.geographical_area, 
        search.search_query || undefined, 
        lastSearchTime
      );
      
      for (const threat of threats) {
        await this.createThreatAnnotationFromGrok(threat, search);
      }
      
      // Update the last search time after successful search
      await this.grokService.updateLastSearchTime(search.id);

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
      team_id: null, // Global threat annotation - visible to all teams
      position: { 
        lat: (threat.locations[0]?.lat && !isNaN(threat.locations[0].lat)) ? threat.locations[0].lat : 0, 
        lng: (threat.locations[0]?.lng && !isNaN(threat.locations[0].lng)) ? threat.locations[0].lng : 0 
      },
      threat_level: threat.threat_level,
      threat_type: threat.threat_type,
      title: this.generateThreatTitle(threat),
      description: threat.summary,
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

    // Start geographical monitors only
    const geographicalSearches = await this.grokService.getGeographicalSearches();
    const activeSearches = geographicalSearches.filter(s => s.is_active);

    let started = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const search of activeSearches) {
      try {
        await this.startGeographicalMonitoring(search.id);
        started++;
      } catch (error: any) {
        failed++;
        errors.push(`Geographical Search ${search.geographical_area}: ${error.message}`);
      }
    }

    logger.info('Started all geographical monitors', { started, failed, total: activeSearches.length });
    return { started, failed, errors };
  }

  async stopAllMonitors(): Promise<{ stopped: number }> {
    let stopped = 0;
    
    // Stop geographical monitors
    for (const [monitorId, interval] of this.activeGeographicalSearches.entries()) {
      clearInterval(interval);
      logger.info('Stopped geographical monitoring', { monitorId });
      stopped++;
    }
    this.activeGeographicalSearches.clear();
    
    logger.info('Stopped all geographical monitors', { stopped });
    return { stopped };
  }

  async getServiceStatus(): Promise<{
    service_enabled: boolean;
    active_monitors: number;
    total_monitors: number;
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

  // Health monitoring methods
  startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        // Check if monitors are still running
        const expectedMonitors = await this.grokService.getGeographicalSearches();
        const activeMonitors = expectedMonitors.filter(s => s.is_active);
        
        for (const monitor of activeMonitors) {
          if (!this.activeGeographicalSearches.has(monitor.id)) {
            logger.warn('Monitor not running, restarting', { monitorId: monitor.id });
            await this.startGeographicalMonitoring(monitor.id);
          }
        }
      } catch (error) {
        logger.error('Health check failed', { error });
      }
    }, 60000); // Check every minute
  }

  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  startRecoveryMonitoring(): void {
    this.recoveryInterval = setInterval(async () => {
      try {
        await this.recoverFailedMonitors();
      } catch (error) {
        logger.error('Recovery monitoring failed', { error });
      }
    }, 300000); // Check every 5 minutes
  }

  stopRecoveryMonitoring(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
  }

  private async recoverFailedMonitors(): Promise<void> {
    try {
      const searches = await this.grokService.getGeographicalSearches();
      const activeSearches = searches.filter(s => s.is_active);
      
      for (const search of activeSearches) {
        if (!this.activeGeographicalSearches.has(search.id)) {
          logger.info('Recovering failed monitor', { monitorId: search.id });
          await this.startGeographicalMonitoring(search.id);
        }
      }
    } catch (error) {
      logger.error('Failed to recover monitors', { error });
    }
  }

  // Cleanup method for graceful shutdown
  async shutdown(): Promise<void> {
    // Stop health monitoring
    this.stopHealthMonitoring();
    this.stopRecoveryMonitoring();
    
    // Stop geographical monitors
    for (const [monitorId, interval] of this.activeGeographicalSearches.entries()) {
      clearInterval(interval);
      logger.info('Stopped geographical monitoring during shutdown', { monitorId });
    }
    this.activeGeographicalSearches.clear();
  }
}

