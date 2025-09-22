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
        query = query.where(function() {
          this.where('team_id', teamId).orWhereNull('team_id');
        });
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
        query = query.where(function() {
          this.where('l.team_id', teamId).orWhereNull('l.team_id');
        });
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

  // Admin annotation management endpoints
  router.post('/map/annotations', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      
      const schema = Joi.object({
        teamId: Joi.string().uuid().allow(null).optional(),
        type: Joi.string().valid('poi', 'line', 'area', 'polygon').required(),
        data: Joi.object({
          position: Joi.object({
            lng: Joi.number().required(),
            lt: Joi.number().required()
          }).when('...type', {
            is: 'poi',
            then: Joi.required(),
            otherwise: Joi.optional()
          }),
          points: Joi.array().items(Joi.object({
            lng: Joi.number().required(),
            lt: Joi.number().required()
          })).when('...type', {
            is: Joi.string().valid('line', 'polygon'),
            then: Joi.required(),
            otherwise: Joi.optional()
          }),
          center: Joi.object({
            lng: Joi.number().required(),
            lt: Joi.number().required()
          }).when('...type', {
            is: 'area',
            then: Joi.required(),
            otherwise: Joi.optional()
          }),
          radius: Joi.number().positive().when('...type', {
            is: 'area',
            then: Joi.required(),
            otherwise: Joi.optional()
          }),
          color: Joi.string().valid('green', 'yellow', 'red', 'black', 'white').default('green'),
          shape: Joi.string().valid('circle', 'square', 'triangle', 'exclamation').default('circle'),
          label: Joi.string().max(100).allow('').optional(),
          timestamp: Joi.number().default(() => Date.now())
        }).required()
      });
      
      const { teamId, type, data } = await schema.validateAsync(req.body);
      
      // Verify team exists only if teamId is provided
      if (teamId) {
        const team = await db.client('teams').where({ id: teamId }).first();
        if (!team) {
          return res.status(404).json({ error: 'Team not found' });
        }
      }
      
      const id = uuidv4();
      const userId = (req.user as any)?.sub || 'admin';
      
      const row = {
        id,
        user_id: userId,
        team_id: teamId,
        type,
        data: JSON.stringify(data),
        created_at: db.client.fn.now(),
        updated_at: db.client.fn.now()
      };
      
      await db.client('annotations').insert(row);
      
      if (audit) await audit.log({ 
        actorUserId: userId, 
        action: 'annotation.create', 
        resourceType: 'annotation', 
        resourceId: id, 
        metadata: { teamId, type } 
      });
      
      // Emit real-time update to admin clients
      if (io) {
        io.emit('admin:annotation_update', {
          id,
          teamId,
          type,
          data,
          userId,
          userName: 'Admin',
          userEmail: 'admin@system',
          timestamp: data.timestamp
        });
        
        // Broadcast to regular clients (Android clients listen for this)
        if (teamId) {
          // Broadcast to specific team room
          io.to(`team:${teamId}`).emit('annotation:update', {
            id,
            teamId,
            type,
            data: JSON.stringify({
              ...data,
              type // Include type for polymorphic deserialization
            }),
            userId,
            userName: 'Admin',
            userEmail: 'admin@system',
            timestamp: data.timestamp
          });
        } else {
          // Broadcast to global room for null team_id data
          io.to('global').emit('annotation:update', {
            id,
            teamId,
            type,
            data: JSON.stringify({
              ...data,
              type // Include type for polymorphic deserialization
            }),
            userId,
            userName: 'Admin',
            userEmail: 'admin@system',
            timestamp: data.timestamp
          });
        }
      }
      
      res.json({ 
        id,
        user_id: userId,
        team_id: teamId,
        type,
        data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    } catch (err) { next(err); }
  });

  router.put('/map/annotations/:annotationId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      
      const schema = Joi.object({
        data: Joi.object({
          position: Joi.object({
            lng: Joi.number().required(),
            lt: Joi.number().required()
          }).optional(),
          points: Joi.array().items(Joi.object({
            lng: Joi.number().required(),
            lt: Joi.number().required()
          })).optional(),
          center: Joi.object({
            lng: Joi.number().required(),
            lt: Joi.number().required()
          }).optional(),
          radius: Joi.number().positive().optional(),
          color: Joi.string().valid('green', 'yellow', 'red', 'black', 'white').optional(),
          shape: Joi.string().valid('circle', 'square', 'triangle', 'exclamation').optional(),
          label: Joi.string().max(100).allow('').optional(),
          timestamp: Joi.number().optional()
        }).required()
      });
      
      const { data } = await schema.validateAsync(req.body);
      const annotationId = req.params.annotationId;
      const userId = (req.user as any)?.sub || 'admin';
      
      // Check if annotation exists
      const existing = await db.client('annotations').where({ id: annotationId }).first();
      if (!existing) {
        return res.status(404).json({ error: 'Annotation not found' });
      }
      
      // Merge with existing data
      const existingData = JSON.parse(existing.data);
      const mergedData = { ...existingData, ...data };
      
      await db.client('annotations')
        .where({ id: annotationId })
        .update({
          data: JSON.stringify(mergedData),
          updated_at: db.client.fn.now()
        });
      
      if (audit) await audit.log({ 
        actorUserId: userId, 
        action: 'annotation.update', 
        resourceType: 'annotation', 
        resourceId: annotationId, 
        metadata: { teamId: existing.team_id, type: existing.type } 
      });
      
      // Emit real-time update to admin clients
      if (io) {
        io.emit('admin:annotation_update', {
          id: annotationId,
          teamId: existing.team_id,
          type: existing.type,
          data: mergedData,
          userId,
          userName: 'Admin',
          userEmail: 'admin@system',
          timestamp: mergedData.timestamp || Date.now()
        });
        
        // Broadcast to regular clients (Android clients listen for this)
        if (existing.team_id) {
          // Broadcast to specific team room
          io.to(`team:${existing.team_id}`).emit('annotation:update', {
            id: annotationId,
            teamId: existing.team_id,
            type: existing.type,
            data: JSON.stringify({
              ...mergedData,
              type: existing.type // Include type for polymorphic deserialization
            }),
            userId,
            userName: 'Admin',
            userEmail: 'admin@system',
            timestamp: mergedData.timestamp || Date.now()
          });
        } else {
          // Broadcast to global room for null team_id data
          io.to('global').emit('annotation:update', {
            id: annotationId,
            teamId: existing.team_id,
            type: existing.type,
            data: JSON.stringify({
              ...mergedData,
              type: existing.type // Include type for polymorphic deserialization
            }),
            userId,
            userName: 'Admin',
            userEmail: 'admin@system',
            timestamp: mergedData.timestamp || Date.now()
          });
        }
      }
      
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.delete('/map/annotations/:annotationId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      
      const annotationId = req.params.annotationId;
      const userId = (req.user as any)?.sub || 'admin';
      
      // Check if annotation exists
      const existing = await db.client('annotations').where({ id: annotationId }).first();
      if (!existing) {
        return res.status(404).json({ error: 'Annotation not found' });
      }
      
      await db.client('annotations').where({ id: annotationId }).delete();
      
      if (audit) await audit.log({ 
        actorUserId: userId, 
        action: 'annotation.delete', 
        resourceType: 'annotation', 
        resourceId: annotationId, 
        metadata: { teamId: existing.team_id, type: existing.type } 
      });
      
      // Emit real-time update to admin clients
      if (io) {
        io.emit('admin:annotation_delete', {
          annotationId,
          teamId: existing.team_id,
          userId,
          userName: 'Admin',
          userEmail: 'admin@system'
        });
        
        // Broadcast to regular clients (Android clients listen for this)
        if (existing.team_id) {
          // Broadcast to specific team room
          io.to(`team:${existing.team_id}`).emit('annotation:delete', {
            annotationId,
            teamId: existing.team_id,
            userId,
            userName: 'Admin',
            userEmail: 'admin@system'
          });
        } else {
          // Broadcast to global room for null team_id data
          io.to('global').emit('annotation:delete', {
            annotationId,
            teamId: existing.team_id,
            userId,
            userName: 'Admin',
            userEmail: 'admin@system'
          });
        }
      }
      
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // Bulk delete annotations endpoint
  router.post('/map/annotations/bulk-delete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      
      const schema = Joi.object({
        annotationIds: Joi.array().items(Joi.string().uuid()).min(1).required()
      });
      
      const { annotationIds } = await schema.validateAsync(req.body);
      const userId = (req.user as any)?.sub || 'admin';
      
      // Get all annotations that will be deleted for audit logging
      const annotationsToDelete = await db.client('annotations')
        .whereIn('id', annotationIds)
        .select(['id', 'team_id', 'type']);
      
      if (annotationsToDelete.length === 0) {
        return res.status(404).json({ error: 'No annotations found to delete' });
      }
      
      // First, check which annotations can be safely deleted (not referenced by threat_analyses)
      const annotationsWithThreats = await db.client('threat_analyses')
        .whereIn('annotation_id', annotationIds)
        .whereNotNull('annotation_id')
        .select(['annotation_id']);
      
      const referencedAnnotationIds = new Set(annotationsWithThreats.map((t: any) => t.annotation_id));
      const safeToDeleteIds = annotationIds.filter((id: string) => !referencedAnnotationIds.has(id));
      
      if (safeToDeleteIds.length === 0) {
        return res.status(400).json({ 
          error: 'Cannot delete annotations that are referenced by threat analyses. Please delete the threat analyses first.' 
        });
      }
      
      // Delete only the annotations that are safe to delete
      const deletedCount = await db.client('annotations')
        .whereIn('id', safeToDeleteIds)
        .delete();
      
      // Log audit entries for each deleted annotation
      if (audit) {
        for (const annotation of annotationsToDelete) {
          await audit.log({ 
            actorUserId: userId, 
            action: 'annotation.bulk_delete', 
            resourceType: 'annotation', 
            resourceId: annotation.id, 
            metadata: { teamId: annotation.team_id, type: annotation.type, bulkOperation: true } 
          });
        }
      }
      
      // Emit real-time updates to admin clients
      if (io) {
        io.emit('admin:annotation_bulk_delete', {
          annotationIds,
          deletedCount,
          userId,
          userName: 'Admin',
          userEmail: 'admin@system'
        });
        
        // Broadcast to regular clients (Android clients listen for this)
        // Group annotations by team for efficient broadcasting
        const teamAnnotations = new Map<string, string[]>();
        const globalAnnotations: string[] = [];
        
        annotationsToDelete.forEach(annotation => {
          if (annotation.team_id) {
            if (!teamAnnotations.has(annotation.team_id)) {
              teamAnnotations.set(annotation.team_id, []);
            }
            teamAnnotations.get(annotation.team_id)!.push(annotation.id);
          } else {
            globalAnnotations.push(annotation.id);
          }
        });
        
        // Broadcast to team-specific rooms
        for (const [teamId, ids] of teamAnnotations) {
          io.to(`team:${teamId}`).emit('annotation:bulk_delete', {
            annotationIds: ids,
            teamId,
            userId,
            userName: 'Admin',
            userEmail: 'admin@system'
          });
        }
        
        // Broadcast to global room for global annotations
        if (globalAnnotations.length > 0) {
          io.to('global').emit('annotation:bulk_delete', {
            annotationIds: globalAnnotations,
            teamId: null,
            userId,
            userName: 'Admin',
            userEmail: 'admin@system'
          });
        }
      }
      
      const skippedCount = annotationIds.length - safeToDeleteIds.length;
      const response: any = { 
        success: true, 
        deletedCount,
        annotationIds: safeToDeleteIds
      };
      
      if (skippedCount > 0) {
        response.skippedCount = skippedCount;
        response.skippedReason = 'Referenced by threat analyses';
        response.warning = `${skippedCount} annotation(s) were skipped because they are referenced by threat analyses. Delete the threat analyses first to remove these annotations.`;
      }
      
      res.json(response);
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

  // --- Threat Management (admin) ---
  router.get('/threats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.json([]);
      
      const { 
        threat_level, 
        threat_type, 
        status = 'pending',
        limit = 50, 
        offset = 0 
      } = req.query;
      
      let query = db.client('threat_analyses')
        .select([
          'id', 'threat_level', 'threat_type', 'confidence_score', 
          'ai_summary', 'extracted_locations', 'keywords', 'reasoning',
          'search_query', 'geographical_area', 'created_at',
          'processing_metadata', 'grok_analysis', 'citations'
        ])
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string));
      
      if (threat_level) {
        query = query.where('threat_level', threat_level);
      }
      
      if (threat_type) {
        query = query.where('threat_type', threat_type);
      }
      
      // Filter by status (pending, reviewed, approved, dismissed, all)
      if (status === 'pending') {
        query = query.whereNull('admin_status');
      } else if (status === 'all') {
        // Show all threats regardless of status
        // No additional filtering needed
      } else {
        // Filter by specific status (reviewed, approved, dismissed)
        query = query.where('admin_status', status);
      }
      
      const threats = await query;
      res.json(threats);
    } catch (err) { next(err); }
  });

  router.get('/threats/:threatId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      
      const threat = await db.client('threat_analyses')
        .select([
          'id', 'threat_level', 'threat_type', 'confidence_score', 
          'ai_summary', 'extracted_locations', 'keywords', 'reasoning',
          'search_query', 'geographical_area', 'created_at',
          'processing_metadata', 'grok_analysis', 'citations'
        ])
        .where('id', req.params.threatId)
        .first();
      
      if (!threat) {
        return res.status(404).json({ error: 'Threat not found' });
      }
      
      res.json(threat);
    } catch (err) { next(err); }
  });

  router.put('/threats/:threatId/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      
      const schema = Joi.object({
        status: Joi.string().valid('pending', 'reviewed', 'approved', 'dismissed').required(),
        notes: Joi.string().max(1000).allow('').optional()
      });
      
      const { status, notes } = await schema.validateAsync(req.body);
      const userId = (req.user as any)?.sub || 'admin';
      
      const threat = await db.client('threat_analyses')
        .where('id', req.params.threatId)
        .first();
      
      if (!threat) {
        return res.status(404).json({ error: 'Threat not found' });
      }
      
      await db.client('threat_analyses')
        .where('id', req.params.threatId)
        .update({
          admin_status: status,
          admin_notes: notes,
          reviewed_by: userId,
          reviewed_at: new Date()
        });
      
      if (audit) await audit.log({ 
        actorUserId: userId, 
        action: 'threat.update_status', 
        resourceType: 'threat_analysis', 
        resourceId: req.params.threatId, 
        metadata: { status, notes } 
      });
      
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  router.post('/threats/:threatId/create-annotation', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!db) return res.status(500).json({ error: 'Database not initialized' });
      
      const schema = Joi.object({
        teamId: Joi.string().uuid().required(),
        annotationType: Joi.string().valid('poi', 'area').default('poi'),
        customLabel: Joi.string().max(100).allow('').optional(),
        customColor: Joi.string().valid('green', 'yellow', 'red', 'black', 'white').optional()
      });
      
      const { teamId, annotationType, customLabel, customColor } = await schema.validateAsync(req.body);
      const userId = (req.user as any)?.sub || 'admin';
      
      // Get the threat analysis
      const threat = await db.client('threat_analyses')
        .where('id', req.params.threatId)
        .first();
      
      if (!threat) {
        return res.status(404).json({ error: 'Threat not found' });
      }
      
      // Verify team exists
      const team = await db.client('teams').where({ id: teamId }).first();
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Extract location data from threat
      let locations = threat.extracted_locations || [];
      
      // Ensure locations is properly parsed if it's a string
      if (typeof locations === 'string') {
        try {
          locations = JSON.parse(locations);
        } catch (error: any) {
          return res.status(400).json({ 
            error: 'Invalid location data format in threat analysis',
            details: error.message 
          });
        }
      }
      
      if (!Array.isArray(locations) || locations.length === 0) {
        return res.status(400).json({ error: 'No valid location data available for this threat' });
      }
      
      // Use the first location for the annotation
      const primaryLocation = locations[0];
      
      // Validate coordinates to prevent NaN values
      if (!primaryLocation.lat || !primaryLocation.lng || 
          isNaN(primaryLocation.lat) || isNaN(primaryLocation.lng) ||
          !isFinite(primaryLocation.lat) || !isFinite(primaryLocation.lng)) {
        return res.status(400).json({ 
          error: 'Invalid coordinates in threat location data',
          location: primaryLocation,
          message: 'Coordinates must be valid numbers (not NaN or infinite)'
        });
      }
      
      // Determine annotation properties based on threat level
      const threatLevelColors = {
        'LOW': 'green',
        'MEDIUM': 'yellow', 
        'HIGH': 'red',
        'CRITICAL': 'black'
      };
      
      const color = customColor || threatLevelColors[threat.threat_level as keyof typeof threatLevelColors] || 'red';
      const label = customLabel || `${threat.threat_level} Threat: ${threat.threat_type || 'Unknown'}`;
      
      // Create annotation data
      const annotationData = {
        position: {
          lng: primaryLocation.lng,
          lat: primaryLocation.lat
        },
        color: color,
        shape: 'exclamation', // Use exclamation for threats
        label: label,
        timestamp: Date.now(),
        threatInfo: {
          threatId: threat.id,
          threatLevel: threat.threat_level,
          threatType: threat.threat_type,
          confidenceScore: threat.confidence_score,
          summary: threat.ai_summary,
          source: 'AI Threat Detection'
        }
      };
      
      // Create the annotation
      const annotationId = uuidv4();
      const annotation = {
        id: annotationId,
        user_id: userId,
        team_id: teamId,
        type: annotationType,
        data: JSON.stringify(annotationData),
        created_at: db.client.fn.now(),
        updated_at: db.client.fn.now()
      };
      
      await db.client('annotations').insert(annotation);
      
      // Update threat status to approved
      await db.client('threat_analyses')
        .where('id', req.params.threatId)
        .update({
          admin_status: 'approved',
          annotation_id: annotationId,
          reviewed_by: userId,
          reviewed_at: new Date()
        });
      
      if (audit) await audit.log({ 
        actorUserId: userId, 
        action: 'threat.create_annotation', 
        resourceType: 'threat_analysis', 
        resourceId: req.params.threatId, 
        metadata: { teamId, annotationId, annotationType } 
      });
      
      // Emit real-time update to admin clients
      if (io) {
        io.emit('admin:threat_annotation_created', {
          threatId: req.params.threatId,
          annotationId,
          teamId,
          threatLevel: threat.threat_level,
          threatType: threat.threat_type,
          location: primaryLocation
        });
        
        // Emit annotation update for regular clients (so they can see the new annotation on their maps)
        io.emit('admin:annotation_update', {
          id: annotationId,
          teamId,
          type: annotationType,
          data: annotationData,
          userId,
          userName: 'System (Threat Detection)',
          userEmail: 'system@threat-detection',
          timestamp: new Date().toISOString(),
          source: 'threat_approval'
        });
        
        // Broadcast to regular clients (Android clients listen for this)
        if (teamId) {
          // Broadcast to specific team room
          io.to(`team:${teamId}`).emit('annotation:update', {
            id: annotationId,
            teamId,
            type: annotationType,
            data: JSON.stringify({
              ...annotationData,
              type: annotationType // Include type for polymorphic deserialization
            }),
            userId,
            userName: 'System (Threat Detection)',
            userEmail: 'system@threat-detection',
            timestamp: new Date().toISOString(),
            source: 'threat_approval'
          });
        } else {
          // Broadcast to global room for null team_id data
          io.to('global').emit('annotation:update', {
            id: annotationId,
            teamId,
            type: annotationType,
            data: JSON.stringify({
              ...annotationData,
              type: annotationType // Include type for polymorphic deserialization
            }),
            userId,
            userName: 'System (Threat Detection)',
            userEmail: 'system@threat-detection',
            timestamp: new Date().toISOString(),
            source: 'threat_approval'
          });
        }
        
        // Emit sync activity for admin dashboard
        io.emit('admin:sync_activity', {
          type: 'annotation_update',
          details: `System created threat annotation ${annotationId} for team ${teamId} from approved threat ${req.params.threatId}`
        });
      }
      
      res.json({ 
        success: true, 
        annotationId,
        annotation: {
          id: annotationId,
          user_id: userId,
          team_id: teamId,
          type: annotationType,
          data: annotationData,
          created_at: new Date().toISOString()
        }
      });
    } catch (err) { next(err); }
  });

  return router;
}


