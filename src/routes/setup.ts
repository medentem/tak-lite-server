import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { DatabaseService } from '../services/database';
import { ConfigService } from '../services/config';
import { SecurityService } from '../services/security';

export function createSetupRouter(db: DatabaseService, config: ConfigService) {
  const router = Router();
  const security = new SecurityService(config);

  router.get('/status', async (_req, res) => {
    const completed = await config.get<boolean>('setup.completed');
    res.json({ completed: !!completed });
  });

  router.post('/complete', async (req, res, next) => {
    try {
      const schema = Joi.object({
        adminEmail: Joi.string().email().required(),
        adminPassword: Joi.string().min(10).required(),
        orgName: Joi.string().min(2).required(),
        corsOrigin: Joi.string().allow('').optional()
      });
      const { adminEmail, adminPassword, orgName, corsOrigin } = await schema.validateAsync(req.body);

      const already = await config.get<boolean>('setup.completed');
      if (already) return res.status(400).json({ error: 'Setup already completed' });

      const password_hash = await bcrypt.hash(adminPassword, 10);
      const adminId = uuidv4();
      const teamId = uuidv4();

      await db.client.transaction(async (trx) => {
        // Idempotent creates
        const existingUser = await trx('users').where({ email: adminEmail }).first();
        if (!existingUser) {
          await trx('users').insert({
            id: adminId,
            email: adminEmail,
            password_hash,
            name: 'Administrator',
            is_admin: true
          });
        }
        const userRow = existingUser || (await trx('users').where({ email: adminEmail }).first());
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
      const user = await db.client('users').where({ email: adminEmail }).first();
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
            email: user.email,
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


