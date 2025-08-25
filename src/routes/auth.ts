import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { DatabaseService } from '../services/database';
import { ConfigService } from '../services/config';

export function createAuthRouter(db: DatabaseService, config: ConfigService) {
  const router = Router();

  router.post('/login', async (req, res, next) => {
    try {
      const schema = Joi.object({ email: Joi.string().email().required(), password: Joi.string().required() });
      const { email, password } = await schema.validateAsync(req.body);
      const user = await db.client('users').where({ email }).first();
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      const secret = (await config.get<string>('security.jwt_secret')) || '';
      if (!secret) return res.status(500).json({ error: 'JWT not configured' });
      const token = jwt.sign({ sub: user.id, is_admin: user.is_admin }, secret, { expiresIn: '7d' });
      res.json({ token });
    } catch (err) {
      next(err);
    }
  });

  return router;
}


