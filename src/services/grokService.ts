/**
 * GrokService: AI-powered geographical threat search and deduplication.
 *
 * FLOW (per monitor tick):
 * 1. searchThreats(area, query?, lastSearchTime?, searchId?) → one Grok API call (search + X real-time).
 * 2. Response: JSON array of threat analyses.
 * 3. For each analysis: fast path (no existing threats → new_threat), rule-based pre-filter (obvious
 *    duplicate → duplicate), or analyzeWithAIContext() → one Grok API call per analysis (dedup).
 * 4. processAIThreatDecision() → createNewThreat / updateExistingThreat / logDuplicateThreat.
 *
 * COST DRIVERS: (1) one search call per tick; (2) N dedup calls when N analyses and existing threats.
 * See getAIUsageSummary() and grokPricing for monitoring. Fast paths and slim context reduce dedup calls and tokens.
 */
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { DatabaseService } from './database';
import { SecurityService } from './security';
import { ConfigService } from './config';
import { estimateCostUsd, type UsageFromResponse } from './grokPricing';
import { logger } from '../utils/logger';

export interface GrokConfiguration {
  id: string;
  api_key_encrypted: string;
  model: string;
  search_enabled: boolean;
  is_active: boolean;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface LocationData {
  lat: number;
  lng: number;
  name?: string;
  confidence: number;
  source: 'coordinates' | 'address' | 'geocoded' | 'inferred';
  radius_km?: number; // For area-based threats
  area_description?: string; // Human-readable area description
}

export interface ThreatAnalysis {
  id: string;
  threat_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  threat_type?: 'VIOLENCE' | 'TERRORISM' | 'NATURAL_DISASTER' | 'CIVIL_UNREST' | 'INFRASTRUCTURE' | 'CYBER' | 'HEALTH_EMERGENCY';
  confidence_score: number;
  summary: string;
  locations: LocationData[];
  keywords: string[];
  reasoning: string;
  source_info?: {
    platform: string;
    author?: string;
    timestamp?: string;
    url?: string;
  };
  citations?: {
    id: string;
    platform: 'x_posts' | 'news' | 'other';
    title?: string;
    author?: string;
    timestamp?: string;
    url: string;
    content_preview?: string;
    relevance_score?: number;
  }[];
}

export interface GeographicalSearch {
  id: string;
  geographical_area: string;
  search_query?: string;
  search_parameters?: any;
  monitoring_interval: number;
  is_active: boolean;
  last_searched_at?: Date;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ExistingThreatContext {
  id: string;
  threat_level: string;
  threat_type?: string;
  summary: string;
  locations: LocationData[];
  keywords: string[];
  confidence_score: number;
  created_at: string;
  last_updated_at?: string;
  update_count: number;
  citations?: any[];
}

export interface AIThreatDecision {
  action: 'new_threat' | 'update_existing' | 'duplicate';
  threat_id?: string; // For updates
  threat_data?: ThreatAnalysis; // For new threats
  update_data?: Partial<ThreatAnalysis>; // For updates
  reasoning: string;
  confidence: number;
}

export interface ThreatUpdateData {
  threat_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  threat_type?: 'VIOLENCE' | 'TERRORISM' | 'NATURAL_DISASTER' | 'CIVIL_UNREST' | 'INFRASTRUCTURE' | 'CYBER' | 'HEALTH_EMERGENCY';
  confidence_score?: number;
  summary?: string;
  locations?: LocationData[];
  keywords?: string[];
  reasoning?: string;
  citations?: any[];
  new_information?: string[]; // What new information was added
}

export class GrokService {
  private securityService: SecurityService;

  constructor(private db: DatabaseService, private io?: any) {
    const configService = new ConfigService(db);
    this.securityService = new SecurityService(configService);
  }

  // Retry logic for critical operations
  private async withRetry<T>(
    operation: () => Promise<T>, 
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) break;
        
