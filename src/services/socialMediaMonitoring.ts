import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { GrokService, GeographicalSearch, ThreatAnalysis as GrokThreatAnalysis } from './grokService';
import { SyncService } from './sync';
import { SocialMediaConfigService } from './socialMediaConfig';
import { X_SEARCH_COST_PER_CALL_USD } from './grokPricing';
import { logger } from '../utils/logger';
import { geocodeAddress } from '../utils/geocode';

// Legacy interfaces removed - now using GeographicalSearch from GrokService

/** Max concurrent Grok geographical searches to avoid API bursts and rate limits. */
const MAX_CONCURRENT_GEOGRAPHICAL_SEARCHES = 2;
/** Stagger window for first run when starting a single monitor (seconds). */
const STAGGER_FIRST_RUN_WINDOW_SEC = 90;
/** Delay between starting each monitor when starting all (ms), so first runs don't burst. */
const START_ALL_STAGGER_MS = 15_000;

export class SocialMediaMonitoringService {
  private activeGeographicalSearches = new Map<string, { interval?: NodeJS.Timeout; initialTimeout?: NodeJS.Timeout }>();
  private concurrentSearches = 0;
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

  async suggestWebNewsSources(geographicalArea: string, searchQuery?: string): Promise<string[]> {
    return await this.grokService.suggestWebNewsSourcesForArea(geographicalArea, searchQuery);
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

  async getMonitorRunLogs(monitorId: string): Promise<Array<{
    id: string;
    run_at: string;
    system_prompt: string;
    user_prompt: string;
    response_raw: string;
    threats_found: number;
  }>> {
    return await this.grokService.getMonitorRunLogs(monitorId);
  }

  /**
   * Stagger delay for first run (ms) from monitor id so multiple monitors don't all fire at once.
   */
  private staggerDelayMs(monitorId: string): number {
    const hash = Math.abs(
      monitorId.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0)
    );
    return (hash % STAGGER_FIRST_RUN_WINDOW_SEC) * 1000;
  }

  /**
   * @param optionalFirstRunDelayMs - When starting all monitors, pass index * START_ALL_STAGGER_MS to spread first runs.
   */
  async startGeographicalMonitoring(monitorId: string, optionalFirstRunDelayMs?: number): Promise<void> {
    const serviceEnabled = await this.configService.isServiceEnabled();
    if (!serviceEnabled) {
      throw new Error('Social media monitoring service is disabled globally');
    }

    const searches = await this.grokService.getGeographicalSearches();
    const search = searches.find(s => s.id === monitorId);
    
    if (!search) {
      throw new Error('Geographical search not found');
    }

    // Clear existing interval/timeout if any (this will also update DB flag to false)
    await this.stopGeographicalMonitoring(monitorId);

    // Update database flag to active before starting
    await this.grokService.updateGeographicalSearch(monitorId, { is_active: true });

    const intervalMs = search.monitoring_interval * 1000;

    const runSearch = async (): Promise<void> => {
      try {
        const serviceEnabled = await this.configService.isServiceEnabled();
        if (!serviceEnabled) {
          logger.info('Service disabled globally, stopping geographical search', { monitorId });
          await this.stopGeographicalMonitoring(monitorId);
          return;
        }
        if (this.concurrentSearches >= MAX_CONCURRENT_GEOGRAPHICAL_SEARCHES) {
          logger.debug('Skipping geographical search (concurrency limit)', { monitorId });
          return;
        }
        const currentSearches = await this.grokService.getGeographicalSearches();
        const currentSearch = currentSearches.find(s => s.id === monitorId);
        if (!currentSearch) return;
        this.concurrentSearches++;
        try {
          await this.performGeographicalSearch(currentSearch);
        } finally {
          this.concurrentSearches--;
        }
      } catch (error) {
        logger.error('Error in geographical monitoring interval', { monitorId, error });
      }
    };

    const firstRunDelayMs = optionalFirstRunDelayMs ?? this.staggerDelayMs(monitorId);
    const initialTimeout = setTimeout(() => {
      runSearch().catch((err) => logger.error('Error on initial geographical search', { monitorId, error: err }));
      const interval = setInterval(runSearch, intervalMs);
      const entry = this.activeGeographicalSearches.get(monitorId);
      if (entry) {
        entry.interval = interval;
        entry.initialTimeout = undefined;
      }
    }, firstRunDelayMs);

    this.activeGeographicalSearches.set(monitorId, { initialTimeout });
    logger.info('Started geographical monitoring', {
      monitorId,
      interval: search.monitoring_interval,
      firstRunDelayMs,
    });
  }

