import { Router } from 'express';
import { SyncService } from '../services/sync';
import rateLimit from 'express-rate-limit';
import Joi from 'joi';

export function createSyncRouter(sync: SyncService) {
  const router = Router();

  // Limit sync write requests per IP to reduce abuse; tune as needed
  const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

  router.post('/location', writeLimiter, async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      await sync.handleLocationUpdate(req.user.sub, req.body);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.post('/annotation', writeLimiter, async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const annotation = await sync.handleAnnotationUpdate(req.user.sub, req.body);
      res.json(annotation);
    } catch (err) { next(err); }
  });

  router.post('/message', writeLimiter, async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const message = await sync.handleMessage(req.user.sub, req.body);
      res.json(message);
    } catch (err) { next(err); }
  });

  // Delete: single annotation
  router.delete('/annotation/:annotationId', writeLimiter, async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      
      const qSchema = Joi.object({ teamId: Joi.string().uuid().required() });
      const { teamId } = await qSchema.validateAsync({ teamId: req.query.teamId });
      
      const result = await sync.handleAnnotationDelete(req.user.sub, {
        teamId,
        annotationId: req.params.annotationId
      });
      
      res.json(result);
    } catch (err) { next(err); }
  });

  // Delete: bulk annotations
  router.delete('/annotations/bulk', writeLimiter, async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      
      const schema = Joi.object({
        teamId: Joi.string().uuid().required(),
        annotationIds: Joi.array().items(Joi.string().uuid()).min(1).max(100).required()
      });
      const { teamId, annotationIds } = await schema.validateAsync(req.body);
      
      const result = await sync.handleBulkAnnotationDelete(req.user.sub, {
        teamId,
        annotationIds
      });
      
      res.json(result);
    } catch (err) { next(err); }
  });

  // Read: last known locations for a team
  router.get('/locations/last', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const qSchema = Joi.object({ teamId: Joi.string().uuid().required() });
      const { teamId } = await qSchema.validateAsync({ teamId: req.query.teamId });
      // delegate to DB via sync service patterns later; do direct query for P0
      const db = (sync as any).db as import('../services/database').DatabaseService;
      await sync.assertTeamMembership(req.user.sub, teamId);
      const rows = await db
        .client
        .raw(
          `SELECT DISTINCT ON (user_id) user_id, team_id, latitude, longitude, altitude, accuracy, timestamp, created_at
           FROM locations
           WHERE team_id = ?
           ORDER BY user_id, timestamp DESC`,
          [teamId]
        );
      res.json(rows.rows || []);
    } catch (err) { next(err); }
  });

  // Read: annotations for a team (or all teams if teamId is null)
  router.get('/annotations', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const qSchema = Joi.object({ teamId: Joi.string().uuid().allow(null).optional() });
      const { teamId } = await qSchema.validateAsync({ teamId: req.query.teamId || null });
      const db = (sync as any).db as import('../services/database').DatabaseService;
      
      let query = db.client('annotations').orderBy('updated_at', 'desc');
      
      // If teamId is provided, show team data + global data (null team_id)
      if (teamId) {
        await sync.assertTeamMembership(req.user.sub, teamId);
        query = query.where(function() {
          this.where('team_id', teamId).orWhereNull('team_id');
        });
      }
      // If teamId is null, show annotations for all teams (no filtering)
      
      const rows = await query;
      res.json(rows);
    } catch (err) { next(err); }
  });

  // Read: recent messages for a team (or all teams if teamId is null)
  router.get('/messages', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const qSchema = Joi.object({
        teamId: Joi.string().uuid().allow(null).optional(),
        limit: Joi.number().integer().min(1).max(200).default(50),
        before: Joi.date().optional()
      });
      const { teamId, limit, before } = await qSchema.validateAsync({
        teamId: req.query.teamId || null,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        before: req.query.before
      });
      const db = (sync as any).db as import('../services/database').DatabaseService;
      
      let query = db.client('messages').orderBy('created_at', 'desc').limit(limit);
      
      // If teamId is provided, show team data + global data (null team_id)
      if (teamId) {
        await sync.assertTeamMembership(req.user.sub, teamId);
        query = query.where(function() {
          this.where('team_id', teamId).orWhereNull('team_id');
        });
      }
      // If teamId is null, show messages for all teams (no filtering)
      
      if (before) {
        query = query.andWhere('created_at', '<', before);
      }
      
      const rows = await query;
      res.json(rows);
    } catch (err) { next(err); }
  });

  return router;
}


