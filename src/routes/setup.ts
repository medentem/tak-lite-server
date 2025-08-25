import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { DatabaseService } from '../services/database';
import { ConfigService } from '../services/config';

export function createSetupRouter(db: DatabaseService, config: ConfigService) {
  const router = Router();

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

      const jwtSecret = uuidv4() + uuidv4();
      await config.set('security.jwt_secret', jwtSecret);
      await config.set('security.cors_origin', corsOrigin || '');
      await config.set('org.name', orgName);
      await config.set('setup.completed', true);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}


