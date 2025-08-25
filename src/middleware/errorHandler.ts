import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const details = err.details || undefined;
  if (status >= 500) {
    logger.error(`Unhandled error: ${message}`, { stack: err.stack });
  } else {
    logger.warn(`Request error: ${message}`, { status, path: req.path });
  }
  res.status(status).json({ error: message, details });
}


