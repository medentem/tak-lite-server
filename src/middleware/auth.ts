import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ConfigService } from '../services/config';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { sub: string; is_admin?: boolean };
    }
  }
}

export function createAuthMiddleware(config: ConfigService) {
  return {
    authenticate: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.headers.authorization || '';
        const [, token] = auth.split(' ');
        if (!token) return res.status(401).json({ error: 'Missing token' });
        const secret = (await config.get<string>('security.jwt_secret')) || '';
        if (!secret) return res.status(500).json({ error: 'Server not configured' });
        const payload = jwt.verify(token, secret) as { sub: string; is_admin?: boolean };
        req.user = payload;
        next();
      } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    },
    adminOnly: (req: Request, res: Response, next: NextFunction) => {
      if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin required' });
      next();
    }
  };
}


