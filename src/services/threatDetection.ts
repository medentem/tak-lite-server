import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';
import { GrokService, ThreatAnalysis as GrokThreatAnalysis } from './grokService';
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
  private grokService: GrokService;

  constructor(private db: DatabaseService) {
    this.grokService = new GrokService(db);
  }

  async createAIConfiguration(configData: Partial<AIConfiguration>, createdBy: string): Promise<AIConfiguration> {
    // Delegate to Grok service for new configurations
    const grokConfig = await this.grokService.createGrokConfiguration({
      api_key_encrypted: configData.api_key_encrypted!,
      model: configData.model || 'grok-4-latest',
      max_tokens: configData.max_tokens || 2000,
      temperature: configData.temperature || 0.3,
      is_active: configData.is_active !== false
    }, createdBy);

    // Create legacy AI configuration for backward compatibility
    const id = uuidv4();
    const config: AIConfiguration = {
      id,
      provider: 'grok',
      api_key_encrypted: configData.api_key_encrypted!,
      model: configData.model || 'grok-4-latest',
      max_tokens: configData.max_tokens || 2000,
      temperature: configData.temperature || 0.3,
      is_active: configData.is_active !== false,
      created_by: createdBy,
      created_at: new Date(),
      updated_at: new Date()
    };

    await this.db.client('ai_configurations').insert(config);
    
    logger.info('Created AI configuration (Grok)', { id, model: config.model });
    return config;
  }

  async getAIConfiguration(): Promise<AIConfiguration | null> {
    return await this.db.client('ai_configurations')
      .where({ is_active: true })
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

  async testAIConnection(apiKey: string, model: string = 'grok-4-latest'): Promise<{ success: boolean; error?: string; model?: string }> {
    // Delegate to Grok service for connection testing
    return await this.grokService.testGrokConnection(apiKey, model);
  }

  async analyzePost(post: any): Promise<ThreatAnalysis | null> {
    // Use Grok service for content analysis
    const content = post.text || '';
    const location = post.author?.location;
    
    const grokAnalysis = await this.grokService.analyzeThreatContent(content, location);
    
    if (!grokAnalysis) {
      logger.warn('No threat analysis returned from Grok', { postId: post.id });
      return null;
    }

    // Convert Grok analysis to legacy format
    const analysisId = uuidv4();
    await this.db.client('threat_analyses').insert({
      id: analysisId,
      post_id: post.id,
      grok_analysis: grokAnalysis,
      threat_level: grokAnalysis.threat_level,
      threat_type: grokAnalysis.threat_type,
      confidence_score: grokAnalysis.confidence_score,
      ai_summary: grokAnalysis.summary,
      extracted_locations: grokAnalysis.locations,
      keywords: grokAnalysis.keywords,
      processing_metadata: {
        model: 'grok-4-latest',
        search_type: 'content_analysis',
        legacy_post_analysis: true
      }
    });

    logger.info('Completed threat analysis (Grok)', { 
      analysisId, 
      postId: post.id, 
      threatLevel: grokAnalysis.threat_level
    });

    return {
      id: analysisId,
      post_id: post.id,
      threat_level: grokAnalysis.threat_level,
      threat_type: grokAnalysis.threat_type,
      confidence_score: grokAnalysis.confidence_score,
      ai_summary: grokAnalysis.summary,
      extracted_locations: grokAnalysis.locations,
      keywords: grokAnalysis.keywords,
      reasoning: grokAnalysis.reasoning
    };
  }

  // New method for geographical threat search
  async searchGeographicalThreats(geographicalArea: string, searchQuery?: string): Promise<GrokThreatAnalysis[]> {
    return await this.grokService.searchThreats(geographicalArea, searchQuery);
  }

  // Legacy methods removed - now handled by GrokService

  async getThreatAnalyses(filters: {
    threat_level?: string;
    threat_type?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ThreatAnalysis[]> {
    try {
      let query = this.db.client('threat_analyses as ta')
        .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
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
    } catch (error: any) {
      logger.error('Error getting threat analyses', { error: error.message });
      // Return empty array to prevent crashes
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
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Total threats
      const totalThreats = await this.db.client('threat_analyses as ta')
        .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
        .where('ta.created_at', '>=', since)
        .count('* as count')
        .first();

      // By threat level
      const byLevel = await this.db.client('threat_analyses as ta')
        .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
        .where('ta.created_at', '>=', since)
        .select('ta.threat_level')
        .count('* as count')
        .groupBy('ta.threat_level');

      // By threat type
      const byType = await this.db.client('threat_analyses as ta')
        .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
        .where('ta.created_at', '>=', since)
        .select('ta.threat_type')
        .count('* as count')
        .groupBy('ta.threat_type');

      // Recent trend (daily counts)
      const recentTrend = await this.db.client('threat_analyses as ta')
        .join('social_media_posts as smp', 'ta.post_id', 'smp.id')
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
    } catch (error: any) {
      logger.error('Error getting threat statistics', { error: error.message });
      // Return empty statistics to prevent crashes
      return {
        total_threats: 0,
        by_level: {},
        by_type: {},
        recent_trend: []
      };
    }
  }
}