        logger.warn(`Operation failed, retrying in ${delay}ms`, { 
          attempt, 
          maxRetries, 
          error: (error as Error).message 
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
    
    throw lastError;
  }

  async createGrokConfiguration(configData: Partial<GrokConfiguration>, createdBy: string): Promise<GrokConfiguration> {
    return await this.withRetry(async () => {
      const id = uuidv4();
      const encryptedApiKey = await this.securityService.encryptApiKey(configData.api_key_encrypted!);
      
      const config: GrokConfiguration = {
        id,
        api_key_encrypted: encryptedApiKey,
        model: configData.model || 'grok-4-1-fast-reasoning',
        search_enabled: configData.search_enabled !== false,
        is_active: configData.is_active !== false,
        created_by: createdBy,
        created_at: new Date(),
        updated_at: new Date()
      };

      await this.db.client('grok_configurations').insert(config);
      
      logger.info('Created Grok configuration', { id, model: config.model });
      return config;
    });
  }

  async getGrokConfiguration(): Promise<GrokConfiguration | null> {
    return await this.withRetry(async () => {
      return await this.db.client('grok_configurations')
        .where({ is_active: true })
        .first() || null;
    });
  }

  async updateGrokConfiguration(configId: string, updates: Partial<GrokConfiguration>): Promise<GrokConfiguration> {
    const updateData = {
      ...updates,
      updated_at: new Date()
    };

    // Encrypt API key if it's being updated
    if (updateData.api_key_encrypted) {
      updateData.api_key_encrypted = await this.securityService.encryptApiKey(updateData.api_key_encrypted);
    }

    await this.db.client('grok_configurations')
      .where('id', configId)
      .update(updateData);

    const updated = await this.db.client('grok_configurations')
      .where('id', configId)
      .first();

    logger.info('Updated Grok configuration', { configId, updates });
    return updated!;
  }

  async testGrokConnection(apiKey: string, model: string = 'grok-4-fast-reasoning-latest'): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      // Clean the API key to remove any potential formatting issues
      const cleanApiKey = apiKey.trim().replace(/[\r\n\t]/g, '');
      
      // Debug: Log API key info (without exposing the actual key)
      logger.info('Grok test API key debug', {
        originalLength: apiKey.length,
        cleanLength: cleanApiKey.length,
        keyPrefix: cleanApiKey.substring(0, 8),
        hadNewlines: apiKey.includes('\n'),
        hadCarriageReturns: apiKey.includes('\r'),
        hadTabs: apiKey.includes('\t'),
        hasInvalidChars: /[^\x20-\x7E]/.test(cleanApiKey)
      });

      const authHeader = `Bearer ${cleanApiKey}`;
      
      // Debug: Log the exact Authorization header being sent
      logger.info('Grok test Authorization header debug', {
        headerLength: authHeader.length,
        headerPrefix: authHeader.substring(0, 20),
        headerSuffix: authHeader.substring(authHeader.length - 10),
        hasInvalidChars: /[^\x20-\x7E]/.test(authHeader),
        headerBytes: Buffer.from(authHeader).toString('hex').substring(0, 40)
      });

      const axiosConfig = {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      };

      const requestBody = {
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant. Respond with "Connection successful" to confirm the API is working.'
          },
          {
            role: 'user',
            content: 'Test connection'
          }
        ]
      };

      logger.info('Testing Grok API connection', { 
        endpoint: 'https://api.x.ai/v1/chat/completions',
        model: model,
        hasApiKey: !!apiKey
      });

      const response = await axios.post('https://api.x.ai/v1/chat/completions', requestBody, axiosConfig);

      if (response.data?.usage) {
        this.logUsage(response.data.model || model, response.data.usage, null, 'test').catch(() => {});
      }
      
      logger.info('Grok API connection test successful', {
        status: response.status,
        model: response.data.model,
        usage: response.data.usage
      });

