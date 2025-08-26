import { Router } from 'express';
import { SyncService } from '../services/sync';

export function createSyncRouter(sync: SyncService) {
  const router = Router();

  router.post('/location', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      await sync.handleLocationUpdate(req.user.sub, req.body);
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.post('/annotation', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const annotation = await sync.handleAnnotationUpdate(req.user.sub, req.body);
      res.json(annotation);
    } catch (err) { next(err); }
  });

  router.post('/message', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const message = await sync.handleMessage(req.user.sub, req.body);
      res.json(message);
    } catch (err) { next(err); }
  });

  // Read: last known locations for a team
  router.get('/locations/last', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const teamId = String(req.query.teamId || '');
      if (!teamId) return res.status(400).json({ error: 'teamId is required' });
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

  // Read: annotations for a team
  router.get('/annotations', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const teamId = String(req.query.teamId || '');
      if (!teamId) return res.status(400).json({ error: 'teamId is required' });
      const db = (sync as any).db as import('../services/database').DatabaseService;
      await sync.assertTeamMembership(req.user.sub, teamId);
      const rows = await db.client('annotations').where({ team_id: teamId }).orderBy('updated_at', 'desc');
      res.json(rows);
    } catch (err) { next(err); }
  });

  // Read: recent messages for a team (paged)
  router.get('/messages', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      const teamId = String(req.query.teamId || '');
      if (!teamId) return res.status(400).json({ error: 'teamId is required' });
      const limit = Math.min(Number(req.query.limit || 50), 200);
      const before = req.query.before ? new Date(String(req.query.before)) : null;
      const db = (sync as any).db as import('../services/database').DatabaseService;
      await sync.assertTeamMembership(req.user.sub, teamId);
      let q = db.client('messages').where({ team_id: teamId }).orderBy('created_at', 'desc').limit(limit);
      if (before) q = q.andWhere('created_at', '<', before);
      const rows = await q;
      res.json(rows);
    } catch (err) { next(err); }
  });

  return router;
}


