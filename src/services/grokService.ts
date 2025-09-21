import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { SecurityService } from './security';
import { ConfigService } from './config';
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

export class GrokService {
  private securityService: SecurityService;

  constructor(private db: DatabaseService, private io?: any) {
    const configService = new ConfigService(db);
    this.securityService = new SecurityService(configService);
  }

  async createGrokConfiguration(configData: Partial<GrokConfiguration>, createdBy: string): Promise<GrokConfiguration> {
    const id = uuidv4();
    const encryptedApiKey = await this.securityService.encryptApiKey(configData.api_key_encrypted!);
    
    const config: GrokConfiguration = {
      id,
      api_key_encrypted: encryptedApiKey,
      model: configData.model || 'grok-4-fast-reasoning-latest',
      search_enabled: configData.search_enabled !== false,
      is_active: configData.is_active !== false,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    };

    await this.db.client('grok_configurations').insert(config);
    
    logger.info('Created Grok configuration', { id, model: config.model });
    return config;
  }

  async getGrokConfiguration(): Promise<GrokConfiguration | null> {
    return await this.db.client('grok_configurations')
      .where({ is_active: true })
      .first() || null;
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

  async searchThreats(geographicalArea: string, searchQuery?: string): Promise<ThreatAnalysis[]> {
    const grokConfig = await this.getGrokConfiguration();
    if (!grokConfig) {
      throw new Error('No active Grok configuration found');
    }

    const prompt = this.buildGeographicalThreatSearchPrompt(geographicalArea, searchQuery);
    
    // Retry logic for API calls
    const maxRetries = 3;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();

        const requestBody = {
            model: grokConfig.model,
            messages: [
                {
                    role: 'system',
                    content: this.getGeographicalThreatSystemPrompt()
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            search_parameters: {
                mode: 'auto'
            },
            stream: false,
            temperature: 0
        };
        
        logger.info('Making Grok API call for geographical threat search', 
            requestBody
        );

        const decryptedApiKey = await this.securityService.decryptApiKey(grokConfig.api_key_encrypted);
        
        // Clean the API key to remove any potential formatting issues
        const cleanApiKey = decryptedApiKey.trim().replace(/[\r\n\t]/g, '');
        
        // Debug: Log API key info (without exposing the actual key)
        logger.info('Grok API key debug', {
          originalLength: decryptedApiKey.length,
          cleanLength: cleanApiKey.length,
          keyPrefix: cleanApiKey.substring(0, 8),
          hadNewlines: decryptedApiKey.includes('\n'),
          hadCarriageReturns: decryptedApiKey.includes('\r'),
          hadTabs: decryptedApiKey.includes('\t'),
          hasInvalidChars: /[^\x20-\x7E]/.test(cleanApiKey)
        });
        
        const authHeader = `Bearer ${cleanApiKey}`;
        
        // Debug: Log the exact Authorization header being sent
        logger.info('Grok Authorization header debug', {
          headerLength: authHeader.length,
          headerPrefix: authHeader.substring(0, 20),
          headerSuffix: authHeader.substring(authHeader.length - 10),
          hasInvalidChars: /[^\x20-\x7E]/.test(authHeader),
          headerBytes: Buffer.from(authHeader).toString('hex').substring(0, 40)
        });
        
        const response = await axios.post('https://api.x.ai/v1/chat/completions', requestBody, {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          timeout: 120000 // 120 second timeout for complex searches
        });

        const processingTime = Date.now() - startTime;
        
        logger.info('Grok API response received', {
          attempt,
          status: response.status,
          duration: `${processingTime}ms`,
          model: response.data.model,
          usage: response.data.usage,
          responseLength: response.data.choices?.[0]?.message?.content?.length || 0
        });
        
        // Debug: Log the raw response structure
        logger.info('Grok API raw response debug', {
          hasChoices: !!response.data.choices,
          choicesLength: response.data.choices?.length || 0,
          hasMessage: !!response.data.choices?.[0]?.message,
          hasContent: !!response.data.choices?.[0]?.message?.content,
          contentLength: response.data.choices?.[0]?.message?.content?.length || 0,
          contentPreview: response.data.choices?.[0]?.message?.content?.substring(0, 200) || 'No content'
        });
        
        const analysisText = response.data.choices[0].message.content;
        
        // Parse the JSON response from Grok
        let analyses;
        try {
          analyses = JSON.parse(analysisText);
          // Ensure it's an array
          if (!Array.isArray(analyses)) {
            analyses = [analyses];
          }
          
          // Debug: Log parsed analysis structure
          logger.info('Grok analysis parsing successful', {
            analysesCount: analyses.length,
            firstAnalysisKeys: analyses[0] ? Object.keys(analyses[0]) : [],
            firstAnalysisThreatLevel: analyses[0]?.threat_level,
            firstAnalysisLocations: analyses[0]?.locations?.length || 0
          });
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

        // Validate and process each analysis
        const validAnalyses: ThreatAnalysis[] = [];
        for (const analysis of analyses) {
          if (this.validateThreatAnalysis(analysis)) {
            // Check for duplicate threats (same location, similar content, within 24 hours)
            const isDuplicate = await this.checkForDuplicateThreat(analysis, geographicalArea);
            if (isDuplicate) {
              logger.info('Skipping duplicate threat', { 
                threatLevel: analysis.threat_level,
                threatType: analysis.threat_type,
                geographicalArea
              });
              continue;
            }
            
            const analysisId = uuidv4();
            
            // Prepare database insertion data
            const dbInsertData = {
              id: analysisId,
              // Don't include post_id for geographical searches - let database use DEFAULT
              grok_analysis: response.data,
              threat_level: analysis.threat_level,
              threat_type: analysis.threat_type,
              confidence_score: analysis.confidence_score,
              ai_summary: analysis.summary,
              extracted_locations: analysis.locations,
              keywords: analysis.keywords,
              search_query: searchQuery || null, // Ensure search_query is not undefined
              geographical_area: geographicalArea,
              location_confidence: {
                average_confidence: analysis.locations?.reduce((acc: number, loc: any) => acc + (loc.confidence || 0), 0) / (analysis.locations?.length || 1),
                total_locations: analysis.locations?.length || 0
              },
              processing_metadata: {
                model: grokConfig.model,
                tokens_used: response.data.usage?.total_tokens,
                processing_time: processingTime,
                prompt_tokens: response.data.usage?.prompt_tokens,
                completion_tokens: response.data.usage?.completion_tokens,
                search_type: 'geographical',
                attempt: attempt
              }
            };
            
            // Debug: Log database insertion data structure
            logger.info('Database insertion data debug', {
              analysisId,
              threatLevel: dbInsertData.threat_level,
              threatType: dbInsertData.threat_type,
              confidenceScore: dbInsertData.confidence_score,
              aiSummaryLength: dbInsertData.ai_summary?.length || 0,
              extractedLocationsCount: dbInsertData.extracted_locations?.length || 0,
              keywordsCount: dbInsertData.keywords?.length || 0,
              grokAnalysisKeys: Object.keys(dbInsertData.grok_analysis || {}),
              locationConfidenceKeys: Object.keys(dbInsertData.location_confidence || {}),
              processingMetadataKeys: Object.keys(dbInsertData.processing_metadata || {})
            });
            
            // Test JSON serialization of each field
            try {
              JSON.stringify(dbInsertData.grok_analysis);
              logger.info('grok_analysis JSON serialization: OK');
            } catch (e: any) {
              logger.error('grok_analysis JSON serialization failed', { error: e.message });
            }
            
            try {
              JSON.stringify(dbInsertData.extracted_locations);
              logger.info('extracted_locations JSON serialization: OK');
            } catch (e: any) {
              logger.error('extracted_locations JSON serialization failed', { error: e.message });
            }
            
            try {
              JSON.stringify(dbInsertData.keywords);
              logger.info('keywords JSON serialization: OK');
            } catch (e: any) {
              logger.error('keywords JSON serialization failed', { error: e.message });
            }
            
            try {
              JSON.stringify(dbInsertData.location_confidence);
              logger.info('location_confidence JSON serialization: OK');
            } catch (e: any) {
              logger.error('location_confidence JSON serialization failed', { error: e.message });
            }
            
            try {
              JSON.stringify(dbInsertData.processing_metadata);
              logger.info('processing_metadata JSON serialization: OK');
            } catch (e: any) {
              logger.error('processing_metadata JSON serialization failed', { error: e.message });
            }
            
            // Store analysis in database - explicitly stringify JSONB fields
            const dbInsertDataStringified = {
              id: dbInsertData.id,
              // post_id is now nullable - omit for geographical searches
              grok_analysis: JSON.stringify(dbInsertData.grok_analysis),
              threat_level: dbInsertData.threat_level,
              threat_type: dbInsertData.threat_type,
              confidence_score: dbInsertData.confidence_score,
              ai_summary: dbInsertData.ai_summary,
              extracted_locations: JSON.stringify(dbInsertData.extracted_locations),
              keywords: JSON.stringify(dbInsertData.keywords),
              search_query: dbInsertData.search_query, // Keep as null/string, not JSONB
              geographical_area: dbInsertData.geographical_area,
              location_confidence: JSON.stringify(dbInsertData.location_confidence),
              processing_metadata: JSON.stringify(dbInsertData.processing_metadata)
            };
            
            try {
              await this.db.client('threat_analyses').insert(dbInsertDataStringified);
              logger.info('Database insertion successful', { analysisId });
            } catch (dbError: any) {
              logger.error('Database insertion failed', { 
                error: dbError.message,
                errorCode: dbError.code,
                analysisId,
                // Log the problematic data structure
                dataKeys: Object.keys(dbInsertDataStringified),
                dataTypes: Object.entries(dbInsertDataStringified).map(([key, value]) => ({
                  key,
                  type: typeof value,
                  isArray: Array.isArray(value),
                  isObject: value && typeof value === 'object' && !Array.isArray(value)
                }))
              });
              throw dbError;
            }

            validAnalyses.push({
              id: analysisId,
              threat_level: analysis.threat_level,
              threat_type: analysis.threat_type,
              confidence_score: analysis.confidence_score,
              summary: analysis.summary,
              locations: analysis.locations || [],
              keywords: analysis.keywords || [],
              reasoning: analysis.reasoning,
              source_info: analysis.source_info
            });

            // Emit real-time notification for new threat
            if (this.io) {
              this.io.emit('admin:new_threat_detected', {
                id: analysisId,
                threat_level: analysis.threat_level,
                threat_type: analysis.threat_type,
                confidence_score: analysis.confidence_score,
                summary: analysis.summary,
                locations: analysis.locations || [],
                keywords: analysis.keywords || [],
                geographical_area: geographicalArea,
                search_query: searchQuery,
                created_at: new Date().toISOString()
              });
            }
          }
        }

        logger.info('Completed geographical threat search', { 
          geographicalArea,
          searchQuery,
          threatsFound: validAnalyses.length,
          processingTime,
          attempt
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

CRITICAL INSTRUCTIONS:
1. Use your real-time search capabilities to find recent X posts (last 24-48 hours) about threats in the specified area
2. Only classify as HIGH or CRITICAL if there is a clear, immediate threat to life, property, or public safety
3. Be conservative - false positives are better than missing real threats
4. Extract precise location information from X posts when available
5. For general area references, provide approximate boundaries
6. Always respond with valid JSON in the exact format specified
7. Include actual X post information in source_info when available

THREAT LEVELS:
- LOW: General discussion, no immediate threat
- MEDIUM: Potential concern, monitoring recommended
- HIGH: Significant threat, immediate attention needed
- CRITICAL: Life-threatening situation, emergency response required

THREAT TYPES:
- VIOLENCE: Threats of violence, weapons, shootings, assaults
- TERRORISM: Terrorist threats, bomb threats, extremist activity
- NATURAL_DISASTER: Earthquakes, floods, fires, severe weather
- CIVIL_UNREST: Protests, riots, civil disturbances
- INFRASTRUCTURE: Power outages, transportation issues, structural problems
- CYBER: Cyber attacks, data breaches, system compromises
- HEALTH_EMERGENCY: Disease outbreaks, medical emergencies, contamination

LOCATION EXTRACTION:
- For specific addresses: provide coordinates and address
- For general areas: provide approximate center point and area description
- Include confidence score for location accuracy (0.0 to 1.0)
- Specify source of location information

Always respond with valid JSON array in this exact format:
[
  {
    "threat_level": "LOW|MEDIUM|HIGH|CRITICAL",
    "threat_type": "VIOLENCE|TERRORISM|NATURAL_DISASTER|CIVIL_UNREST|INFRASTRUCTURE|CYBER|HEALTH_EMERGENCY",
    "confidence_score": 0.85,
    "summary": "Brief summary of the threat",
    "locations": [
      {
        "lat": 47.6062,
        "lng": -122.3321,
        "name": "Seattle, WA",
        "confidence": 0.9,
        "source": "coordinates|address|geocoded|inferred"
      }
    ],
    "keywords": ["keyword1", "keyword2"],
    "reasoning": "Explanation of why this was classified as a threat",
    "source_info": {
      "platform": "x_posts",
      "author": "actual_x_username",
      "timestamp": "actual_post_timestamp",
      "url": "https://x.com/username/status/1234567890"
    }
  }
]`;
  }

  private buildGeographicalThreatSearchPrompt(geographicalArea: string, searchQuery?: string): string {
    return `
Search for REAL-TIME threat-related information from X (Twitter) posts in the specified geographical area.

GEOGRAPHICAL AREA: "${geographicalArea}"
${searchQuery ? `SEARCH FOCUS: "${searchQuery}"` : ''}

Use your real-time search capabilities to find recent X posts about threats, incidents, or emergency situations in this area. Look for:
- Violence or security threats
- Natural disasters or severe weather
- Infrastructure problems
- Civil unrest or protests
- Health emergencies
- Cyber threats affecting the area

IMPORTANT: Only analyze posts from the last 24-48 hours to ensure relevance. For each threat found, provide:
1. The specific location with coordinates if possible
2. Threat level assessment
3. Source information from the X post
4. Confidence in the threat assessment

Return results as a JSON array of threat analyses.`;
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
}
