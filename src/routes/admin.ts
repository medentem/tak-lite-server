import { Router } from 'express';
import os from 'os';
import { Server } from 'socket.io';
import { DatabaseService } from '../services/database';
import Joi from 'joi';
import { ConfigService } from '../services/config';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

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

  // Lightweight team/user reads to support visibility and credential distribution
  router.get('/teams', async (_req, res, next) => {
    try {
      if (!db) return res.json([]);
      const teams = await db.client('teams').select(['id', 'name', 'created_at']).orderBy('name');
      res.json(teams);
    } catch (err) { next(err); }
  });

  router.get('/teams/:teamId/members', async (req, res, next) => {
    try {
      if (!db) return res.json([]);
      const members = await db
        .client('team_memberships as tm')
        .join('users as u', 'u.id', 'tm.user_id')
        .where('tm.team_id', req.params.teamId)
        .select(['u.id', 'u.email', 'u.name', 'u.is_admin']);
      res.json(members);
    } catch (err) { next(err); }
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

  // --- Users management (admin) ---
  router.get('/users', async (_req, res, next) => {
    try {
      if (!db) return res.json([]);
      const users = await db.client('users').select(['id', 'email', 'name', 'is_admin', 'created_at']).orderBy('created_at', 'desc');
      res.json(users);
    } catch (err) { next(err); }
  });

  router.post('/users', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ email: Joi.string().email().required(), name: Joi.string().min(1).default(''), is_admin: Joi.boolean().default(false) });
      const { email, name, is_admin } = await schema.validateAsync(req.body);
      const exists = await db.client('users').where({ email }).first();
      if (exists) return res.status(400).json({ error: 'User already exists' });
      const id = uuidv4();
      const password = uuidv4().replace(/-/g, '').slice(0, 14);
      const password_hash = await bcrypt.hash(password, 10);
      await db.client('users').insert({ id, email, name: name || email, is_admin, password_hash });
      res.json({ user: { id, email, name: name || email, is_admin }, password });
    } catch (err) { next(err); }
  });

  router.put('/users/:userId', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ name: Joi.string().min(1).optional(), is_admin: Joi.boolean().optional() });
      const data = await schema.validateAsync(req.body);
      await db.client('users').where({ id: req.params.userId }).update({ ...data, updated_at: db.client.fn.now() });
      const user = await db.client('users').where({ id: req.params.userId }).first(['id', 'email', 'name', 'is_admin', 'created_at']);
      if (!user) return res.status(404).json({ error: 'Not found' });
      res.json(user);
    } catch (err) { next(err); }
  });

  router.post('/users/:userId/reset-password', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const user = await db.client('users').where({ id: req.params.userId }).first();
      if (!user) return res.status(404).json({ error: 'Not found' });
      const password = uuidv4().replace(/-/g, '').slice(0, 14);
      const password_hash = await bcrypt.hash(password, 10);
      await db.client('users').where({ id: req.params.userId }).update({ password_hash, updated_at: db.client.fn.now() });
      res.json({ password });
    } catch (err) { next(err); }
  });

  router.delete('/users/:userId', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      await db.client('users').where({ id: req.params.userId }).delete();
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // --- Teams management (admin) ---
  router.post('/teams', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ name: Joi.string().min(2).required() });
      const { name } = await schema.validateAsync(req.body);
      const id = uuidv4();
      await db.client('teams').insert({ id, name });
      res.json({ id, name });
    } catch (err) { next(err); }
  });

  router.put('/teams/:teamId', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ name: Joi.string().min(2).required() });
      const { name } = await schema.validateAsync(req.body);
      await db.client('teams').where({ id: req.params.teamId }).update({ name });
      const team = await db.client('teams').where({ id: req.params.teamId }).first();
      if (!team) return res.status(404).json({ error: 'Not found' });
      res.json(team);
    } catch (err) { next(err); }
  });

  router.delete('/teams/:teamId', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      await db.client('teams').where({ id: req.params.teamId }).delete();
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.post('/teams/:teamId/members', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ userId: Joi.string().uuid().required() });
      const { userId } = await schema.validateAsync(req.body);
      const exists = await db.client('team_memberships').where({ user_id: userId, team_id: req.params.teamId }).first();
      if (!exists) {
        await db.client('team_memberships').insert({ user_id: userId, team_id: req.params.teamId });
      }
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.delete('/teams/:teamId/members/:userId', async (req, res, next) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      await db.client('team_memberships').where({ user_id: req.params.userId, team_id: req.params.teamId }).delete();
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  return router;
}


