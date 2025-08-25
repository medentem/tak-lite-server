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

  return router;
}


