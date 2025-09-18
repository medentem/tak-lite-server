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
      
      // Verify critical tables exist after migrations
      await this.verifyTablesExist();
      
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

  private async verifyTablesExist(): Promise<void> {
    try {
      // Check if social media tables exist and have expected columns
      const tables = ['social_media_monitors', 'social_media_posts', 'threat_analyses', 'threat_annotations', 'ai_configurations'];
      
      for (const table of tables) {
        const exists = await this.knexInstance.schema.hasTable(table);
        logger.info(`Table ${table} exists`, { exists });
        
        if (exists) {
          // Check for critical columns
          const columns = await this.knexInstance(table).columnInfo();
          logger.info(`Table ${table} columns`, { columns: Object.keys(columns) });
          
          // Check for team_id column specifically
          if (table === 'social_media_monitors' || table === 'ai_configurations') {
            const hasTeamId = columns.hasOwnProperty('team_id');
            logger.info(`Table ${table} has team_id column`, { hasTeamId });
            
            if (!hasTeamId) {
              logger.error(`CRITICAL: Table ${table} missing team_id column!`, { 
                table, 
                existingColumns: Object.keys(columns) 
              });
            }
          }
        }
      }
    } catch (err) {
      logger.error('Error verifying tables', { error: err });
    }
  }

  async close(): Promise<void> {
    await this.knexInstance.destroy();
  }
}


