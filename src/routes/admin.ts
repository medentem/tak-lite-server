import type { Request, Response, NextFunction } from 'express-serve-static-core';
const { Router } = require('express');
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';
import { DatabaseService } from '../services/database';
import Joi from 'joi';
import { ConfigService } from '../services/config';
import { AuditService } from '../services/audit';
const bcrypt = require('bcryptjs');
import { v4 as uuidv4 } from 'uuid';

export function createAdminRouter(config: ConfigService, db?: DatabaseService, io?: Server) {
  const router = Router();
  const audit = db ? new AuditService(db) : null;

  router.get('/config', async (_req: Request, res: Response) => {
    const corsOrigin = await config.get<string>('security.cors_origin');
    const orgName = await config.get<string>('org.name');
    const retention = await config.get<number>('features.retention_days');
    res.json({ corsOrigin: corsOrigin || '', orgName: orgName || '', retentionDays: retention || 0 });
  });

  router.put('/config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schema = Joi.object({
        corsOrigin: Joi.string().custom((value, helpers) => {
          const list = String(value || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (list.includes('*')) return helpers.error('any.invalid');
          return list.join(',');
        }).allow('').required(),
        orgName: Joi.string().min(2).required(),
        retentionDays: Joi.number().integer().min(0).max(365).default(0)
      });
      const { corsOrigin, orgName, retentionDays } = await schema.validateAsync(req.body);
      await config.set('security.cors_origin', corsOrigin);
      await config.set('org.name', orgName);
      await config.set('features.retention_days', retentionDays);
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'config.update', resourceType: 'config', metadata: { corsOrigin, orgName, retentionDays } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/status', async (_req: Request, res: Response) => {
    res.json({ setupCompleted: !!(await config.get('setup.completed')) });
  });

  router.get('/version', async (_req: Request, res: Response) => {
    try {
      // Try multiple possible locations for package.json
      const possiblePaths = [
        path.resolve(__dirname, '../../package.json'),
        path.resolve(__dirname, '../../../package.json'),
        path.resolve(process.cwd(), 'package.json'),
        path.resolve(process.cwd(), '../package.json')
      ];
      
      let packageJson: any = null;
      for (const packagePath of possiblePaths) {
        try {
          if (fs.existsSync(packagePath)) {
            packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            break;
          }
        } catch (err) {
          // Continue to next path
          continue;
        }
      }
      
      if (!packageJson) {
        // Fallback to hardcoded values if package.json cannot be found
        packageJson = {
          version: '1.0.0',
          name: 'tak-lite-server',
          description: 'Cloud-native backend server for TAK Lite situational awareness platform'
        };
      }
      
      res.json({ 
        version: packageJson.version,
        name: packageJson.name,
        description: packageJson.description,
        buildTime: new Date().toISOString()
      });
    } catch (error) {
      // Fallback response if anything goes wrong
      res.json({ 
        version: '1.0.0',
        name: 'tak-lite-server',
        description: 'Cloud-native backend server for TAK Lite situational awareness platform',
        buildTime: new Date().toISOString()
      });
    }
  });

  // Lightweight team/user reads to support visibility and credential distribution
  router.get('/teams', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.json([]);
      const teams = await db.client('teams').select(['id', 'name', 'created_at']).orderBy('name');
      res.json(teams);
    } catch (err) { next(err); }
  });

  router.get('/teams/:teamId/members', async (req: Request, res: Response, next: NextFunction) => {
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
  router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
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
      const loadavg = os.loadavg();
      
      // In containerized environments (like DigitalOcean App Platform), os.loadavg() returns zeros
      // Provide alternative metrics that are meaningful in containers
      const isContainerized = loadavg.every(val => val === 0);
      const alternativeMetrics = isContainerized ? {
        cpuUsage: process.cpuUsage(),
        eventLoopDelay: Number(process.hrtime.bigint()), // Convert BigInt to Number for JSON serialization
        activeHandles: (process as any)._getActiveHandles().length,
        activeRequests: (process as any)._getActiveRequests().length
      } : null;
      
      const stats = {
        server: {
          pid: process.pid,
          node: process.version,
          uptimeSec: Math.round(process.uptime()),
          loadavg: loadavg,
          isContainerized: isContainerized,
          alternativeMetrics: alternativeMetrics,
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

  // Map data endpoints for admin dashboard
  router.get('/map/annotations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.json([]);
      
      const teamId = req.query.teamId as string;
      const limit = parseInt(req.query.limit as string) || 1000;
      const since = req.query.since as string; // ISO timestamp
      
      let query = db.client('annotations')
        .select(['id', 'user_id', 'team_id', 'type', 'data', 'created_at', 'updated_at'])
        .orderBy('updated_at', 'desc')
        .limit(limit);
      
      if (teamId) {
        query = query.where('team_id', teamId);
      }
      
      if (since) {
        query = query.where('updated_at', '>', since);
      }
      
      const annotations = await query;
      res.json(annotations);
    } catch (err) { next(err); }
  });

  router.get('/map/locations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.json([]);
      
      const teamId = req.query.teamId as string;
      const limit = parseInt(req.query.limit as string) || 100;
      const since = req.query.since as string; // ISO timestamp
      
      let query = db.client('locations as l')
        .join('users as u', 'u.id', 'l.user_id')
        .select([
          'l.id', 'l.user_id', 'l.team_id', 'l.latitude', 'l.longitude', 
          'l.altitude', 'l.accuracy', 'l.timestamp', 'l.created_at', 'l.user_status',
          'u.name as user_name', 'u.email as user_email'
        ])
        .orderBy('l.timestamp', 'desc')
        .limit(limit);
      
      if (teamId) {
        query = query.where('l.team_id', teamId);
      }
      
      if (since) {
        query = query.where('l.timestamp', '>', new Date(since).getTime());
      }
      
      const locations = await query;
      res.json(locations);
    } catch (err) { next(err); }
  });

  router.get('/map/locations/latest', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.json([]);
      
      const teamId = req.query.teamId as string;
      
      if (!teamId) {
        return res.status(400).json({ error: 'teamId is required' });
      }
      
      // Get latest location for each user in the team
      const locations = await db.client.raw(`
        SELECT DISTINCT ON (l.user_id) 
          l.id, l.user_id, l.team_id, l.latitude, l.longitude, 
          l.altitude, l.accuracy, l.timestamp, l.created_at, l.user_status,
          u.name as user_name, u.email as user_email
        FROM locations l
        JOIN users u ON u.id = l.user_id
        WHERE l.team_id = ?
        ORDER BY l.user_id, l.timestamp DESC
      `, [teamId]);
      
      res.json(locations.rows || []);
    } catch (err) { next(err); }
  });

  // --- Users management (admin) ---
  router.get('/users', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.json([]);
      const users = await db.client('users').select(['id', 'email', 'name', 'is_admin', 'created_at']).orderBy('created_at', 'desc');
      res.json(users);
    } catch (err) { next(err); }
  });

  router.post('/users', async (req: Request, res: Response, next: NextFunction) => {
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
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'user.create', resourceType: 'user', resourceId: id, metadata: { email, is_admin } });
      res.json({ user: { id, email, name: name || email, is_admin }, password });
    } catch (err) { next(err); }
  });

  router.put('/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ name: Joi.string().min(1).optional(), is_admin: Joi.boolean().optional() });
      const data = await schema.validateAsync(req.body);
      await db.client('users').where({ id: req.params.userId }).update({ ...data, updated_at: db.client.fn.now() });
      const user = await db.client('users').where({ id: req.params.userId }).first(['id', 'email', 'name', 'is_admin', 'created_at']);
      if (!user) return res.status(404).json({ error: 'Not found' });
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'user.update', resourceType: 'user', resourceId: req.params.userId, metadata: data });
      res.json(user);
    } catch (err) { next(err); }
  });

  router.post('/users/:userId/reset-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const user = await db.client('users').where({ id: req.params.userId }).first();
      if (!user) return res.status(404).json({ error: 'Not found' });
      const password = uuidv4().replace(/-/g, '').slice(0, 14);
      const password_hash = await bcrypt.hash(password, 10);
      await db.client('users').where({ id: req.params.userId }).update({ password_hash, updated_at: db.client.fn.now() });
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'user.reset_password', resourceType: 'user', resourceId: req.params.userId });
      res.json({ password });
    } catch (err) { next(err); }
  });

  router.delete('/users/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      await db.client('users').where({ id: req.params.userId }).delete();
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'user.delete', resourceType: 'user', resourceId: req.params.userId });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // --- Teams management (admin) ---
  router.post('/teams', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ name: Joi.string().min(2).required() });
      const { name } = await schema.validateAsync(req.body);
      const id = uuidv4();
      await db.client('teams').insert({ id, name });
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'team.create', resourceType: 'team', resourceId: id, metadata: { name } });
      res.json({ id, name });
    } catch (err) { next(err); }
  });

  router.put('/teams/:teamId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ name: Joi.string().min(2).required() });
      const { name } = await schema.validateAsync(req.body);
      await db.client('teams').where({ id: req.params.teamId }).update({ name });
      const team = await db.client('teams').where({ id: req.params.teamId }).first();
      if (!team) return res.status(404).json({ error: 'Not found' });
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'team.update', resourceType: 'team', resourceId: req.params.teamId, metadata: { name } });
      res.json(team);
    } catch (err) { next(err); }
  });

  router.delete('/teams/:teamId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      await db.client('teams').where({ id: req.params.teamId }).delete();
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'team.delete', resourceType: 'team', resourceId: req.params.teamId });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.post('/teams/:teamId/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      const schema = Joi.object({ userId: Joi.string().uuid().required() });
      const { userId } = await schema.validateAsync(req.body);
      const exists = await db.client('team_memberships').where({ user_id: userId, team_id: req.params.teamId }).first();
      if (!exists) {
        await db.client('team_memberships').insert({ user_id: userId, team_id: req.params.teamId });
        if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'team.add_member', resourceType: 'team', resourceId: req.params.teamId, metadata: { userId } });
      }
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.delete('/teams/:teamId/members/:userId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      await db.client('team_memberships').where({ user_id: req.params.userId, team_id: req.params.teamId }).delete();
      if (audit) await audit.log({ actorUserId: (req.user as any)?.sub, action: 'team.remove_member', resourceType: 'team', resourceId: req.params.teamId, metadata: { userId: req.params.userId } });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  return router;
}


