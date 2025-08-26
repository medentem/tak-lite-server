import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { DatabaseService } from '../services/database';
import { ConfigService } from '../services/config';

export function createAuthRouter(db: DatabaseService, config: ConfigService) {
  const router = Router();

  // Per-route limiter to protect login from brute force
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });

  router.post('/login', loginLimiter, async (req, res, next) => {
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

  // Who am I (validate token and return subject and admin flag)
  router.get('/whoami', async (req, res) => {
    const auth = req.headers.authorization || '';
    const [, token] = auth.split(' ');
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const secret = (await config.get<string>('security.jwt_secret')) || '';
    if (!secret) return res.status(500).json({ error: 'Server not configured' });
    try {
      const payload = jwt.verify(token, secret) as { sub: string; is_admin?: boolean };
      res.json({ userId: payload.sub, isAdmin: !!payload.is_admin });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  });

  return router;
}


