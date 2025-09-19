import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { ThreatDetectionService } from './threatDetection';
import { GrokService, GeographicalSearch } from './grokService';
import { SyncService } from './sync';
import { SocialMediaConfigService } from './socialMediaConfig';
import { logger } from '../utils/logger';

// Legacy interfaces removed - now using GeographicalSearch from GrokService

export class SocialMediaMonitoringService {
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
    // Stop geographical monitors
    for (const [monitorId, interval] of this.activeGeographicalSearches.entries()) {
      clearInterval(interval);
      logger.info('Stopped geographical monitoring during shutdown', { monitorId });
    }
    this.activeGeographicalSearches.clear();
  }
}

