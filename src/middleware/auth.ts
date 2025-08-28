import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ConfigService } from '../services/config';
import { SecurityService } from '../services/security';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { sub: string; is_admin?: boolean };
    }
  }
}

export function createAuthMiddleware(config: ConfigService) {
  const security = new SecurityService(config);
  return {
    authenticate: async (req: Request, res: Response, next: NextFunction) => {
      try {
        const auth = req.headers.authorization || '';
        const [, token] = auth.split(' ');
        const cookieHeader = req.headers.cookie || '';
        const cookies = Object.fromEntries(
          cookieHeader
            .split(';')
            .map((c) => c.trim())
            .filter((c) => c.includes('='))
            .map((c) => {
              const idx = c.indexOf('=');
              return [decodeURIComponent(c.slice(0, idx)), decodeURIComponent(c.slice(idx + 1))];
            })
        );
        const cookieToken = cookies['taklite_token'];
        const tok = token || cookieToken;
        if (!tok) return res.status(401).json({ error: 'Missing token' });
        const payload = await security.verifyJwt<{ sub: string; is_admin?: boolean }>(tok);
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


