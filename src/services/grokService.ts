import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { logger } from '../utils/logger';

export interface GrokConfiguration {
  id: string;
  api_key_encrypted: string;
  model: string;
  max_tokens: number;
  temperature: number;
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
  constructor(private db: DatabaseService) {}

  async createGrokConfiguration(configData: Partial<GrokConfiguration>, createdBy: string): Promise<GrokConfiguration> {
    const id = uuidv4();
    const config: GrokConfiguration = {
      id,
      api_key_encrypted: configData.api_key_encrypted!,
      model: configData.model || 'grok-4-latest',
      max_tokens: configData.max_tokens || 2000,
      temperature: configData.temperature || 0.3,
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

    await this.db.client('grok_configurations')
      .where('id', configId)
      .update(updateData);

    const updated = await this.db.client('grok_configurations')
      .where('id', configId)
      .first();

    logger.info('Updated Grok configuration', { configId, updates });
    return updated!;
  }

  async testGrokConnection(apiKey: string, model: string = 'grok-4-latest'): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      const axiosConfig = {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
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
        ],
        max_tokens: 10,
        temperature: 0,
        search_parameters: {
          mode: 'auto',
          sources: ['x_posts']
        }
      };

      logger.info('Testing Grok API connection', { 
        endpoint: 'https://api.x.ai/v1/chat/completions',
        model: model,
        hasApiKey: !!apiKey,
        searchParameters: {
          mode: 'auto',
          sources: ['x_posts']
        }
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
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
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
            }
        };
        
        logger.info('Making Grok API call for geographical threat search', 
            requestBody
        );

        const response = await axios.post('https://api.x.ai/v1/chat/completions', requestBody, {
          headers: {
            'Authorization': `Bearer ${grokConfig.api_key_encrypted}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60 second timeout for complex searches
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
        const analysisText = response.data.choices[0].message.content;
        
        // Parse the JSON response from Grok
        let analyses;
        try {
          analyses = JSON.parse(analysisText);
          // Ensure it's an array
          if (!Array.isArray(analyses)) {
            analyses = [analyses];
          }
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
            const analysisId = uuidv4();
            
            // Store analysis in database
            await this.db.client('threat_analyses').insert({
              id: analysisId,
              post_id: null, // No specific post for geographical searches
              grok_analysis: response.data,
              threat_level: analysis.threat_level,
              threat_type: analysis.threat_type,
              confidence_score: analysis.confidence_score,
              ai_summary: analysis.summary,
              extracted_locations: analysis.locations,
              keywords: analysis.keywords,
              search_query: searchQuery,
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
            });

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

  async analyzeThreatContent(content: string, location?: string): Promise<ThreatAnalysis | null> {
    const grokConfig = await this.getGrokConfiguration();
    if (!grokConfig) {
      throw new Error('No active Grok configuration found');
    }

    const prompt = this.buildContentAnalysisPrompt(content, location);
    
    try {
      const startTime = Date.now();
      
      logger.info('Making Grok API call for content analysis', {
        contentLength: content.length,
        location,
        model: grokConfig.model,
        maxTokens: grokConfig.max_tokens,
        temperature: grokConfig.temperature,
        searchParameters: {
          mode: 'auto',
          sources: ['x_posts']
        }
      });
      
      const response = await axios.post('https://api.x.ai/v1/chat/completions', {
        model: grokConfig.model,
        messages: [
          {
            role: 'system',
            content: this.getContentAnalysisSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: grokConfig.max_tokens,
        temperature: grokConfig.temperature,
        search_parameters: {
          mode: 'auto',
          sources: ['x_posts']
        }
      }, {
        headers: {
          'Authorization': `Bearer ${grokConfig.api_key_encrypted}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const processingTime = Date.now() - startTime;
      
      logger.info('Grok API response received for content analysis', {
        status: response.status,
        duration: `${processingTime}ms`,
        model: response.data.model,
        usage: response.data.usage,
        responseLength: response.data.choices?.[0]?.message?.content?.length || 0
      });
      
      const analysisText = response.data.choices[0].message.content;
      
      // Parse the JSON response from Grok
      let analysis;
      try {
        analysis = JSON.parse(analysisText);
      } catch (parseError) {
        logger.error('Failed to parse Grok content analysis response', { 
          error: parseError, 
          response: analysisText 
        });
        return null;
      }

      // Validate the analysis structure
      if (!this.validateThreatAnalysis(analysis)) {
        logger.error('Invalid analysis structure from Grok', { analysis });
        return null;
      }
      
      // Store analysis in database
      const analysisId = uuidv4();
      await this.db.client('threat_analyses').insert({
        id: analysisId,
        post_id: null,
        grok_analysis: response.data,
        threat_level: analysis.threat_level,
        threat_type: analysis.threat_type,
        confidence_score: analysis.confidence_score,
        ai_summary: analysis.summary,
        extracted_locations: analysis.locations,
        keywords: analysis.keywords,
        geographical_area: location,
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
          search_type: 'content_analysis'
        }
      });

      logger.info('Completed content threat analysis', { 
        analysisId, 
        threatLevel: analysis.threat_level,
        processingTime 
      });

      return {
        id: analysisId,
        threat_level: analysis.threat_level,
        threat_type: analysis.threat_type,
        confidence_score: analysis.confidence_score,
        summary: analysis.summary,
        locations: analysis.locations || [],
        keywords: analysis.keywords || [],
        reasoning: analysis.reasoning,
        source_info: analysis.source_info
      };

    } catch (error: any) {
      logger.error('Error in Grok content analysis', { 
        error: error.message, 
        model: grokConfig.model
      });
      return null;
    }
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

  private getContentAnalysisSystemPrompt(): string {
    return `You are a specialized threat detection AI for emergency services and security teams. Your job is to analyze provided content for potential security threats and emergency situations.

CRITICAL INSTRUCTIONS:
1. Only classify as HIGH or CRITICAL if there is a clear, immediate threat to life, property, or public safety
2. Be conservative - false positives are better than missing real threats
3. Extract any location information mentioned in the content
4. Always respond with valid JSON in the exact format specified

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

Always respond with valid JSON in this exact format:
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
    "platform": "content_analysis",
    "author": "unknown",
    "timestamp": "current_timestamp"
  }
}`;
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

  private buildContentAnalysisPrompt(content: string, location?: string): string {
    return `
Analyze this content for potential security threats:

CONTENT: "${content}"
${location ? `LOCATION CONTEXT: "${location}"` : ''}

Please analyze this content and return a JSON response with your threat assessment.`;
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
}
