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

  // Read: annotations for a team (teamId required; paginated)
  router.get('/annotations', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const qSchema = Joi.object({
        teamId: Joi.string().uuid().required(),
        limit: Joi.number().integer().min(1).max(500).default(100),
        offset: Joi.number().integer().min(0).default(0)
      }).options({ stripUnknown: true });
      const { teamId, limit, offset } = await qSchema.validateAsync({
        teamId: req.query.teamId,
        limit: req.query.limit != null ? Number(req.query.limit) : 100,
        offset: req.query.offset != null ? Number(req.query.offset) : 0
      });
      await sync.assertTeamMembership(req.user.sub, teamId);
      const db = (sync as any).db as import('../services/database').DatabaseService;
      const rows = await db.client('annotations')
        .where(function() {
          this.where('team_id', teamId).orWhereNull('team_id');
        })
        .orderBy('updated_at', 'desc')
        .limit(limit)
        .offset(offset);
      // Exclude expired annotations: respect expirationTime (epoch ms) from annotation data
      const now = Date.now();
      const active = rows.filter((row: { data?: { expirationTime?: number } }) => {
        const exp = row.data?.expirationTime;
        return exp == null || (typeof exp === 'number' && exp > now);
      });
      res.json(active);
    } catch (err) { next(err); }
  });

  // Read: recent messages for a team (teamId required)
  router.get('/messages', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const qSchema = Joi.object({
        teamId: Joi.string().uuid().required(),
        limit: Joi.number().integer().min(1).max(200).default(50),
        before: Joi.date().optional()
      }).options({ stripUnknown: true });
      const { teamId, limit, before } = await qSchema.validateAsync({
        teamId: req.query.teamId,
        limit: req.query.limit != null ? Number(req.query.limit) : 50,
        before: req.query.before
      });
      await sync.assertTeamMembership(req.user.sub, teamId);
      const db = (sync as any).db as import('../services/database').DatabaseService;
      let query = db.client('messages')
        .where(function() {
          this.where('team_id', teamId).orWhereNull('team_id');
        })
        .orderBy('created_at', 'desc')
        .limit(limit);
      if (before) {
        query = query.andWhere('created_at', '<', before);
      }
      const rows = await query;
      res.json(rows);
    } catch (err) { next(err); }
  });

  return router;
}


