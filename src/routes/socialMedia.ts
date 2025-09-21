import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { DatabaseService } from '../services/database';
import { SocialMediaMonitoringService } from '../services/socialMediaMonitoring';
import { SocialMediaConfigService } from '../services/socialMediaConfig';
import { logger } from '../utils/logger';

export function createSocialMediaRouter(
  databaseService: DatabaseService,
  socialMediaService: SocialMediaMonitoringService,
  configService: SocialMediaConfigService
): Router {
  const router = Router();

  // Validation schemas
  // Legacy monitor schemas removed - use geographical monitoring instead

  const aiConfigSchema = Joi.object({
    api_key_encrypted: Joi.string().required(),
    model: Joi.string().valid('grok-4-latest', 'grok-4-fast-reasoning-latest', 'grok-3-latest', 'grok-3-mini-latest').default('grok-4-latest'),
    is_active: Joi.boolean().default(true)
  });

  const geographicalSearchSchema = Joi.object({
    geographical_area: Joi.string().min(1).max(1000).required(),
    search_query: Joi.string().max(1000).allow('').optional(),
    monitoring_interval: Joi.number().integer().min(60).max(3600).default(300),
    is_active: Joi.boolean().default(true)
  });

  // Legacy monitor endpoints removed - use geographical monitoring instead

  // AI Configuration endpoints
  router.get('/ai-config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = (req as any).user.teamId;
      const config = await socialMediaService.getAIConfiguration();
      
      if (!config) {
        // Return null config instead of 404 - frontend can handle this
        return res.json({ config: null });
      }

      // Remove sensitive API key from response
      const safeConfig = {
        ...config,
        api_key_encrypted: '***'
      };

      res.json({ config: safeConfig });
    } catch (error) {
      next(error);
    }
  });

  router.post('/ai-config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = (req as any).user.teamId;
      const userId = (req as any).user.id;
      
      const { error, value } = aiConfigSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const config = await socialMediaService.createAIConfiguration(value, userId);
      
      // Remove sensitive API key from response
      const safeConfig = {
        ...config,
        api_key_encrypted: '***'
      };

      res.status(201).json({ config: safeConfig });
    } catch (error) {
      next(error);
    }
  });

  router.put('/ai-config/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const teamId = (req as any).user.teamId;
      
      const { error, value } = aiConfigSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const config = await socialMediaService.updateAIConfiguration(id, value);
      
      // Remove sensitive API key from response
      const safeConfig = {
        ...config,
        api_key_encrypted: '***'
      };

      res.json({ config: safeConfig });
    } catch (error) {
      next(error);
    }
  });

  // Test AI connection
  router.post('/test-ai', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { api_key, model } = req.body;
      
      if (!api_key) {
        return res.status(400).json({ error: 'API key is required' });
      }

      const result = await socialMediaService.testAIConnection(api_key, model);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // Geographical monitoring endpoints
  router.get('/geographical-monitors', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const monitors = await socialMediaService.getGeographicalMonitors();
      res.json({ monitors });
    } catch (error) {
      next(error);
    }
  });

  router.post('/geographical-monitors', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user.id;
      
      const { error, value } = geographicalSearchSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const monitor = await socialMediaService.createGeographicalMonitor(value, userId);
      res.status(201).json({ monitor });
    } catch (error) {
      next(error);
    }
  });

  router.put('/geographical-monitors/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      const { error, value } = geographicalSearchSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const updatedMonitor = await socialMediaService.updateGeographicalMonitor(id, value);
      res.json({ monitor: updatedMonitor });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/geographical-monitors/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      await socialMediaService.deleteGeographicalMonitor(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post('/geographical-monitors/:id/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      await socialMediaService.startGeographicalMonitoring(id);
      res.json({ message: 'Geographical monitoring started' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/geographical-monitors/:id/stop', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      
      await socialMediaService.stopGeographicalMonitoring(id);
      res.json({ message: 'Geographical monitoring stopped' });
    } catch (error) {
      next(error);
    }
  });

  // Direct geographical threat search endpoint
  router.post('/search-threats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { geographical_area, search_query, last_search_time } = req.body;
      
      if (!geographical_area) {
        return res.status(400).json({ error: 'Geographical area is required' });
      }

      // Parse last_search_time if provided
      const lastSearchTime = last_search_time ? new Date(last_search_time) : undefined;

      const threats = await socialMediaService.searchGeographicalThreats(geographical_area, search_query, lastSearchTime);
      res.json({ threats });
    } catch (error) {
      next(error);
    }
  });

  // Get threat analyses
  router.get('/threats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = (req as any).user.teamId;
      const { threat_level, threat_type, limit = 50, offset = 0 } = req.query;
      
      const filters: any = { limit: parseInt(limit as string), offset: parseInt(offset as string) };
      if (threat_level) filters.threat_level = threat_level as string;
      if (threat_type) filters.threat_type = threat_type as string;

      const threats = await socialMediaService.getThreatAnalyses(filters);
      res.json({ threats });
    } catch (error) {
      next(error);
    }
  });

  // Get threat statistics
  router.get('/threats/statistics', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = (req as any).user.teamId;
      const { days = 7 } = req.query;
      
      const stats = await socialMediaService.getThreatStatistics(parseInt(days as string));
      res.json({ statistics: stats });
    } catch (error) {
      next(error);
    }
  });

  // Get threat annotations (for map display)
  router.get('/threat-annotations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const teamId = (req as any).user.teamId;
      const { threat_level, is_verified, limit = 100 } = req.query;
      
      let query = databaseService.client('threat_annotations')
        .where('team_id', teamId)
        .where('expires_at', '>', new Date()) // Only active threats
        .orderBy('created_at', 'desc');

      if (threat_level) {
        query = query.where('threat_level', threat_level);
      }

      if (is_verified !== undefined) {
        query = query.where('is_verified', is_verified === 'true');
      }

      if (limit) {
        query = query.limit(parseInt(limit as string));
      }

      const annotations = await query;
      res.json({ annotations });
    } catch (error) {
      next(error);
    }
  });

  // Verify/dismiss a threat
  router.post('/threat-annotations/:id/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { is_verified } = req.body;
      const userId = (req as any).user.id;
      const teamId = (req as any).user.teamId;
      
      if (typeof is_verified !== 'boolean') {
        return res.status(400).json({ error: 'is_verified must be a boolean' });
      }

      const annotation = await databaseService.client('threat_annotations')
        .where({ id, team_id: teamId })
        .first();

      if (!annotation) {
        return res.status(404).json({ error: 'Threat annotation not found' });
      }

      await databaseService.client('threat_annotations')
        .where('id', id)
        .update({
          is_verified,
          verified_by: is_verified ? userId : null,
          verified_at: is_verified ? new Date() : null,
          updated_at: new Date()
        });

      res.json({ message: `Threat ${is_verified ? 'verified' : 'dismissed'}` });
    } catch (error) {
      next(error);
    }
  });

  // Service control endpoints
  router.get('/service/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await socialMediaService.getServiceStatus();
      res.json({ status });
    } catch (error) {
      next(error);
    }
  });

  router.post('/service/toggle', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }

      await socialMediaService.toggleService(enabled);
      const status = await socialMediaService.getServiceStatus();
      
      res.json({ 
        message: `Service ${enabled ? 'enabled' : 'disabled'}`,
        status 
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/service/start-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await socialMediaService.startAllMonitors();
      res.json({ 
        message: 'Started all monitors',
        result 
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/service/stop-all', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await socialMediaService.stopAllMonitors();
      res.json({ 
        message: 'Stopped all monitors',
        result 
      });
    } catch (error) {
      next(error);
    }
  });

  // Service configuration endpoints
  router.get('/service/config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await configService.getServiceConfig();
      res.json({ config });
    } catch (error) {
      next(error);
    }
  });

  router.put('/service/config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { 
        auto_start_monitors, 
        max_monitors_per_team, 
        default_monitoring_interval,
        max_posts_per_hour
      } = req.body;

      const updates: any = {};
      
      if (auto_start_monitors !== undefined) updates.auto_start_monitors = auto_start_monitors;
      if (max_monitors_per_team !== undefined) updates.max_monitors_per_team = max_monitors_per_team;
      if (default_monitoring_interval !== undefined) updates.default_monitoring_interval = default_monitoring_interval;

      if (Object.keys(updates).length > 0) {
        await configService.updateServiceConfig(updates);
      }

      if (max_posts_per_hour !== undefined) {
        await configService.updateUsageLimits({ max_posts_per_hour });
      }

      const config = await configService.getServiceConfig();
      res.json({ 
        message: 'Service configuration updated',
        config 
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
