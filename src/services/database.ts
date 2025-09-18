import knex, { Knex } from 'knex';
import path from 'path';
import { logger } from '../utils/logger';

export class DatabaseService {
  private knexInstance: Knex;

  constructor() {
    let connection = process.env.DATABASE_URL;
    if (!connection) {
      throw new Error('DATABASE_URL is required');
    }
    
    // Debug logging for SSL configuration
    logger.info('Database SSL Configuration', {
      nodeEnv: process.env.NODE_ENV,
      hasDatabaseCaCert: !!process.env.DATABASE_CA_CERT,
      pgsslmode: process.env.PGSSLMODE,
      nodeTlsRejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      databaseUrl: connection ? 'SET' : 'NOT_SET'
    });
    
    // Configure SSL with CA certificate when available
    // NODE_TLS_REJECT_UNAUTHORIZED='0' handles certificate validation globally
    const sslConfig = process.env.DATABASE_CA_CERT ? {
      ca: process.env.DATABASE_CA_CERT,
      rejectUnauthorized: false // Let NODE_TLS_REJECT_UNAUTHORIZED handle validation
    } : true;
    
    logger.info('SSL Config Applied', { sslConfig, nodeEnv: process.env.NODE_ENV });
    
    // Log the first 20 chars of the CA cert for verification (secure, no full cert)
    if (process.env.DATABASE_CA_CERT) {
      logger.info('CA Cert Preview', { caStart: process.env.DATABASE_CA_CERT.substring(0, 20) + '...' });
    } else {
      logger.warn('CA Cert Missing');
    }

    // Log connection string (redacted) and presence of CA
    const connectionForLog = connection
      .replace(/(password=)([^&]+)/, '$1***')
      .replace(/(:)([^:@]+)(@)/, '$1***$3');
    logger.info('Database Connection', {
      connectionString: connectionForLog,
      hasCaFromEnv: !!process.env.DATABASE_CA_CERT,
      sslModeOverridden: process.env.DATABASE_URL?.includes('sslmode=require')
    });

    this.knexInstance = knex({
      client: 'pg',
      connection: {
        connectionString: connection,
        ssl: sslConfig
      },
      migrations: {
        // Use the same path as knexfile.ts - migrations are in the root migrations folder
        directory: path.resolve(process.cwd(), 'migrations')
      }
    });
  }

  public get client(): Knex {
    return this.knexInstance;
  }

  async migrateToLatest(): Promise<void> {
    try {
      // Check current migration status
      const currentVersion = await this.knexInstance.migrate.currentVersion();
      logger.info('Current migration version', { currentVersion });
      
      // Get pending migrations
      const pendingMigrations = await this.knexInstance.migrate.list();
      logger.info('Migration status', { pendingMigrations });
      
      // Run migrations
      const result = await this.knexInstance.migrate.latest();
      logger.info('Database migrations applied', { result });
    } catch (err) {
      const e = err as any;
      logger.error('Failed to apply migrations', { 
        message: e?.message, 
        code: e?.code, 
        stack: e?.stack,
        migrationPath: path.resolve(process.cwd(), 'migrations')
      });
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.knexInstance.destroy();
  }
}


