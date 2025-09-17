import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { logger } from '../utils/logger';

export interface ThreatAnalysis {
  id: string;
  post_id: string;
  threat_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  threat_type?: 'VIOLENCE' | 'TERRORISM' | 'NATURAL_DISASTER' | 'CIVIL_UNREST' | 'INFRASTRUCTURE' | 'CYBER' | 'HEALTH_EMERGENCY';
  confidence_score: number;
  ai_summary?: string;
  extracted_locations?: Array<{ lat: number; lng: number; name?: string }>;
  keywords?: string[];
  reasoning?: string;
}

export interface AIConfiguration {
  id: string;
  team_id: string;
  provider: string;
  api_key_encrypted: string;
  model: string;
  max_tokens: number;
  temperature: number;
  is_active: boolean;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export class ThreatDetectionService {
  constructor(private db: DatabaseService) {}

  async createAIConfiguration(teamId: string, configData: Partial<AIConfiguration>, createdBy: string): Promise<AIConfiguration> {
    const id = uuidv4();
    const config: AIConfiguration = {
      id,
      team_id: teamId,
      provider: configData.provider || 'openai',
      api_key_encrypted: configData.api_key_encrypted!,
      model: configData.model || 'gpt-4',
      max_tokens: configData.max_tokens || 1000,
      temperature: configData.temperature || 0.3,
      is_active: configData.is_active !== false,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    };

    await this.db.client('ai_configurations').insert(config);
    
    logger.info('Created AI configuration', { id, teamId, model: config.model });
    return config;
  }

  async getAIConfiguration(teamId: string): Promise<AIConfiguration | null> {
    return await this.db.client('ai_configurations')
      .where({ team_id: teamId, is_active: true })
      .first() || null;
  }

  async updateAIConfiguration(configId: string, updates: Partial<AIConfiguration>): Promise<AIConfiguration> {
    const updateData = {
      ...updates,
      updated_at: new Date()
    };

    await this.db.client('ai_configurations')
      .where('id', configId)
      .update(updateData);

    const updated = await this.db.client('ai_configurations')
      .where('id', configId)
      .first();

    logger.info('Updated AI configuration', { configId, updates });
    return updated!;
  }

  async testAIConnection(apiKey: string, model: string = 'gpt-4'): Promise<{ success: boolean; error?: string; model?: string }> {
    try {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
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
        temperature: 0
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      return {
        success: true,
        model: response.data.model
      };
    } catch (error: any) {
      logger.error('AI connection test failed', { error: error.message });
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message || 'Connection failed'
      };
    }
  }

