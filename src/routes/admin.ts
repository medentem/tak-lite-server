import { Router } from 'express';
import os from 'os';
import { Server } from 'socket.io';
import { DatabaseService } from '../services/database';
import Joi from 'joi';
import { ConfigService } from '../services/config';

export function createAdminRouter(config: ConfigService, db?: DatabaseService, io?: Server) {
  const router = Router();

  router.get('/config', async (_req, res) => {
    const corsOrigin = await config.get<string>('security.cors_origin');
    const orgName = await config.get<string>('org.name');
    res.json({ corsOrigin: corsOrigin || '', orgName: orgName || '' });
  });

  router.put('/config', async (req, res, next) => {
    try {
      const schema = Joi.object({
        corsOrigin: Joi.string().allow('').required(),
        orgName: Joi.string().min(2).required()
      });
      const { corsOrigin, orgName } = await schema.validateAsync(req.body);
      await config.set('security.cors_origin', corsOrigin);
      await config.set('org.name', orgName);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/status', async (_req, res) => {
    res.json({ setupCompleted: !!(await config.get('setup.completed')) });
  });

  // Operational stats for the Admin Dashboard
  router.get('/stats', async (_req, res, next) => {
    try {
      const [users, teams, annotations, messages, locations] = db
        ? await Promise.all([
            db.client('users').count<{ count: string }>('id as count').first(),
            db.client('teams').count<{ count: string }>('id as count').first(),
            db.client('annotations').count<{ count: string }>('id as count').first(),
            db.client('messages').count<{ count: string }>('id as count').first(),
            db.client('locations').count<{ count: string }>('id as count').first()
          ])
        : [undefined, undefined, undefined, undefined, undefined];

      const socketsTotal = io ? io.engine.clientsCount : 0;
      const socketsAuth = io
        ? Array.from(io.sockets.sockets.values()).filter((s) => (s.data as any)?.user).length
        : 0;
      const rooms = io
        ? Object.fromEntries(
            Array.from(io.sockets.adapter.rooms.entries())
              .filter(([name]) => name.startsWith('team:'))
              .map(([name, set]) => [name, set.size])
          )
        : {};

      const mem = process.memoryUsage();
      const stats = {
        server: {
          pid: process.pid,
          node: process.version,
          uptimeSec: Math.round(process.uptime()),
          loadavg: os.loadavg(),
          memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal }
        },
        db: {
          users: users ? Number(users.count) : undefined,
          teams: teams ? Number(teams.count) : undefined,
          annotations: annotations ? Number(annotations.count) : undefined,
          messages: messages ? Number(messages.count) : undefined,
          locations: locations ? Number(locations.count) : undefined
        },
        sockets: {
          totalConnections: socketsTotal,
          authenticatedConnections: socketsAuth,
          rooms
        }
      };
      res.json(stats);
    } catch (err) {
      next(err);
    }
  });

  return router;
}