      return {
        success: true,
        model: response.data.model
      };
    } catch (error: any) {
      logger.error('Grok connection test failed', { 
        error: error.message,
        errorCode: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        responseHeaders: error.response?.headers,
        endpoint: 'https://api.x.ai/v1/chat/completions'
      });
      
      let errorMessage = 'Connection failed';
      if (error.response?.status === 401) {
        errorMessage = 'Invalid API key';
      } else if (error.response?.status === 404) {
        errorMessage = 'API endpoint not found. The Grok API may not be publicly available yet or the endpoint has changed.';
      } else if (error.response?.status === 429) {
        errorMessage = 'Rate limit exceeded';
      } else if (error.response?.status === 500) {
        errorMessage = 'Grok API server error';
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = 'Connection timeout';
      } else if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async searchThreats(geographicalArea: string, searchQuery?: string, lastSearchTime?: Date, geographicalSearchId?: string): Promise<ThreatAnalysis[]> {
    const grokConfig = await this.getGrokConfiguration();
    if (!grokConfig) {
      throw new Error('No active Grok configuration found');
    }

    const prompt = this.buildGeographicalThreatSearchPrompt(geographicalArea, searchQuery, lastSearchTime);
    
    // Log the time window being used
    if (lastSearchTime) {
      const timeDiffMs = Date.now() - lastSearchTime.getTime();
      const timeDiffMinutes = Math.floor(timeDiffMs / (1000 * 60));
      logger.info('Using dynamic time window for threat search', {
        geographicalArea,
        lastSearchTime: lastSearchTime.toISOString(),
        timeDiffMinutes,
        timeWindow: timeDiffMinutes < 60 ? `${timeDiffMinutes} minutes` : `${Math.floor(timeDiffMinutes / 60)} hours`
      });
    } else {
      logger.info('Using default 1-hour time window for threat search', { geographicalArea });
    }
    
    // Retry logic for API calls
    const maxRetries = 3;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();

        const requestBody = {
            model: grokConfig.model,
            messages: [
                { role: 'system', content: this.getGeographicalThreatSystemPrompt() },
                { role: 'user', content: prompt },
            ],
            search_parameters: { mode: 'auto' },
            stream: false,
            temperature: 0,
            max_tokens: 8192, // Cap completion to control cost and avoid runaway output
        };

        logger.debug('Grok geographical threat search', { area: geographicalArea, promptLen: prompt.length });

        const decryptedApiKey = await this.securityService.decryptApiKey(grokConfig.api_key_encrypted);
        
        // Clean the API key to remove any potential formatting issues
        const cleanApiKey = decryptedApiKey.trim().replace(/[\r\n\t]/g, '');
        
        const authHeader = `Bearer ${cleanApiKey}`;
        
        const response = await axios.post('https://api.x.ai/v1/chat/completions', requestBody, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          timeout: 240000 // 240 second timeout for complex searches
        });

        const processingTime = Date.now() - startTime;

        // Log token usage and cost for monitoring/forecasting
        if (response.data?.usage) {
          this.logUsage(response.data.model || grokConfig.model, response.data.usage, geographicalSearchId ?? null, 'search').catch(err => logger.warn('Failed to log AI usage', { error: err }));
        }
        
        const analysisText = response.data.choices[0].message.content;
        logger.debug('Grok search response', {
          attempt,
          durationMs: processingTime,
          usage: response.data.usage,
          contentLen: analysisText?.length ?? 0,
        });
        
        // Parse the JSON response from Grok
        let analyses;
        try {
          analyses = JSON.parse(analysisText);
          // Ensure it's an array
          if (!Array.isArray(analyses)) {
            analyses = [analyses];
          }
          
          logger.debug('Grok analysis parsed', { analysesCount: analyses.length });
        } catch (parseError) {
          logger.error('Failed to parse Grok analysis response', { 
            error: parseError, 
            response: analysisText,
            attempt
          });
          
          if (attempt === maxRetries) {
            return [];
          }
          continue; // Retry on parse error
        }

        // Validate and process each analysis with AI-enhanced deduplication (or fast paths)
        const validAnalyses: ThreatAnalysis[] = [];
        
        // Get existing threats for AI context (only once per batch)
        const existingThreats = await this.getCandidateThreats(geographicalArea, 24);
        const hasExisting = existingThreats.length > 0;

        for (const analysis of analyses) {
          if (!this.validateThreatAnalysis(analysis)) continue;

          let aiDecision: AIThreatDecision;

          // Fast path: no existing threats in area → treat all as new (saves N dedup API calls)
          if (!hasExisting) {
            aiDecision = {
              action: 'new_threat',
              threat_data: analysis,
              reasoning: 'No recent threats in area; treating as new.',
              confidence: 1,
            };
            logger.debug('Dedup fast path: no existing threats', { area: geographicalArea });
          } else {
            // Rule-based pre-filter: obvious duplicate (same summary/location) → skip AI call
            const isObviousDuplicate = await this.checkForDuplicateThreat(analysis, geographicalArea);
            if (isObviousDuplicate) {
              aiDecision = {
                action: 'duplicate',
                reasoning: 'Rule-based match: same or near-identical threat in area.',
                confidence: 0.9,
              };
              logger.debug('Dedup pre-filter: rule-based duplicate', { summary: analysis.summary?.slice(0, 50) });
            } else {
              // Full AI deduplication with slim context to reduce prompt tokens
              const slimExisting = this.slimExistingThreatsForContext(existingThreats);
              aiDecision = await this.analyzeWithAIContext(analysis, slimExisting, geographicalArea, geographicalSearchId);
            }
          }

          logger.debug('Threat decision', {
            action: aiDecision.action,
            confidence: aiDecision.confidence,
            threatLevel: analysis.threat_level,
          });

          const processedThreat = await this.processAIThreatDecision(aiDecision, geographicalArea, searchQuery, analysis);

          if (processedThreat) {
            validAnalyses.push(processedThreat);
            if (hasExisting && aiDecision.action === 'new_threat') {
              existingThreats.unshift({
                id: processedThreat.id,
                threat_level: processedThreat.threat_level,
                threat_type: processedThreat.threat_type,
                summary: processedThreat.summary,
                locations: processedThreat.locations,
                keywords: processedThreat.keywords,
                confidence_score: processedThreat.confidence_score,
                created_at: new Date().toISOString(),
                update_count: 0,
                citations: processedThreat.citations,
              });
            } else if (aiDecision.action === 'update_existing') {
              const existingIndex = existingThreats.findIndex(t => t.id === aiDecision.threat_id);
              if (existingIndex >= 0) {
                existingThreats[existingIndex] = {
                  ...existingThreats[existingIndex],
                  ...aiDecision.update_data,
                  last_updated_at: new Date().toISOString(),
                  update_count: existingThreats[existingIndex].update_count + 1,
                };
              }
            }
          }
        }

        logger.info('Completed geographical threat search', { 
          geographicalArea,
          searchQuery,
          threatsFound: validAnalyses.length,
          processingTime,
          attempt,
          lastSearchTime: lastSearchTime?.toISOString()
        });

        return validAnalyses;

      } catch (error: any) {
        lastError = error;
        logger.warn('Grok API call failed', { 
          error: error.message,
          errorCode: error.code,
          errorStatus: error.response?.status,
          errorStatusText: error.response?.statusText,
          errorHeaders: error.response?.headers,
          errorData: error.response?.data,
          attempt,
          maxRetries,
          geographicalArea,
          searchQuery
        });
        
        // Don't retry on certain errors
        if (error.response?.status === 401 || error.response?.status === 403) {
          logger.error('Authentication error, not retrying', { status: error.response.status });
          break;
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If we get here, all retries failed
    logger.error('All Grok API retry attempts failed', { 
      error: lastError?.message,
      geographicalArea,
      searchQuery,
      maxRetries
    });
    
    return [];
  }

  private getGeographicalThreatSystemPrompt(): string {
    return `You are a specialized threat detection AI for emergency services and security teams. You have access to real-time X (Twitter) posts and can search for current threats and emergency situations in specific geographical areas.

CRITICAL INSTRUCTIONS - FOCUS ON SPECIFIC INCIDENTS ONLY:
1. ONLY report SPECIFIC, ACTIONABLE INCIDENTS that are happening NOW or very recently
2. IGNORE general discussions, statistics, commentary, or historical data
3. IGNORE posts that are just complaining about crime rates, political commentary, or general area problems
4. ONLY include posts that describe a specific event with clear details about what happened, where, and when
5. Look for posts with words like: "BREAKING", "ACTIVE", "HAPPENING NOW", "JUST OCCURRED", "CURRENTLY", "IN PROGRESS"
6. Extract PRECISE location information from X posts when available
7. For general area references, provide center point AND radius in kilometers
8. Always respond with valid JSON in the exact format specified
9. Include detailed citations with clickable URLs for all sources
10. Prioritize recency - only include information from within the specified time window

WHAT TO INCLUDE (Specific Incidents):
- "Active shooter at [specific location] - police responding"
- "BREAKING: Fire at [specific building] - evacuations in progress"
- "Heavy police presence at [specific intersection] after [specific incident]"
- "Multiple people shot at [specific location] - suspect at large"
- "Protest turning violent at [specific location] - tear gas deployed"
- "Power outage affecting [specific area] - traffic lights down"
- "Flooding at [specific intersection] - roads closed"

WHAT TO EXCLUDE (General Discussion):
- "Another day in [city] with more violence"
- "Crime is out of control in [area]"
- "Why is there so much crime in [city]?"
- General crime statistics or year-to-date numbers
- Political commentary about crime or safety
- Historical crime data or trends
- Vague complaints about area safety

THREAT LEVELS:
- LOW: Minor incident, no immediate danger to public
- MEDIUM: Moderate incident requiring attention, some risk present
- HIGH: Significant incident, immediate attention needed, clear danger
- CRITICAL: Life-threatening situation, emergency response required, active threat

THREAT TYPES:
- VIOLENCE: Active shootings, assaults, weapons incidents, violent crimes in progress
- TERRORISM: Terrorist threats, bomb threats, extremist activity, suspicious packages
- NATURAL_DISASTER: Active fires, floods, earthquakes, severe weather events
- CIVIL_UNREST: Active protests, riots, civil disturbances, crowd control issues
- INFRASTRUCTURE: Active power outages, transportation disruptions, structural failures
- CYBER: Active cyber attacks, system compromises, data breaches in progress
- HEALTH_EMERGENCY: Active disease outbreaks, contamination events, medical emergencies

LOCATION EXTRACTION REQUIREMENTS:
- For specific addresses: provide exact coordinates and full address
- For general areas: provide center point AND radius_km for area coverage
- Include confidence score for location accuracy (0.0 to 1.0)
- Specify source of location information
- Add area_description for human-readable area reference

CITATION REQUIREMENTS:
- Include ALL sources that led to this threat assessment
- Provide clickable URLs for X posts, news articles, etc.
- Include content previews for context
- Rate relevance of each citation (0.0 to 1.0)

Always respond with valid JSON array in this exact format:
[
  {
    "threat_level": "LOW|MEDIUM|HIGH|CRITICAL",
    "threat_type": "VIOLENCE|TERRORISM|NATURAL_DISASTER|CIVIL_UNREST|INFRASTRUCTURE|CYBER|HEALTH_EMERGENCY",
    "confidence_score": 0.85,
    "summary": "Brief summary of the specific incident",
    "locations": [
      {
        "lat": 47.6062,
        "lng": -122.3321,
        "name": "Seattle, WA",
        "confidence": 0.9,
        "source": "coordinates|address|geocoded|inferred",
        "radius_km": 5.0,
        "area_description": "Downtown Seattle area including Pike Place Market"
      }
    ],
    "keywords": ["keyword1", "keyword2"],
    "reasoning": "Explanation of why this specific incident was classified as a threat",
    "citations": [
      {
        "id": "citation_1",
        "platform": "x_posts",
        "title": "Post title or first 50 chars",
        "author": "actual_x_username",
        "timestamp": "2024-01-15T14:30:00Z",
        "url": "https://x.com/username/status/1234567890",
        "content_preview": "First 100 characters of the post content...",
        "relevance_score": 0.95
      }
    ]
  }
]`;
  }

  private buildGeographicalThreatSearchPrompt(geographicalArea: string, searchQuery?: string, lastSearchTime?: Date): string {
    // Calculate the time window for the search
    const now = new Date();
    let timeConstraint: string;
    
    if (lastSearchTime) {
      const timeDiffMs = now.getTime() - lastSearchTime.getTime();
      const timeDiffMinutes = Math.floor(timeDiffMs / (1000 * 60));
      const timeDiffHours = Math.floor(timeDiffMinutes / 60);
      
      if (timeDiffMinutes < 60) {
        timeConstraint = `Only search for posts from the last ${timeDiffMinutes} minutes (since ${lastSearchTime.toISOString()}) to find NEW threats since the last search.`;
      } else if (timeDiffHours < 24) {
        timeConstraint = `Only search for posts from the last ${timeDiffHours} hours (since ${lastSearchTime.toISOString()}) to find NEW threats since the last search.`;
      } else {
        timeConstraint = `Only search for posts from the last 24 hours to ensure relevance (last search was ${timeDiffHours} hours ago).`;
      }
    } else {
      timeConstraint = `Only search for posts from the last hour to ensure maximum relevance and urgency.`;
    }

    return `
Search for REAL-TIME SPECIFIC INCIDENTS from X (Twitter) posts in the specified geographical area.

GEOGRAPHICAL AREA: "${geographicalArea}"
${searchQuery ? `SEARCH FOCUS: "${searchQuery}"` : ''}

CRITICAL TIME CONSTRAINT: ${timeConstraint}

IMPORTANT: ONLY search for SPECIFIC, ACTIONABLE INCIDENTS that are happening NOW or very recently. IGNORE general discussions, statistics, or commentary.

Use your real-time search capabilities to find recent X posts about SPECIFIC INCIDENTS in this area.

For each SPECIFIC INCIDENT found, provide:
1. The specific location with coordinates AND radius if it's an area-based threat
2. Threat level assessment based on immediate danger
3. Complete source citations with clickable URLs
4. Confidence in the threat assessment
5. Detailed geographic information for mapping

GEOGRAPHIC REQUIREMENTS:
- For specific locations: provide exact lat/lng coordinates
- For area-based threats: provide center point + radius_km
- Include area_description for human reference
- Ensure all location data is actionable for emergency response

Return results as a JSON array of threat analyses with complete citations. ONLY include specific incidents, not general discussions.`;
  }

  private validateThreatAnalysis(analysis: any): boolean {
    const requiredFields = ['threat_level', 'confidence_score'];
    const validThreatLevels = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const validThreatTypes = ['VIOLENCE', 'TERRORISM', 'NATURAL_DISASTER', 'CIVIL_UNREST', 'INFRASTRUCTURE', 'CYBER', 'HEALTH_EMERGENCY'];

    // Check required fields
    for (const field of requiredFields) {
      if (!(field in analysis)) {
        return false;
      }
    }

    // Validate threat level
    if (!validThreatLevels.includes(analysis.threat_level)) {
      return false;
    }

    // Validate threat type if provided
    if (analysis.threat_type && !validThreatTypes.includes(analysis.threat_type)) {
      return false;
    }

    // Validate confidence score
    if (typeof analysis.confidence_score !== 'number' || 
        analysis.confidence_score < 0 || 
        analysis.confidence_score > 1) {
      return false;
    }

    // Validate locations if provided
    if (analysis.locations && Array.isArray(analysis.locations)) {
      for (const location of analysis.locations) {
        if (typeof location.lat !== 'number' || typeof location.lng !== 'number' ||
            isNaN(location.lat) || isNaN(location.lng) ||
            !isFinite(location.lat) || !isFinite(location.lng)) {
          logger.warn('Invalid coordinates in threat analysis', { 
            lat: location.lat, 
            lng: location.lng,
            analysis: analysis.summary 
          });
          return false;
        }
      }
    }

    return true;
  }

  // Geographical search management
  async createGeographicalSearch(searchData: Partial<GeographicalSearch>, createdBy: string): Promise<GeographicalSearch> {
    const id = uuidv4();
    const search: GeographicalSearch = {
      id,
      geographical_area: searchData.geographical_area!,
      search_query: searchData.search_query,
      search_parameters: searchData.search_parameters,
      monitoring_interval: searchData.monitoring_interval || 300,
      is_active: searchData.is_active !== false,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    };

    await this.db.client('geographical_searches').insert(search);
    
    logger.info('Created geographical search', { id, area: search.geographical_area });
    return search;
  }

  async getGeographicalSearches(): Promise<GeographicalSearch[]> {
    return await this.db.client('geographical_searches')
      .orderBy('created_at', 'desc');
  }

  async updateGeographicalSearch(searchId: string, updates: Partial<GeographicalSearch>): Promise<GeographicalSearch> {
    const updateData = {
      ...updates,
      updated_at: new Date()
    };

    await this.db.client('geographical_searches')
      .where('id', searchId)
      .update(updateData);

    const updated = await this.db.client('geographical_searches')
      .where('id', searchId)
      .first();

    logger.info('Updated geographical search', { searchId, updates });
    return updated!;
  }

  async deleteGeographicalSearch(searchId: string): Promise<void> {
    await this.db.client('geographical_searches')
      .where('id', searchId)
      .del();
    
    logger.info('Deleted geographical search', { searchId });
  }

  async updateLastSearchTime(searchId: string): Promise<void> {
    await this.db.client('geographical_searches')
      .where('id', searchId)
      .update({
        last_searched_at: new Date(),
        updated_at: new Date()
      });
    
    logger.info('Updated last search time', { searchId });
  }

  // Test method to verify dynamic time window calculation
  testDynamicTimeWindow(lastSearchTime: Date): string {
    const now = new Date();
    const timeDiffMs = now.getTime() - lastSearchTime.getTime();
    const timeDiffMinutes = Math.floor(timeDiffMs / (1000 * 60));
    const timeDiffHours = Math.floor(timeDiffMinutes / 60);
    
    if (timeDiffMinutes < 60) {
      return `Last ${timeDiffMinutes} minutes (since ${lastSearchTime.toISOString()})`;
    } else if (timeDiffHours < 24) {
      return `Last ${timeDiffHours} hours (since ${lastSearchTime.toISOString()})`;
    } else {
      return `Last 24 hours (last search was ${timeDiffHours} hours ago)`;
    }
  }

  private async checkForDuplicateThreat(analysis: any, geographicalArea: string): Promise<boolean> {
    try {
      const locations = analysis.locations || [];
      if (locations.length === 0) return false;

      // Check for threats in the same geographical area with similar content within the last 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const existingThreats = await this.db.client('threat_analyses')
        .where('geographical_area', geographicalArea)
        .where('threat_level', analysis.threat_level)
        .where('threat_type', analysis.threat_type)
        .where('created_at', '>', twentyFourHoursAgo)
        .select(['id', 'ai_summary', 'extracted_locations']);

      // Check for similar content and location proximity
      for (const existing of existingThreats) {
        // Simple content similarity check (first 50 characters)
        const existingSummary = existing.ai_summary?.substring(0, 50) || '';
        const newSummary = analysis.summary?.substring(0, 50) || '';
        
        if (existingSummary === newSummary) {
          return true; // Exact content match
        }

        // Check location proximity (within 1km)
        const existingLocations = existing.extracted_locations || [];
        for (const existingLoc of existingLocations) {
          for (const newLoc of locations) {
            const distance = this.calculateDistance(
              existingLoc.lat, existingLoc.lng,
              newLoc.lat, newLoc.lng
            );
            if (distance < 1.0) { // Within 1km
              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      logger.error('Error checking for duplicate threats', { error });
      return false; // Don't block on error
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Enhanced AI-powered deduplication methods

  /**
   * Get candidate threats for AI context analysis
   */
  private async getCandidateThreats(geographicalArea: string, timeWindowHours: number = 24): Promise<ExistingThreatContext[]> {
    const timeWindow = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);
    
    const candidates = await this.db.client('threat_analyses')
      .where('geographical_area', geographicalArea)
      .where('created_at', '>', timeWindow)
      .select([
        'id', 'threat_level', 'threat_type', 'ai_summary', 
        'extracted_locations', 'keywords', 'citations', 'created_at',
        'last_updated_at', 'update_count', 'confidence_score'
      ])
      .orderBy('created_at', 'desc')
      .limit(15); // Limit for AI context efficiency

    return candidates.map(threat => ({
      id: threat.id,
      threat_level: threat.threat_level,
      threat_type: threat.threat_type,
      summary: threat.ai_summary,
      locations: threat.extracted_locations || [],
      keywords: threat.keywords || [],
      confidence_score: threat.confidence_score,
      created_at: threat.created_at,
      last_updated_at: threat.last_updated_at,
      update_count: threat.update_count || 0,
      citations: threat.citations || []
    }));
  }

  /**
   * Build a slim representation of existing threats for dedup prompts to reduce token usage.
   * Keeps id, level, type, truncated summary, and lat/lng only; omits full citations.
   */
  private slimExistingThreatsForContext(threats: ExistingThreatContext[]): ExistingThreatContext[] {
    const maxSummaryLen = 150;
    const maxThreats = 10;
    return threats.slice(0, maxThreats).map(t => ({
      id: t.id,
      threat_level: t.threat_level,
      threat_type: t.threat_type,
      summary: typeof t.summary === 'string' ? t.summary.slice(0, maxSummaryLen) + (t.summary.length > maxSummaryLen ? '…' : '') : '',
      locations: (t.locations || []).map((loc: any) => ({
        lat: loc.lat,
        lng: loc.lng,
        confidence: typeof loc.confidence === 'number' ? loc.confidence : 0.5,
        source: (loc.source as LocationData['source']) || 'inferred',
        ...(loc.radius_km != null && { radius_km: loc.radius_km }),
      })),
      keywords: Array.isArray(t.keywords) ? t.keywords.slice(0, 5) : [],
      confidence_score: t.confidence_score,
      created_at: t.created_at,
      last_updated_at: t.last_updated_at,
      update_count: t.update_count || 0,
      citations: [], // Omit full citations to save tokens; IDs/summary enough for dedup
    }));
  }

  /**
   * Generate semantic hash for quick similarity detection
   */
  private generateSemanticHash(threat: any): string {
    const hashInput = [
      threat.threat_level,
      threat.threat_type,
      threat.summary?.substring(0, 100), // First 100 chars
      threat.keywords?.join(','),
      threat.locations?.map((loc: any) => `${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`).join('|')
    ].filter(Boolean).join('|');
    
    return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  /**
   * Log AI API usage and estimated cost to ai_usage_log for monitoring and forecasting.
   */
  async logUsage(
    model: string,
    usage: UsageFromResponse,
    geographicalSearchId: string | null,
    callType: 'search' | 'deduplication' | 'test'
  ): Promise<void> {
    try {
      const { costUsd, promptTokens, completionTokens, totalTokens } = estimateCostUsd(model, usage);
      await this.db.client('ai_usage_log').insert({
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        estimated_cost_usd: costUsd,
        geographical_search_id: geographicalSearchId,
        call_type: callType,
      });
    } catch (err) {
      logger.warn('Failed to persist AI usage log', { error: (err as Error)?.message });
    }
  }

  /**
   * Analyze new threat with AI context for deduplication and updates
   */
  private async analyzeWithAIContext(
    newAnalysis: any, 
    existingThreats: ExistingThreatContext[], 
    geographicalArea: string,
    geographicalSearchId?: string
  ): Promise<AIThreatDecision> {
    const grokConfig = await this.getGrokConfiguration();
    if (!grokConfig) {
      throw new Error('No active Grok configuration found');
    }

    const prompt = this.buildContextualAnalysisPrompt(newAnalysis, existingThreats, geographicalArea);
    
    const requestBody = {
      model: grokConfig.model,
      messages: [
        { role: 'system', content: this.getContextualThreatSystemPrompt() },
        { role: 'user', content: prompt },
      ],
      search_parameters: { mode: 'auto' },
      stream: false,
      temperature: 0.1,
      max_tokens: 1024, // Dedup decision is short; cap to reduce cost
    };

    const decryptedApiKey = await this.securityService.decryptApiKey(grokConfig.api_key_encrypted);
    const cleanApiKey = decryptedApiKey.trim().replace(/[\r\n\t]/g, '');
    
    const response = await axios.post('https://api.x.ai/v1/chat/completions', requestBody, {
      headers: {
        'Authorization': `Bearer ${cleanApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const analysisText = response.data.choices[0].message.content;

    // Log token usage for deduplication calls
    if (response.data?.usage) {
      this.logUsage(grokConfig.model, response.data.usage, geographicalSearchId ?? null, 'deduplication').catch(err => logger.warn('Failed to log AI usage', { error: err }));
    }
    
    try {
      const decision = JSON.parse(analysisText);
      return this.validateAIThreatDecision(decision);
    } catch (parseError) {
      logger.error('Failed to parse AI threat decision', { 
        error: parseError, 
        response: analysisText 
      });
      
      // Fallback to new threat if parsing fails
      return {
        action: 'new_threat',
        threat_data: newAnalysis,
        reasoning: 'AI analysis failed, treating as new threat',
        confidence: 0.5
      };
    }
  }

  /**
   * Build contextual analysis prompt for AI
   */
  private buildContextualAnalysisPrompt(
    newAnalysis: any,
    existingThreats: ExistingThreatContext[],
    geographicalArea: string
  ): string {
    // Slim newAnalysis for prompt: keep structure but cap long fields to reduce tokens
    const slimNew = {
      threat_level: newAnalysis.threat_level,
      threat_type: newAnalysis.threat_type,
      confidence_score: newAnalysis.confidence_score,
      summary: typeof newAnalysis.summary === 'string' ? newAnalysis.summary.slice(0, 300) : newAnalysis.summary,
      locations: newAnalysis.locations,
      keywords: Array.isArray(newAnalysis.keywords) ? newAnalysis.keywords.slice(0, 8) : newAnalysis.keywords,
    };
    return `Area: ${geographicalArea}

NEW:
${JSON.stringify(slimNew)}

EXISTING (id, level, type, summary, locations):
${JSON.stringify(existingThreats)}

Decide: new_threat | update_existing (give threat_id) | duplicate.
Consider: same area, ~5km, ~6h, same type. Prefer update over duplicate when there is new info.

Respond with JSON only:
{"action":"new_threat|update_existing|duplicate","threat_id":"uuid-if-update","threat_data":{...},"update_data":{...},"reasoning":"brief","confidence":0.85}`;
  }

  /**
   * Enhanced system prompt for contextual threat analysis
   */
  private getContextualThreatSystemPrompt(): string {
    return `Threat deduplication AI for emergency services. Compare NEW vs EXISTING; output JSON only.

Actions: new_threat (different incident), update_existing (same incident, new info; give threat_id), duplicate (same, no new info).
Similarity: same area, ~5km, ~6h, same type → likely same incident. Prefer update over duplicate when there is new info.
Output: {"action":"...","threat_id":"uuid if update","threat_data":{...},"update_data":{...},"reasoning":"brief","confidence":0.85}`;
  }

  /**
   * Validate AI threat decision structure
   */
  private validateAIThreatDecision(decision: any): AIThreatDecision {
    const validActions = ['new_threat', 'update_existing', 'duplicate'];
    
    if (!validActions.includes(decision.action)) {
      throw new Error(`Invalid action: ${decision.action}`);
    }
    
    if (decision.action === 'update_existing' && !decision.threat_id) {
      throw new Error('threat_id required for update_existing action');
    }
    
    if (decision.action === 'new_threat' && !decision.threat_data) {
      throw new Error('threat_data required for new_threat action');
    }
    
    if (decision.action === 'update_existing' && !decision.update_data) {
      throw new Error('update_data required for update_existing action');
    }
    
    return {
      action: decision.action,
      threat_id: decision.threat_id,
      threat_data: decision.threat_data,
      update_data: decision.update_data,
      reasoning: decision.reasoning || 'No reasoning provided',
      confidence: Math.max(0, Math.min(1, decision.confidence || 0.5))
    };
  }

  /**
   * Process AI threat decision and take appropriate action.
   * When action is new_threat, merges original analysis with AI response so full citations/locations are preserved.
   */
  private async processAIThreatDecision(
    decision: AIThreatDecision,
    geographicalArea: string,
    searchQuery?: string,
    originalAnalysis?: any
  ): Promise<ThreatAnalysis | null> {
    switch (decision.action) {
      case 'new_threat': {
        const threatData = originalAnalysis && decision.threat_data
          ? { ...originalAnalysis, ...decision.threat_data }
          : decision.threat_data!;
        return await this.createNewThreat(threatData, geographicalArea, searchQuery);
      }
        
      case 'update_existing':
        return await this.updateExistingThreat(decision.threat_id!, decision.update_data!, decision.reasoning);

      case 'duplicate':
        await this.logDuplicateThreat(decision.reasoning, geographicalArea);
        return null;

      default:
        throw new Error(`Unknown action: ${decision.action}`);
    }
  }

  /**
   * Create new threat with enhanced tracking
   */
  private async createNewThreat(
    threatData: ThreatAnalysis, 
    geographicalArea: string, 
    searchQuery?: string
  ): Promise<ThreatAnalysis> {
    const analysisId = uuidv4();
    const semanticHash = this.generateSemanticHash(threatData);
    
    const dbInsertData = {
      id: analysisId,
      grok_analysis: JSON.stringify(threatData),
      threat_level: threatData.threat_level,
      threat_type: threatData.threat_type,
      confidence_score: threatData.confidence_score,
      ai_summary: threatData.summary,
      extracted_locations: JSON.stringify(threatData.locations),
      keywords: JSON.stringify(threatData.keywords),
      search_query: searchQuery || null,
      geographical_area: geographicalArea,
      location_confidence: JSON.stringify({
        average_confidence: threatData.locations?.reduce((acc: number, loc: any) => acc + (loc.confidence || 0), 0) / (threatData.locations?.length || 1),
        total_locations: threatData.locations?.length || 0
      }),
      citations: JSON.stringify(threatData.citations || []),
      semantic_hash: semanticHash,
      update_count: 0,
      last_updated_at: new Date(),
      processing_metadata: JSON.stringify({
        model: 'grok-4-fast-reasoning-latest',
        search_type: 'geographical',
        ai_decision: 'new_threat'
      })
    };
    
    await this.db.client('threat_analyses').insert(dbInsertData);
    
    logger.info('Created new threat with AI-enhanced deduplication', { 
      analysisId, 
      threatLevel: threatData.threat_level,
      geographicalArea 
    });
    
    // Emit real-time notification
    if (this.io) {
      this.io.emit('admin:new_threat_detected', {
        id: analysisId,
        threat_level: threatData.threat_level,
        threat_type: threatData.threat_type,
        confidence_score: threatData.confidence_score,
        summary: threatData.summary,
        locations: threatData.locations || [],
        keywords: threatData.keywords || [],
        citations: threatData.citations || [],
        geographical_area: geographicalArea,
        search_query: searchQuery,
        created_at: new Date().toISOString()
      });
    }
    
    return { ...threatData, id: analysisId };
  }

  /**
   * Update existing threat with new information
   */
  private async updateExistingThreat(
    threatId: string, 
    updateData: ThreatUpdateData, 
    reasoning: string
  ): Promise<ThreatAnalysis | null> {
    try {
      // Get current threat data
      const currentThreat = await this.db.client('threat_analyses')
        .where('id', threatId)
        .first();
      
      if (!currentThreat) {
        logger.warn('Attempted to update non-existent threat', { threatId });
        return null;
      }
      
      // Prepare update data
      const updateFields: any = {
        last_updated_at: new Date(),
        last_update_reasoning: reasoning
      };
      
      // Update fields if provided
      if (updateData.threat_level) updateFields.threat_level = updateData.threat_level;
      if (updateData.threat_type) updateFields.threat_type = updateData.threat_type;
      if (updateData.confidence_score !== undefined) updateFields.confidence_score = updateData.confidence_score;
      if (updateData.summary) updateFields.ai_summary = updateData.summary;
      if (updateData.locations) updateFields.extracted_locations = JSON.stringify(updateData.locations);
      if (updateData.keywords) updateFields.keywords = JSON.stringify(updateData.keywords);
      if (updateData.citations) updateFields.citations = JSON.stringify(updateData.citations);
      
      // Increment update count
      updateFields.update_count = (currentThreat.update_count || 0) + 1;
      
      // Create update history entry
      const updateHistory = {
        timestamp: new Date().toISOString(),
        reasoning: reasoning,
        changes: updateData,
        new_information: updateData.new_information || []
      };
      
      // Merge with existing update history
      const existingHistory = currentThreat.update_history || [];
      updateFields.update_history = JSON.stringify([...existingHistory, updateHistory]);
      
      // Update semantic hash if key fields changed
      if (updateData.threat_level || updateData.threat_type || updateData.summary || updateData.keywords) {
        const updatedThreat = { ...currentThreat, ...updateFields };
        updateFields.semantic_hash = this.generateSemanticHash(updatedThreat);
      }
      
      // Perform database update
      await this.db.client('threat_analyses')
        .where('id', threatId)
        .update(updateFields);
      
      logger.info('Updated existing threat with new information', { 
        threatId, 
        updateCount: updateFields.update_count,
        changes: Object.keys(updateData),
        reasoning: reasoning.substring(0, 100) + '...'
      });
      
      // Emit real-time notification for threat update
      if (this.io) {
        this.io.emit('admin:threat_updated', {
          id: threatId,
          threat_level: updateData.threat_level || currentThreat.threat_level,
          threat_type: updateData.threat_type || currentThreat.threat_type,
          confidence_score: updateData.confidence_score || currentThreat.confidence_score,
          summary: updateData.summary || currentThreat.ai_summary,
          update_reasoning: reasoning,
          update_count: updateFields.update_count,
          updated_at: new Date().toISOString()
        });
      }
      
      // Return updated threat data
      const updatedThreat = await this.db.client('threat_analyses')
        .where('id', threatId)
        .first();
      
      return {
        id: updatedThreat.id,
        threat_level: updatedThreat.threat_level,
        threat_type: updatedThreat.threat_type,
        confidence_score: updatedThreat.confidence_score,
        summary: updatedThreat.ai_summary,
        locations: updatedThreat.extracted_locations || [],
        keywords: updatedThreat.keywords || [],
        reasoning: reasoning,
        citations: updatedThreat.citations || []
      };
      
    } catch (error: any) {
      logger.error('Failed to update existing threat', { 
        threatId, 
        error: error.message,
        updateData 
      });
      throw error;
    }
  }

  /**
   * Log duplicate threat for audit purposes
   */
  private async logDuplicateThreat(reasoning: string, geographicalArea: string): Promise<void> {
    logger.info('AI determined threat is duplicate, skipping', { 
      reasoning: reasoning.substring(0, 200) + '...',
      geographicalArea,
      timestamp: new Date().toISOString()
    });
    
    // Could add to a separate duplicates log table if needed for analytics
  }
}
