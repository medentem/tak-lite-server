import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { metricsMiddleware, metricsHandler } from './middleware/metrics';
import { DatabaseService } from './services/database';
import { ConfigService } from './services/config';
import { createSetupRouter } from './routes/setup';
import { createAuthRouter } from './routes/auth';
import { createAdminRouter } from './routes/admin';
import { createAuthMiddleware } from './middleware/auth';
import { SyncService } from './services/sync';
import { createSyncRouter } from './routes/sync';
import { SocketGateway } from './services/sockets';
import jwt from 'jsonwebtoken';

// Placeholder imports for future optional services/routes
// import { RedisService } from './services/redis';
// import { RabbitMQService } from './services/rabbitmq';
// import { SyncService } from './services/sync';
// import { AnalyticsService } from './services/analytics';
// import { NotificationService } from './services/notifications';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Initialize services
const databaseService = new DatabaseService();
const configService = new ConfigService(databaseService);
const syncService = new SyncService(io, databaseService);

// Security middleware
app.use(helmet());
// Dynamic CORS with cached config: read once per TTL
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const completed = await configService.get<boolean>('setup.completed');
  const cfgOrigin = completed ? await configService.get<string>('security.cors_origin') : undefined;
  const origin = cfgOrigin && cfgOrigin.length > 0 ? cfgOrigin : process.env.CORS_ORIGIN || '*';
  return cors({ origin, credentials: true })(req, res, next);
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Simple request logging using built-in middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Metrics middleware
app.use(metricsMiddleware);
app.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const completed = await configService.get<boolean>('setup.completed');
    if (!completed) return metricsHandler(req, res);
    const authHeader = req.headers.authorization || '';
    const [, token] = authHeader.split(' ');
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const secret = (await configService.get<string>('security.jwt_secret')) || '';
    if (!secret) return res.status(500).json({ error: 'Server not configured' });
    const payload = jwt.verify(token, secret) as { is_admin?: boolean };
    if (!payload.is_admin) return res.status(403).json({ error: 'Admin required' });
    return metricsHandler(req, res);
  } catch (err) {
    return next(err);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// First-run setup
app.use('/api/setup', createSetupRouter(databaseService, configService));

// Serve interactive setup page
app.get('/setup', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  // Relax CSP for inline scripts/styles used by the simple setup page
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  const primary = path.resolve(__dirname, 'public', 'setup.html');
  const fallback = path.resolve(__dirname, '..', 'public', 'setup.html');
  const file = fs.existsSync(primary) ? primary : fallback;
  res.sendFile(file);
});

// Gate other routes until setup is complete
app.use(async (req, res, next) => {
  const completed = await configService.get<boolean>('setup.completed');
  if (!completed && !req.path.startsWith('/api/setup')) {
    return res.status(428).json({ error: 'Setup required', setupPath: '/setup' });
  }
  next();
});

// Auth routes after setup
app.use('/api/auth', createAuthRouter(databaseService, configService));

// Admin routes (admin only)
const auth = createAuthMiddleware(configService);
app.use('/api/admin', auth.authenticate, auth.adminOnly, createAdminRouter(configService, databaseService, io));

// Sync routes (auth required)
app.use('/api/sync', auth.authenticate, createSyncRouter(syncService));

// Serve admin UI
app.get('/admin', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  // Relax CSP for inline scripts/styles used by the simple admin page
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");
  const primary = path.resolve(__dirname, 'public', 'admin.html');
  const fallback = path.resolve(__dirname, '..', 'public', 'admin.html');
  const file = fs.existsSync(primary) ? primary : fallback;
  res.sendFile(file);
});

// TODO: add sync/users/analytics/admin routes in subsequent phases

// WebSocket connection handling (basic placeholders)
new SocketGateway(io, configService, syncService).bind();

// Error handling middleware
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Close server
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close database connections
  await databaseService.close();

  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  // Close server
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close database connections
  await databaseService.close();

  process.exit(0);
});

// Run migrations then start server
(async () => {
  try {
    await databaseService.migrateToLatest();
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      logger.info(`TAK Lite Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    logger.error('Failed to start server', { err });
    process.exit(1);
  }
})();

export { app, server, io };
