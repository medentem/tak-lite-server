import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { DatabaseService } from '../services/database';
import { ConfigService } from '../services/config';
import { SecurityService } from '../services/security';

const setupCompleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many setup attempts; try again later.'
});

/** When SETUP_SECRET is set, setup can only be completed by someone who provides it (eliminates setup race). */
function getSetupSecret(): string | undefined {
  return process.env.SETUP_SECRET?.trim() || undefined;
}

function verifySetupKey(provided: string): boolean {
  const expected = getSetupSecret();
  if (!expected) return true;
  if (!provided || typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSetupRouter(db: DatabaseService, config: ConfigService) {
  const router = Router();
  const security = new SecurityService(config);

  router.get('/status', async (_req, res) => {
    const completed = await config.get<boolean>('setup.completed');
    const requiresSetupKey = !!getSetupSecret();
    res.json({ completed: !!completed, requiresSetupKey });
  });

  router.post('/complete', setupCompleteLimiter, async (req, res, next) => {
    try {
      const schema = Joi.object({
        adminUsername: Joi.string().min(1).required(),
        adminEmail: Joi.string().email().allow('', null).optional(),
        adminPassword: Joi.string().min(10).required(),
        orgName: Joi.string().min(2).required(),
        corsOrigin: Joi.string().allow('').optional(),
        setupKey: Joi.string().allow('').optional()
      });
      const { adminUsername, adminEmail, adminPassword, orgName, corsOrigin, setupKey } = await schema.validateAsync(req.body);

      const already = await config.get<boolean>('setup.completed');
      if (already) return res.status(400).json({ error: 'Setup already completed' });

      if (!verifySetupKey(setupKey ?? '')) {
        return res.status(403).json({
          error: getSetupSecret()
            ? 'Invalid or missing setup key. Set SETUP_SECRET in your deployment environment and provide it here.'
            : 'Setup key was provided but this server does not require one.'
        });
      }

      const password_hash = await bcrypt.hash(adminPassword, 10);
      const adminId = uuidv4();
      const teamId = uuidv4();

      const emailToStore = (adminEmail && String(adminEmail).trim()) || null;

      await db.client.transaction(async (trx) => {
        // Idempotent creates: look up by username (name)
        const existingUser = await trx('users').where({ name: adminUsername }).first();
        if (!existingUser) {
          await trx('users').insert({
            id: adminId,
            email: emailToStore,
            password_hash,
            name: adminUsername,
            is_admin: true
          });
        }
        const userRow = existingUser || (await trx('users').where({ name: adminUsername }).first());
        const ensureTeam = await trx('teams').where({ name: `${orgName} Team` }).first();
        if (!ensureTeam) {
          await trx('teams').insert({ id: teamId, name: `${orgName} Team` });
        }
        const teamRow = ensureTeam || (await trx('teams').where({ name: `${orgName} Team` }).first());
        const membership = await trx('team_memberships').where({ user_id: userRow.id, team_id: teamRow.id }).first();
        if (!membership) {
          await trx('team_memberships').insert({ user_id: userRow.id, team_id: teamRow.id });
        }
      });

      const jwtSecret = SecurityService.generateStrongSecret();
      await config.set('security.jwt_secret', jwtSecret);
      await config.set('security.cors_origin', corsOrigin || '');
      await config.set('org.name', orgName);
      await config.set('setup.completed', true);

      // Auto-login the user after setup completion
      const user = await db.client('users').where({ name: adminUsername }).first();
      if (user) {
        // Generate JWT token
        const token = await security.signJwt({ sub: user.id, is_admin: user.is_admin }, { expiresIn: '7d' });
        
        // Set authentication cookies
        const isProd = (process.env.NODE_ENV || 'production') === 'production';
        res.cookie('taklite_token', token, {
          httpOnly: true,
          secure: isProd,
          sameSite: 'strict',
          maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
          path: '/'
        });
        
        // Return success with user info
        res.json({ 
          success: true, 
          user: {
            email: user.email ?? undefined,
            name: user.name,
            isAdmin: user.is_admin
          },
          token: token
        });
      } else {
        res.json({ success: true });
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}


