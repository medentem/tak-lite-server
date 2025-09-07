import type { Request, Response, NextFunction } from 'express-serve-static-core';
const express = require('express');
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
const compression = require('compression');
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
import { RetentionService } from './services/retention';
import { AuditService } from './services/audit';
import { SecurityService } from './services/security';

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
// WebSocket CORS will be configured dynamically in the socket service
const io = new Server(server, {
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      
      // Auto-allow DigitalOcean app domains
      if (origin.includes('.ondigitalocean.app')) {
        return callback(null, true);
      }
      
      // For now, allow all origins - this will be made more restrictive in the socket service
      return callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: false
  }
});

// Initialize services
const databaseService = new DatabaseService();
const configService = new ConfigService(databaseService);
const securityService = new SecurityService(configService);
const syncService = new SyncService(io, databaseService);
const auditService = new AuditService(databaseService);
const retentionService = new RetentionService(databaseService, configService);

// Security middleware
app.use(helmet());
// Dynamic CORS with strict allowlist: prefer configured origins; fallback to env; never allow '*'
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const completed = await configService.get<boolean>('setup.completed');
  const cfgOrigin = completed ? await configService.get<string>('security.cors_origin') : undefined;
  const parseOrigins = (val?: string): string[] =>
    (val || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '*');
  const configured = parseOrigins(cfgOrigin);
  const fromEnv = parseOrigins(process.env.CORS_ORIGIN);
  
  // Build allowlist with sensible defaults
  let allowlist: string[];
  if (!completed) {
    // Setup phase: allow same-origin and common development origins
    allowlist = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://127.0.0.1:8080'];
    // Also include any configured environment origins
    allowlist = [...allowlist, ...fromEnv];
    
    // Remove any unresolved DigitalOcean domains from allowlist
    const unresolvedDoDomains = allowlist.filter(origin => origin.includes('${app.name}'));
    if (unresolvedDoDomains.length > 0) {
      logger.warn('CORS: Found unresolved DigitalOcean domains, removing them:', { unresolvedDoDomains });
      allowlist = allowlist.filter(origin => !origin.includes('${app.name}'));
    }
    
    logger.info('CORS setup phase - allowing origins:', { allowlist, completed });
  } else {
    // After setup: use configured origins, fallback to env, or use development defaults if nothing configured
    allowlist = configured.length > 0 ? configured : fromEnv;
    
    // If still no origins configured, fall back to development defaults for safety
    if (allowlist.length === 0) {
      allowlist = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://127.0.0.1:8080'];
      logger.warn('CORS: No origins configured, falling back to development defaults:', { allowlist });
    }
    
    logger.info('CORS post-setup - using origins:', { allowlist, configured, fromEnv, completed });
  }
  
  const originFn = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      logger.debug('CORS: No origin header, allowing (same-origin request)');
      return callback(null, true); // Allow requests without origin (same-origin)
    }
    
    // Always allow same-origin requests (when origin matches the request's host)
    const requestHost = `${req.protocol}://${req.get('host')}`;
    if (origin === requestHost) {
      logger.debug('CORS: Same-origin request, allowing:', { origin, requestHost });
      return callback(null, true);
    }
    
    // Auto-allow DigitalOcean app domains (both during setup and after setup)
    if (origin.includes('.ondigitalocean.app')) {
      logger.info('CORS: Auto-allowing DigitalOcean app domain:', { origin, completed });
      return callback(null, true);
    }
    
    const allowed = allowlist.includes(origin);
    if (!allowed) {
      logger.warn('CORS: Origin blocked', { origin, requestHost, allowlist, path: req.path });
    } else {
      logger.debug('CORS: Origin allowed:', { origin, path: req.path });
    }
    return callback(allowed ? null : new Error('Not allowed by CORS'), allowed);
  };
  
  return cors({
    origin: originFn,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })(req, res, next);
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

// Body parsing with conservative defaults; larger uploads should use dedicated endpoints
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Simple request logging using built-in middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Metrics middleware
app.use(metricsMiddleware);
// Serve static assets for public files (admin/setup scripts, styles)
const staticPrimary = path.resolve(__dirname, 'public');
const staticFallback = path.resolve(__dirname, '..', 'public');
if (fs.existsSync(staticPrimary)) {
  app.use('/public', express.static(staticPrimary));
} else if (fs.existsSync(staticFallback)) {
  app.use('/public', express.static(staticFallback));
}

// Serve Socket.IO client library from node_modules
const socketIOPath = path.resolve(__dirname, '..', 'node_modules', 'socket.io-client', 'dist');
if (fs.existsSync(socketIOPath)) {
  app.use('/socket.io-client', express.static(socketIOPath));
}

app.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const completed = await configService.get<boolean>('setup.completed');
    if (!completed) return metricsHandler(req, res);
    const authHeader = req.headers.authorization || '';
    const [, token] = authHeader.split(' ');
    if (!token) return res.status(401).json({ error: 'Missing token' });
    const payload = await securityService.verifyJwt<{ is_admin?: boolean }>(token);
    if (!payload.is_admin) return res.status(403).json({ error: 'Admin required' });
    return metricsHandler(req, res);
  } catch (err) {
    return next(err);
  }
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Favicon endpoint to prevent 404 errors
app.get('/favicon.ico', (_req: Request, res: Response) => {
  res.status(204).end(); // No content, but no error
});

// First-run setup
app.use('/api/setup', createSetupRouter(databaseService, configService));

// Serve interactive setup page
app.get('/setup', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  // Strict CSP now that setup uses external JS
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'");
  const primary = path.resolve(__dirname, 'public', 'setup.html');
  const fallback = path.resolve(__dirname, '..', 'public', 'setup.html');
  const file = fs.existsSync(primary) ? primary : fallback;
  res.sendFile(file);
});

// Gate other routes until setup is complete
app.use(async (req: Request, res: Response, next: NextFunction) => {
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
app.get('/admin', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  // Strict CSP for admin: only local scripts allowed
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  const primary = path.resolve(__dirname, 'public', 'admin.html');
  const fallback = path.resolve(__dirname, '..', 'public', 'admin.html');
  const file = fs.existsSync(primary) ? primary : fallback;
  res.sendFile(file);
});

// TODO: add sync/users/analytics/admin routes in subsequent phases

// WebSocket connection handling (basic placeholders)
const socketGateway = new SocketGateway(io, configService, syncService);
socketGateway.bind();

// Make socket gateway available to sync service for admin events
(io as any).socketGateway = socketGateway;

// Background services
retentionService.start();

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
