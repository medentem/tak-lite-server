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
    
    // Override SSL mode in connection string for Dev Databases
    if (connection.includes('sslmode=require')) {
      connection = connection.replace('sslmode=require', 'sslmode=prefer');
    }
    
    // Debug logging for SSL configuration
    logger.info('Database SSL Configuration', {
      nodeEnv: process.env.NODE_ENV,
      hasDatabaseCaCert: !!process.env.DATABASE_CA_CERT,
      pgsslmode: process.env.PGSSLMODE,
      nodeTlsRejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      databaseUrl: connection ? 'SET' : 'NOT_SET'
    });
    
    // Configure SSL using DO-injected CA, allow self-signed certs for Dev Databases
    const sslConfig = {
      rejectUnauthorized: false, // Allow self-signed certificates for Dev Databases
      ca: process.env.DATABASE_CA_CERT
    };
    
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


