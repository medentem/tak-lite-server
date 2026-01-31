import type { Request, Response, NextFunction } from 'express-serve-static-core';
const { Router } = require('express');
import rateLimit from 'express-rate-limit';
const bcrypt = require('bcryptjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwt = require('jsonwebtoken');
import Joi from 'joi';
import { DatabaseService } from '../services/database';
import { ConfigService } from '../services/config';
import { SecurityService } from '../services/security';
import { TokenService } from '../services/tokens';

function parseExpires(val: string | undefined): number {
  if (!val) return 15 * 60;
  if (/^\d+$/.test(val)) return Number(val);
  const m = val.match(/^(\d+)([smhd])$/i);
  if (!m) return 15 * 60;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  if (unit === 'd') return n * 86400;
  return 15 * 60;
}

export function createAuthRouter(db: DatabaseService, config: ConfigService) {
  const router = Router();
  const security = new SecurityService(config);
  const tokens = new TokenService(db);

  // Per-route limiter to protect login from brute force
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });

  router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Accept either username or email for backward compatibility (e.g. legacy Android sends "email")
      const schema = Joi.object({
        username: Joi.string().min(1).optional(),
        email: Joi.string().min(1).optional(), // allow any string; lookup by name or email
        password: Joi.string().required()
      }).or('username', 'email');
      const body = await schema.validateAsync(req.body);
      const password = body.password as string;
      const loginId = (body.username && String(body.username).trim()) || (body.email && String(body.email).trim());
      if (!loginId) {
        return res.status(400).json({ error: '"username" or "email" is required' });
      }

      // Look up by username (name) first, then by email for backward compatibility
      let user = await db.client('users').where({ name: loginId }).first();
      if (!user) {
        user = await db.client('users').where({ email: loginId }).first();
      }
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const v = await security.verifyPassword(password, user.password_hash);
      if (!v.ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      if (v.needsRehash) {
        try {
          const newHash = await security.hashPassword(password);
          await db.client('users').where({ id: user.id }).update({ password_hash: newHash, updated_at: db.client.fn.now() });
        } catch {}
      }
      const parseExpires = (val: string | undefined): number => {
        if (!val) return 15 * 60; // 15m default
        if (/^\d+$/.test(val)) return Number(val);
        const m = val.match(/^(\d+)([smhd])$/i);
        if (!m) return 15 * 60;
        const n = Number(m[1]);
        const unit = m[2].toLowerCase();
        if (unit === 's') return n;
        if (unit === 'm') return n * 60;
        if (unit === 'h') return n * 3600;
        if (unit === 'd') return n * 86400;
        return 15 * 60;
      };
      const expiresIn = parseExpires(process.env.JWT_EXPIRES_IN);
      const token = await security.signJwt({ sub: user.id, is_admin: user.is_admin }, { expiresIn });
      const { jti, token: refresh } = await tokens.rotate(user.id, null, null);
      
      // Set HttpOnly cookie for browser-based admin UI; clients may still use bearer token from body
      const useCookie = String(req.query.cookie || '1') === '1';
      if (useCookie) {
        const isProd = (process.env.NODE_ENV || 'production') === 'production';
        res.cookie('taklite_token', token, {
          httpOnly: true,
          secure: isProd,
          sameSite: 'strict',
          maxAge: 1000 * 60 * 60, // ~1h; cookie expiry independent of JWT exp
          path: '/'
        });
        res.cookie('taklite_refresh', `${jti}.${refresh}`, {
          httpOnly: true,
          secure: isProd,
          sameSite: 'strict',
          maxAge: 1000 * 60 * 60 * 24 * 14,
          path: '/api/auth'
        });
      }
      res.json({ token });
    } catch (err) {
      console.error(`[AUTH] Login error:`, err);
      next(err);
    }
  });

  // Who am I (validate token and return subject and admin flag)
  // Note: This endpoint is intentionally left without middleware to support cookie-based auth
  // for the web dashboard, but it performs full token validation
  router.get('/whoami', async (req: Request, res: Response) => {
    const auth = req.headers.authorization || '';
    const [, bearer] = auth.split(' ');
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader
        .split(';')
        .map((c: string) => c.trim())
        .filter((c: string) => c.includes('='))
        .map((c: string) => {
          const idx = c.indexOf('=');
          return [decodeURIComponent(c.slice(0, idx)), decodeURIComponent(c.slice(idx + 1))];
        })
    );
    const token = bearer || cookies['taklite_token'];
    if (!token) return res.status(401).json({ error: 'Missing token' });
    try {
      const payload = await security.verifyJwt<{ sub: string; is_admin?: boolean }>(token);
      
      // Get user details from database
      const user = await db.client('users').where({ id: payload.sub }).select(['id', 'email', 'name', 'is_admin']).first();
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      
      res.json({ 
        userId: user.id, 
        email: user.email,
        name: user.name,
        isAdmin: !!user.is_admin 
      });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  // Logout: clear cookie (does not revoke JWTs used outside browser)
  router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie('taklite_token', { path: '/' });
    res.clearCookie('taklite_refresh', { path: '/api/auth' });
    res.json({ success: true });
  });

  // Refresh endpoint (cookie-based)
  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const cookieHeader = req.headers.cookie || '';
      const cookies = Object.fromEntries(
        cookieHeader
          .split(';')
          .map((c: string) => c.trim())
          .filter((c: string) => c.includes('='))
          .map((c: string) => { const i=c.indexOf('='); return [decodeURIComponent(c.slice(0,i)), decodeURIComponent(c.slice(i+1))]; })
      );
      const compound = cookies['taklite_refresh'] || '';
      const [jti, refresh] = compound.split('.');
      if (!jti || !refresh) return res.status(401).json({ error: 'Missing refresh' });
      const row = await tokens.verify(jti, refresh);
      if (!row) return res.status(401).json({ error: 'Invalid refresh' });
      const user = await db.client('users').where({ id: row.userId }).select(['id', 'is_admin']).first();
      if (!user) return res.status(401).json({ error: 'User not found' });
      const access = await security.signJwt(
        { sub: user.id, is_admin: !!user.is_admin },
        { expiresIn: parseExpires(process.env.JWT_EXPIRES_IN) }
      );
      const { jti: newJti, token: newRefresh } = await tokens.rotate(row.userId, jti, refresh);
      const isProd = (process.env.NODE_ENV || 'production') === 'production';
      res.cookie('taklite_token', access, { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 1000*60*60, path: '/' });
      res.cookie('taklite_refresh', `${newJti}.${newRefresh}`, { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 1000*60*60*24*14, path: '/api/auth' });
      res.json({ token: access });
    } catch {
      res.status(401).json({ error: 'Refresh failed' });
    }
  });

  // Get user's teams (requires authentication)
  // Note: This endpoint is intentionally left without middleware to support cookie-based auth
  // for the web dashboard, but it performs full token validation
  router.get('/user/teams', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = req.headers.authorization || '';
      const [, bearer] = auth.split(' ');
      const cookieHeader = req.headers.cookie || '';
      const cookies = Object.fromEntries(
        cookieHeader
          .split(';')
          .map((c: string) => c.trim())
          .filter((c: string) => c.includes('='))
          .map((c: string) => {
            const idx = c.indexOf('=');
            return [decodeURIComponent(c.slice(0, idx)), decodeURIComponent(c.slice(idx + 1))];
          })
      );
      const token = bearer || cookies['taklite_token'];
      if (!token) return res.status(401).json({ error: 'Missing token' });
      
      const payload = await security.verifyJwt<{ sub: string; is_admin?: boolean }>(token);
      const userId = payload.sub;
      
      // Get teams the user is a member of
      const teams = await db.client('team_memberships')
        .join('teams', 'team_memberships.team_id', 'teams.id')
        .where('team_memberships.user_id', userId)
        .select('teams.id', 'teams.name', 'teams.created_at')
        .orderBy('teams.name');
      
      res.json(teams);
    } catch (err) {
      next(err);
    }
  });

  return router;
}


