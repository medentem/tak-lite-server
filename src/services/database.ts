import knex, { Knex } from 'knex';
import path from 'path';
import { logger } from '../utils/logger';

export class DatabaseService {
  private knexInstance: Knex;

  constructor() {
    const connection = process.env.DATABASE_URL;
    if (!connection) {
      throw new Error('DATABASE_URL is required');
    }
    
    // Debug logging for SSL configuration
    logger.info('Database SSL Configuration', {
      nodeEnv: process.env.NODE_ENV,
      hasDatabaseCaCert: !!process.env.DATABASE_CA_CERT,
      pgsslmode: process.env.PGSSLMODE,
      databaseUrl: connection ? 'SET' : 'NOT_SET'
    });
    
    // Configure SSL for production - DigitalOcean managed DB doesn't inject CA cert
    const sslConfig = process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false // Disable certificate validation for DigitalOcean managed DB
    } : false;

    this.knexInstance = knex({
      client: 'pg',
      connection: {
        connectionString: connection,
        ssl: sslConfig
      },
      migrations: {
        // When compiled, this file lives at dist/src/services, so go up to dist/migrations
        directory: path.resolve(__dirname, '..', '..', 'migrations')
      }
    });
  }

  public get client(): Knex {
    return this.knexInstance;
  }

  async migrateToLatest(): Promise<void> {
    try {
      await this.knexInstance.migrate.latest();
      logger.info('Database migrations applied');
    } catch (err) {
      const e = err as any;
      logger.error('Failed to apply migrations', { message: e?.message, code: e?.code, stack: e?.stack });
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.knexInstance.destroy();
  }
}


