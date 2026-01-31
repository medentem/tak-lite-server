import knex, { Knex } from 'knex';
import path from 'path';
import { logger } from '../utils/logger';

/**
 * Normalize CA cert string for Node TLS. DigitalOcean (and others) often inject
 * multiline env vars with literal backslash-n; Node expects real newlines in PEM.
 */
function normalizeCaCert(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const normalized = raw.trim().replace(/\\n/g, '\n');
  return normalized.length > 0 ? normalized : undefined;
}

/** When true, disables TLS certificate verification for the DB connection only (not global). Avoid in production. */
function isDbSslInsecure(): boolean {
  return process.env.DATABASE_SSL_INSECURE === '1' || process.env.DATABASE_SSL_INSECURE === 'true';
}

/**
 * Decompose a Postgres URL into individual connection params. Required for DigitalOcean
 * managed DB: using connectionString + ssl with pg breaks certificate validation
 * (SELF_SIGNED_CERT_IN_CHAIN); individual params + ssl work correctly.
 */
function parseConnectionUrl(url: string): { host: string; port: number; database: string; user: string; password: string } | null {
  try {
    const u = new URL(url);
    const database = u.pathname ? u.pathname.slice(1).replace(/%2F/g, '/') : 'postgres';
    return {
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 5432,
      database,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password)
    };
  } catch {
    return null;
  }
}

export class DatabaseService {
  private knexInstance: Knex;

  constructor() {
    let connection = process.env.DATABASE_URL;
    if (!connection) {
      throw new Error('DATABASE_URL is required');
    }

    const rawCa = process.env.DATABASE_CA_CERT;
    const ca = normalizeCaCert(rawCa);
    const sslInsecure = isDbSslInsecure();

    logger.info('Database SSL Configuration', {
      nodeEnv: process.env.NODE_ENV,
      hasDatabaseCaCert: !!rawCa,
      caNormalized: !!ca,
      pgsslmode: process.env.PGSSLMODE,
      databaseUrl: connection ? 'SET' : 'NOT_SET',
      sslInsecure
    });

    let sslConfig: boolean | { ca?: string; rejectUnauthorized: boolean };
    if (sslInsecure) {
      logger.warn('DATABASE_SSL_INSECURE is set; DB TLS verification is disabled. Do not use in production.');
      sslConfig = { rejectUnauthorized: false };
    } else if (ca) {
      sslConfig = { ca, rejectUnauthorized: true };
    } else {
      sslConfig = true;
    }

    if (rawCa && !ca) {
      logger.warn('DATABASE_CA_CERT was set but normalized to empty; check format (PEM with newlines or \\n literals).');
    } else if (ca) {
      logger.info('CA Cert applied with rejectUnauthorized: true');
    } else if (!sslInsecure) {
      logger.warn('No DATABASE_CA_CERT; connection uses default TLS (no custom CA).');
    }

    // When using a CA, decompose the URL into individual params so pg SSL validation works
    // (DigitalOcean managed DB: connectionString + ssl causes SELF_SIGNED_CERT_IN_CHAIN)
    const useDecomposed = !!ca && !sslInsecure;
    const parsed = useDecomposed ? parseConnectionUrl(connection) : null;

    const connectionForLog = connection
      .replace(/(password=)([^&]+)/, '$1***')
      .replace(/(:)([^:@]+)(@)/, '$1***$3');
    logger.info('Database Connection', {
      connectionString: connectionForLog,
      hasCa: !!ca,
      useDecomposed: useDecomposed && !!parsed
    });

    const knexConnection = useDecomposed && parsed
      ? { ...parsed, ssl: sslConfig }
      : { connectionString: connection, ssl: sslConfig };
    if (useDecomposed && !parsed) {
      logger.warn('Could not parse DATABASE_URL for decomposed connection; using connectionString (SSL validation may fail)');
    }

    this.knexInstance = knex({
      client: 'pg',
      connection: knexConnection,
      pool: {
        min: 2,
        max: 10,
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        destroyTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 200
      },
      migrations: {
        // Use the same path as knexfile.ts - migrations are in the root migrations folder
        directory: path.resolve(process.cwd(), 'migrations')
      },
      // Ensure proper JSON handling for PostgreSQL JSONB columns
      asyncStackTraces: true,
      debug: false
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
          
          // Note: social_media_monitors and ai_configurations are global tables, not team-scoped
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