  async stopGeographicalMonitoring(monitorId: string): Promise<void> {
    const entry = this.activeGeographicalSearches.get(monitorId);
    if (entry) {
      if (entry.initialTimeout) clearTimeout(entry.initialTimeout);
      if (entry.interval) clearInterval(entry.interval);
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
        lastSearchTime,
        search.id,
        search.web_news_domains ?? undefined
      );

      logger.info('Geographical search completed: processing threats for auto-create', {
        searchId: search.id,
        geographical_area: search.geographical_area,
        threatsReturned: threats.length,
        threatIds: threats.map((t: any) => t.id),
        threatLevels: threats.map((t: any) => t.threat_level)
      });

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

  /**
   * Resolve lat/lng for a threat location. When the location has a specific address or place name
   * (name or area_description), geocode it so the map pin matches the address. Otherwise fall
   * back to Grok's lat/lng (e.g. when only coordinates or a vague area are mentioned).
   * Returns geocoded: true when an address was successfully geocoded (caller can treat as precise POI).
   */
  private async resolveLocationCoordinates(location: { lat: number; lng: number; name?: string; area_description?: string }): Promise<{ lat: number; lng: number; geocoded: boolean }> {
    const address = [location.name, location.area_description].filter(Boolean).map(String).find(s => s.trim().length >= 3);
    if (address) {
      try {
        const geocoded = await geocodeAddress(address);
        if (geocoded) {
          logger.debug('Geocoded threat address for annotation', { address: address.slice(0, 60), lat: geocoded.lat, lng: geocoded.lng });
          return { lat: geocoded.lat, lng: geocoded.lng, geocoded: true };
        }
      } catch (err) {
        logger.debug('Geocoding failed, using threat coordinates', { address: address.slice(0, 40), error: err instanceof Error ? err.message : err });
      }
    }
    // No address/specific location mentioned — use Grok's lt/lng
    return { lat: location.lat, lng: location.lng, geocoded: false };
  }

  private async createThreatAnnotationFromGrok(threat: any, search: GeographicalSearch): Promise<void> {
    const hasLocations = Array.isArray(threat.locations) && threat.locations.length > 0;
    logger.debug('createThreatAnnotationFromGrok: evaluating threat', {
      threatId: threat.id,
      threat_level: threat.threat_level,
      hasLocations,
      locationsLength: threat.locations?.length ?? 0,
      searchId: search.id,
      geographical_area: search.geographical_area
    });

    if (threat.threat_level === 'LOW') {
      logger.debug('Auto-create skipped: threat level is LOW', { threatId: threat.id });
      return; // Skip low-level threats
    }

    // Run auto-create map annotation first when enabled, so it is never blocked by legacy insert failures
    const config = await this.configService.refreshConfig();
    const autoCreateEnabled = !!config.auto_create_annotations;
    const hasThreatId = !!threat.id;

    if (!autoCreateEnabled) {
      logger.debug('Auto-create skipped: config.auto_create_annotations is false', {
        threatId: threat.id,
        auto_create_annotations: config.auto_create_annotations
      });
    } else if (!hasThreatId) {
      logger.warn('Auto-create skipped: threat has no id', { threat_level: threat.threat_level, hasLocations });
    } else if (!hasLocations) {
      logger.warn('Auto-create skipped: threat has no valid locations', {
        threatId: threat.id,
        threat_level: threat.threat_level,
        locationsType: typeof threat.locations,
        locationsLength: threat.locations?.length ?? 0
      });
    }

    if (config.auto_create_annotations && threat.id && Array.isArray(threat.locations) && threat.locations.length > 0) {
      logger.info('Auto-create: attempting to create map annotation from threat', {
        threatId: threat.id,
        threat_level: threat.threat_level,
        locationsCount: threat.locations.length
      });
      try {
        await this.createMapAnnotationFromThreat(threat);
      } catch (err) {
        logger.error('Auto-create map annotation from threat failed', {
          threatId: threat.id,
          error: err instanceof Error ? err.message : err,
          stack: err instanceof Error ? err.stack : undefined
        });
      }
    }

    const annotationId = uuidv4();
    const { color, shape } = this.getThreatVisual(threat.threat_level);
    const firstLoc = threat.locations[0];
    const resolved = firstLoc ? await this.resolveLocationCoordinates(firstLoc) : { lat: 0, lng: 0, geocoded: false };
    const annotationData = {
      type: 'poi',
      position: { lt: resolved.lat, lng: resolved.lng },
      shape: shape,
      color: color,
      label: this.generateThreatLabel({ ...threat, ai_summary: threat.summary }),
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

    try {
      await this.db.client('threat_annotations').insert({
        id: annotationId,
        threat_analysis_id: threat.id,
        team_id: null,
        position: {
          lat: (resolved.lat != null && !isNaN(resolved.lat)) ? resolved.lat : 0,
          lng: (resolved.lng != null && !isNaN(resolved.lng)) ? resolved.lng : 0
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
    } catch (err) {
      logger.warn('Legacy threat_annotations insert failed (map annotation may still have been created)', {
        threatId: threat.id,
        annotationId,
        error: err
      });
    }
  }

  /**
   * Decide whether to create a POI (point) or area (circle) for a threat location.
   * Prefer POI when we have a precise location (e.g. successfully geocoded address).
   * Use area only when the location is still uncertain (explicit radius, inferred, or very low confidence).
   */
  private determineAnnotationType(
    location: { radius_km?: number; confidence?: number; source?: string; name?: string; area_description?: string },
    wasGeocoded: boolean
  ): 'poi' | 'area' {
    if (wasGeocoded) return 'poi';
    const hasSpecificPlace = [location.name, location.area_description].some(s => s && String(s).trim().length >= 3);
    const hasExplicitRadius = typeof location.radius_km === 'number' && location.radius_km > 0;
    const isInferred = location.source === 'inferred';
    const confidence = location.confidence ?? 0.5;
    const veryLowConfidence = confidence < 0.5;
    if (hasExplicitRadius) return 'area';
    if (isInferred && !hasSpecificPlace) return 'area';
    if (veryLowConfidence && !hasSpecificPlace) return 'area';
    return 'poi';
  }

  /**
   * Creates a map annotation (annotations table) from a threat and marks the threat as approved.
   * Used when "Automatically Create Annotations" is enabled to bypass the admin review flow.
   */
  private async createMapAnnotationFromThreat(threat: GrokThreatAnalysis): Promise<void> {
    logger.debug('createMapAnnotationFromThreat: starting', {
      threatId: threat.id,
      locationsCount: threat.locations?.length ?? 0,
      firstLocation: threat.locations?.[0] ? {
        lat: threat.locations[0].lat,
        lng: threat.locations[0].lng,
        latType: typeof threat.locations[0].lat,
        lngType: typeof threat.locations[0].lng
      } : null
    });

    const primaryLocation = threat.locations[0];
    if (!primaryLocation || typeof primaryLocation.lat !== 'number' || typeof primaryLocation.lng !== 'number' ||
        isNaN(primaryLocation.lat) || isNaN(primaryLocation.lng) ||
        !isFinite(primaryLocation.lat) || !isFinite(primaryLocation.lng)) {
      logger.warn('Skipping auto-create map annotation: invalid threat location', {
        threatId: threat.id,
        hasPrimaryLocation: !!primaryLocation,
        lat: primaryLocation?.lat,
        lng: primaryLocation?.lng,
        latType: primaryLocation ? typeof primaryLocation.lat : 'n/a',
        lngType: primaryLocation ? typeof primaryLocation.lng : 'n/a'
      });
      return;
    }

    const resolvedCoords = await this.resolveLocationCoordinates(primaryLocation);

    const threatLevelColors: Record<string, string> = {
      LOW: 'green',
      MEDIUM: 'yellow',
      HIGH: 'red',
      CRITICAL: 'black'
    };
    const color = threatLevelColors[threat.threat_level] || 'red';
    const label = `${threat.threat_level} Threat: ${threat.threat_type || 'Unknown'}`;
    // Use POI when location is precise (e.g. geocoded); use area when uncertain. Area size is clamped to minimum for tappability.
    const annotationType = this.determineAnnotationType(primaryLocation, resolvedCoords.geocoded);

    // Expiration: auto-created annotations expire after configured minutes (no operator to remove/update)
    const config = await this.configService.getServiceConfig();
    const expireMinutes = Math.max(1, config.auto_annotation_expire_minutes ?? 120);
    const expirationTimeMs = Date.now() + expireMinutes * 60 * 1000;

    // Extract citation URLs so clients can open sources (e.g. Android "Open source" link)
    const rawCitations = Array.isArray(threat.citations) ? threat.citations : [];
    const citationUrls = rawCitations
      .map((c: unknown) => (typeof c === 'string' ? c : (c && typeof c === 'object' && typeof (c as { url?: string }).url === 'string' ? (c as { url: string }).url : null)))
      .filter((u: string | null): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u: string) => u.trim());

    /** Minimum area radius in meters so circles are visible and tappable on all clients (e.g. Android at zoom 5+). */
    const MIN_AREA_RADIUS_METERS = 250;
    const annotationData: any = {
      color,
      shape: 'exclamation',
      label,
      description: threat.summary || '',
      timestamp: Date.now(),
      expirationTime: expirationTimeMs,
      threatInfo: {
        threatId: threat.id,
        threatLevel: threat.threat_level,
        threatType: threat.threat_type,
        confidenceScore: threat.confidence_score,
        summary: threat.summary,
        source: 'AI Threat Detection (Auto)',
        locationConfidence: primaryLocation.confidence,
        locationSource: primaryLocation.source,
        citationUrls
      }
    };
    if (annotationType === 'area') {
      annotationData.center = { lng: resolvedCoords.lng, lt: resolvedCoords.lat };
      const radiusMeters = (primaryLocation.radius_km ?? 1.0) * 1000;
      annotationData.radius = Math.max(radiusMeters, MIN_AREA_RADIUS_METERS);
    } else {
      annotationData.position = { lng: resolvedCoords.lng, lt: resolvedCoords.lat };
    }

    const annotationId = uuidv4();
    // user_id is UUID; use null for system/auto-created annotations (column is nullable)
    const userId: string | null = null;
    const teamId: string | null = null;

    logger.debug('createMapAnnotationFromThreat: inserting annotation and updating threat_analyses', {
      threatId: threat.id,
      annotationId,
      annotationType
    });

    await this.db.client('annotations').insert({
      id: annotationId,
      user_id: userId,
      team_id: teamId,
      type: annotationType,
      data: annotationData,
      created_at: this.db.client.fn.now(),
      updated_at: this.db.client.fn.now()
    });

    const updateCount = await this.db.client('threat_analyses')
      .where('id', threat.id)
      .update({
        admin_status: 'approved',
        annotation_id: annotationId,
        reviewed_by: null,
        reviewed_at: new Date()
      });

    if (updateCount === 0) {
      logger.warn('createMapAnnotationFromThreat: threat_analyses update matched 0 rows', {
        threatId: threat.id,
        annotationId
      });
    }

    if (this.io) {
      this.io.emit('admin:threat_annotation_created', {
        threatId: threat.id,
        annotationId,
        teamId,
        threatLevel: threat.threat_level,
        threatType: threat.threat_type,
        location: primaryLocation
      });
      this.io.emit('admin:annotation_update', {
        id: annotationId,
        teamId,
        type: annotationType,
        data: annotationData,
        userId,
        userName: 'System (Threat Detection)',
        userEmail: 'system@threat-detection',
        timestamp: new Date().toISOString(),
        source: 'threat_approval'
      });
      // Use placeholder creatorId when userId is null so clients (e.g. Android) that require non-null creatorId can deserialize
      const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';
      const clientData = {
        ...annotationData,
        type: annotationType,
        id: annotationId,
        creatorId: userId ?? SYSTEM_USER_ID,
        creatorUsername: 'System (Threat Detection)',
        source: 'server',
        originalSource: 'server'
      };
      this.io.to('global').emit('annotation:update', {
        id: annotationId,
        teamId,
        type: annotationType,
        data: JSON.stringify(clientData),
        userId,
        userName: 'System (Threat Detection)',
        userEmail: 'system@threat-detection',
        timestamp: new Date().toISOString(),
        source: 'threat_approval'
      });
      this.io.emit('admin:sync_activity', {
        type: 'annotation_update',
        details: `System auto-created threat annotation ${annotationId} from threat ${threat.id} (Automatically Create Annotations enabled)`
      });
    }

    logger.info('Auto-created map annotation from threat (bypassing review)', {
      threatId: threat.id,
      annotationId,
      threatLevel: threat.threat_level
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

    for (let index = 0; index < activeSearches.length; index++) {
      const search = activeSearches[index];
      try {
        const firstRunDelayMs = index * START_ALL_STAGGER_MS;
        await this.startGeographicalMonitoring(search.id, firstRunDelayMs);
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
    
    // Get all monitor IDs that are currently running
    const runningMonitorIds = Array.from(this.activeGeographicalSearches.keys());
    
    // Stop geographical monitors
    for (const [monitorId, entry] of this.activeGeographicalSearches.entries()) {
      if (entry.initialTimeout) clearTimeout(entry.initialTimeout);
      if (entry.interval) clearInterval(entry.interval);
      logger.info('Stopped geographical monitoring', { monitorId });
      stopped++;
    }
    this.activeGeographicalSearches.clear();
    
    // Update all stopped monitors' DB flags to inactive
    // This ensures DB state matches runtime state
    if (runningMonitorIds.length > 0) {
      try {
        await this.db.client('geographical_searches')
          .whereIn('id', runningMonitorIds)
          .update({ 
            is_active: false, 
            updated_at: new Date() 
          });
        logger.info('Updated DB flags for stopped monitors', { count: runningMonitorIds.length });
      } catch (error) {
        logger.error('Failed to update DB flags for stopped monitors', { error });
        // Don't throw - monitors are stopped in memory even if DB update fails
      }
    }
    
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

  /**
   * Get AI usage summary and cost forecast for the social media monitoring service.
   * Accounts for configured intervals, prompt/completion tokens, and active monitors.
   */
  async getAIUsageSummary(): Promise<{
    today: { cost_usd: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; api_calls: number; search_calls: number };
    month: { cost_usd: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; api_calls: number; search_calls: number };
    last_24h: { cost_usd: number; search_calls: number };
    forecast: {
      cost_today_remaining_usd: number;
      cost_month_forecast_usd: number;
      daily_calls_at_current_setup: number;
      active_monitors_in_forecast: number;
    };
  }> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOf24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const defaultSummary = {
      today: { cost_usd: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, api_calls: 0, search_calls: 0 },
      month: { cost_usd: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, api_calls: 0, search_calls: 0 },
      last_24h: { cost_usd: 0, search_calls: 0 },
      forecast: {
        cost_today_remaining_usd: 0,
        cost_month_forecast_usd: 0,
        daily_calls_at_current_setup: 0,
        active_monitors_in_forecast: 0,
      },
    };

    try {
      const hasTable = await this.db.client.schema.hasTable('ai_usage_log');
      if (!hasTable) return defaultSummary;

      const todayRows = await this.db.client('ai_usage_log')
        .where('created_at', '>=', startOfToday)
        .select(
          this.db.client.raw('COALESCE(SUM(estimated_cost_usd), 0) as cost_usd'),
          this.db.client.raw('COALESCE(SUM(prompt_tokens), 0) as prompt_tokens'),
          this.db.client.raw('COALESCE(SUM(completion_tokens), 0) as completion_tokens'),
          this.db.client.raw('COALESCE(SUM(total_tokens), 0) as total_tokens'),
          this.db.client.raw('COUNT(*)::int as api_calls'),
          this.db.client.raw("COUNT(*) FILTER (WHERE call_type = 'search')::int as search_calls")
        )
        .first();

      const monthRows = await this.db.client('ai_usage_log')
        .where('created_at', '>=', startOfMonth)
        .select(
          this.db.client.raw('COALESCE(SUM(estimated_cost_usd), 0) as cost_usd'),
          this.db.client.raw('COALESCE(SUM(prompt_tokens), 0) as prompt_tokens'),
          this.db.client.raw('COALESCE(SUM(completion_tokens), 0) as completion_tokens'),
          this.db.client.raw('COALESCE(SUM(total_tokens), 0) as total_tokens'),
          this.db.client.raw('COUNT(*)::int as api_calls'),
          this.db.client.raw("COUNT(*) FILTER (WHERE call_type = 'search')::int as search_calls")
        )
        .first();

      const last24hRows = await this.db.client('ai_usage_log')
        .where('created_at', '>=', startOf24h)
        .select(
          this.db.client.raw('COALESCE(SUM(estimated_cost_usd), 0) as cost_usd'),
          this.db.client.raw("COUNT(*) FILTER (WHERE call_type = 'search')::int as search_calls")
        )
        .first();

      const startOf7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last7dRows = await this.db.client('ai_usage_log')
        .where('created_at', '>=', startOf7d)
        .select(
          this.db.client.raw('COALESCE(SUM(estimated_cost_usd), 0) as cost_usd'),
          this.db.client.raw("COUNT(*) FILTER (WHERE call_type = 'search')::int as search_calls")
        )
        .first();

      const todaySearchCalls = Number(todayRows?.search_calls ?? 0);
      const today = {
        cost_usd: Number(todayRows?.cost_usd ?? 0) + todaySearchCalls * X_SEARCH_COST_PER_CALL_USD,
        prompt_tokens: Number(todayRows?.prompt_tokens ?? 0),
        completion_tokens: Number(todayRows?.completion_tokens ?? 0),
        total_tokens: Number(todayRows?.total_tokens ?? 0),
        api_calls: Number(todayRows?.api_calls ?? 0),
        search_calls: todaySearchCalls,
      };

      const monthSearchCalls = Number(monthRows?.search_calls ?? 0);
      const month = {
        cost_usd: Number(monthRows?.cost_usd ?? 0) + monthSearchCalls * X_SEARCH_COST_PER_CALL_USD,
        prompt_tokens: Number(monthRows?.prompt_tokens ?? 0),
        completion_tokens: Number(monthRows?.completion_tokens ?? 0),
        total_tokens: Number(monthRows?.total_tokens ?? 0),
        api_calls: Number(monthRows?.api_calls ?? 0),
        search_calls: monthSearchCalls,
      };

      const last24hSearchCalls = Number(last24hRows?.search_calls ?? 0);
      const last_24h = {
        cost_usd: Number(last24hRows?.cost_usd ?? 0) + last24hSearchCalls * X_SEARCH_COST_PER_CALL_USD,
        search_calls: last24hSearchCalls,
      };

      // Forecast: use active (is_active) monitors and their intervals
      const searches = await this.grokService.getGeographicalSearches();
      const activeMonitors = searches.filter(s => s.is_active);
      const dailySearchCalls = activeMonitors.reduce((sum, s) => sum + Math.floor(86400 / Math.max(60, s.monitoring_interval)), 0);

      const last7dCost = Number(last7dRows?.cost_usd ?? 0) + Number(last7dRows?.search_calls ?? 0) * X_SEARCH_COST_PER_CALL_USD;
      const last7dSearchCalls = Number(last7dRows?.search_calls ?? 0);
      const avgCostPerSearch24h = last_24h.search_calls > 0 ? last_24h.cost_usd / last_24h.search_calls : 0;
      const avgCostPerSearch7d = last7dSearchCalls > 0 ? last7dCost / last7dSearchCalls : 0;
      const avgCostPerSearch = avgCostPerSearch24h > 0
        ? (avgCostPerSearch7d > 0 ? (avgCostPerSearch24h + avgCostPerSearch7d) / 2 : avgCostPerSearch24h)
        : (avgCostPerSearch7d > 0 ? avgCostPerSearch7d : 0);
      const costPerSearch = avgCostPerSearch > 0 ? avgCostPerSearch : 0.01; // conservative fallback when no usage history

      const secondsElapsedToday = (now.getTime() - startOfToday.getTime()) / 1000;
      const secondsRemainingToday = Math.max(0, 86400 - secondsElapsedToday);
      const fractionOfDayRemaining = secondsRemainingToday / 86400;
      const estimatedCallsRemainingToday = dailySearchCalls * fractionOfDayRemaining;
      const costTodayRemaining = estimatedCallsRemainingToday * costPerSearch;

      const daysRemainingInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
      const costMonthForecast = month.cost_usd + daysRemainingInMonth * dailySearchCalls * costPerSearch;

      return {
        today,
        month,
        last_24h,
        forecast: {
          cost_today_remaining_usd: Math.round(costTodayRemaining * 1000000) / 1000000,
          cost_month_forecast_usd: Math.round(costMonthForecast * 1000000) / 1000000,
          daily_calls_at_current_setup: dailySearchCalls,
          active_monitors_in_forecast: activeMonitors.length,
        },
      };
    } catch (err: any) {
      logger.warn('Failed to get AI usage summary', { error: err?.message });
      return defaultSummary;
    }
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
    for (const [monitorId, entry] of this.activeGeographicalSearches.entries()) {
      if (entry.initialTimeout) clearTimeout(entry.initialTimeout);
      if (entry.interval) clearInterval(entry.interval);
      logger.info('Stopped geographical monitoring during shutdown', { monitorId });
    }
    this.activeGeographicalSearches.clear();
  }
}