  async analyzePost(post: any): Promise<ThreatAnalysis | null> {
    const aiConfig = await this.getAIConfiguration(post.team_id || 'default');
    if (!aiConfig) {
      logger.warn('No AI configuration found for threat analysis', { postId: post.id });
      return null;
    }

    const prompt = this.buildThreatAnalysisPrompt(post);
    
    try {
      const startTime = Date.now();
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: aiConfig.model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: aiConfig.max_tokens,
        temperature: aiConfig.temperature
      }, {
        headers: {
          'Authorization': `Bearer ${aiConfig.api_key_encrypted}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const processingTime = Date.now() - startTime;
      const analysisText = response.data.choices[0].message.content;
      
      // Parse the JSON response from OpenAI
      let analysis;
      try {
        analysis = JSON.parse(analysisText);
      } catch (parseError) {
        logger.error('Failed to parse AI analysis response', { 
          error: parseError, 
          response: analysisText 
        });
        return null;
      }

      // Validate the analysis structure
      if (!this.validateAnalysis(analysis)) {
        logger.error('Invalid analysis structure from AI', { analysis });
        return null;
      }
      
      // Store analysis in database
      const analysisId = uuidv4();
      await this.db.client('threat_analyses').insert({
        id: analysisId,
        post_id: post.id,
        openai_analysis: response.data,
        threat_level: analysis.threat_level,
        threat_type: analysis.threat_type,
        confidence_score: analysis.confidence_score,
        ai_summary: analysis.summary,
        extracted_locations: analysis.locations,
        keywords: analysis.keywords,
        processing_metadata: {
          model: aiConfig.model,
          tokens_used: response.data.usage?.total_tokens,
          processing_time: processingTime,
          prompt_tokens: response.data.usage?.prompt_tokens,
          completion_tokens: response.data.usage?.completion_tokens
        }
      });

      logger.info('Completed threat analysis', { 
        analysisId, 
        postId: post.id, 
        threatLevel: analysis.threat_level,
        processingTime 
      });

      return {
        id: analysisId,
        post_id: post.id,
        threat_level: analysis.threat_level,
        threat_type: analysis.threat_type,
        confidence_score: analysis.confidence_score,
        ai_summary: analysis.summary,
        extracted_locations: analysis.locations,
        keywords: analysis.keywords,
        reasoning: analysis.reasoning
      };

    } catch (error: any) {
      logger.error('Error in AI threat analysis', { 
        error: error.message, 
        postId: post.id,
        model: aiConfig.model
      });
      return null;
    }
  }

  private getSystemPrompt(): string {
    return `You are a specialized threat detection AI for emergency services and security teams. Your job is to analyze social media posts for potential security threats and emergency situations.

CRITICAL INSTRUCTIONS:
1. Only classify as HIGH or CRITICAL if there is a clear, immediate threat to life, property, or public safety
2. Be conservative - false positives are better than missing real threats
3. Consider the credibility of the source (verified accounts, follower count, etc.)
4. Look for specific indicators of violence, terrorism, natural disasters, civil unrest, infrastructure threats, or health emergencies
5. Extract any location information mentioned in the post
6. Always respond with valid JSON in the exact format specified

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
  "locations": [{"lat": 47.6062, "lng": -122.3321, "name": "Seattle, WA"}],
  "keywords": ["keyword1", "keyword2"],
  "reasoning": "Explanation of why this was classified as a threat"
}`;
  }

  private buildThreatAnalysisPrompt(post: any): string {
    return `
Analyze this social media post for potential security threats:

POST CONTENT: "${post.text}"

AUTHOR INFO:
- Username: ${post.author?.userName || 'Unknown'}
- Name: ${post.author?.name || 'Unknown'}
- Location: ${post.author?.location || 'Not specified'}
- Followers: ${post.author?.followers || 0}
- Verified: ${post.author?.isBlueVerified || false}

ENGAGEMENT:
- Retweets: ${post.retweetCount || 0}
- Likes: ${post.likeCount || 0}
- Replies: ${post.replyCount || 0}
- Views: ${post.viewCount || 'Unknown'}

POST METADATA:
- Created: ${post.createdAt || 'Unknown'}
- Language: ${post.lang || 'Unknown'}

Please analyze this post and return a JSON response with your threat assessment.`;
  }

  private validateAnalysis(analysis: any): boolean {
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

  async getThreatAnalyses(teamId: string, filters: {
    threat_level?: string;
    threat_type?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ThreatAnalysis[]> {
    let query = this.db.client('threat_analyses as ta')
      .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
      .join('social_media_monitors as smm', 'smp.monitor_id', 'smm.id')
      .where('smm.team_id', teamId)
      .select('ta.*')
      .orderBy('ta.created_at', 'desc');

    if (filters.threat_level) {
      query = query.where('ta.threat_level', filters.threat_level);
    }

    if (filters.threat_type) {
      query = query.where('ta.threat_type', filters.threat_type);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    if (filters.offset) {
      query = query.offset(filters.offset);
    }

    return await query;
  }

  async getThreatStatistics(teamId: string, days: number = 7): Promise<{
    total_threats: number;
    by_level: Record<string, number>;
    by_type: Record<string, number>;
    recent_trend: Array<{ date: string; count: number }>;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Total threats
    const totalThreats = await this.db.client('threat_analyses as ta')
      .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
      .join('social_media_monitors as smm', 'smp.monitor_id', 'smm.id')
      .where('smm.team_id', teamId)
      .where('ta.created_at', '>=', since)
      .count('* as count')
      .first();

    // By threat level
    const byLevel = await this.db.client('threat_analyses as ta')
      .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
      .join('social_media_monitors as smm', 'smp.monitor_id', 'smm.id')
      .where('smm.team_id', teamId)
      .where('ta.created_at', '>=', since)
      .select('ta.threat_level')
      .count('* as count')
      .groupBy('ta.threat_level');

    // By threat type
    const byType = await this.db.client('threat_analyses as ta')
      .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
      .join('social_media_monitors as smm', 'smp.monitor_id', 'smm.id')
      .where('smm.team_id', teamId)
      .where('ta.created_at', '>=', since)
      .select('ta.threat_type')
      .count('* as count')
      .groupBy('ta.threat_type');

    // Recent trend (daily counts)
    const recentTrend = await this.db.client('threat_analyses as ta')
      .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
      .join('social_media_monitors as smm', 'smp.monitor_id', 'smm.id')
      .where('smm.team_id', teamId)
      .where('ta.created_at', '>=', since)
      .select(this.db.client.raw('DATE(ta.created_at) as date'))
      .count('* as count')
      .groupBy(this.db.client.raw('DATE(ta.created_at)'))
      .orderBy('date', 'asc');

    return {
      total_threats: parseInt(totalThreats?.count as string) || 0,
      by_level: byLevel.reduce((acc: any, row: any) => {
        acc[row.threat_level] = parseInt(row.count);
        return acc;
      }, {}),
      by_type: byType.reduce((acc: any, row: any) => {
        acc[row.threat_type] = parseInt(row.count);
        return acc;
      }, {}),
      recent_trend: recentTrend.map((row: any) => ({
        date: row.date,
        count: parseInt(row.count)
      }))
    };
  }
}
