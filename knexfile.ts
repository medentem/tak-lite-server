import type { Knex } from 'knex';

/** Normalize CA cert: env vars often have literal \\n; Node TLS expects real newlines. */
function normalizeCaCert(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const normalized = raw.trim().replace(/\\n/g, '\n');
  return normalized.length > 0 ? normalized : undefined;
}

function getSslConfig(): boolean | { ca: string; rejectUnauthorized: boolean } {
  const ca = normalizeCaCert(process.env.DATABASE_CA_CERT);
  if (ca) return { ca, rejectUnauthorized: true };
  return true;
}

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: {
      directory: './migrations'
    }
  },
  production: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: getSslConfig()
    },
    migrations: {
      directory: './migrations'
    }
  },
  default: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: getSslConfig()
    },
    migrations: {
      directory: './migrations'
    }
  }
};

export default config;


