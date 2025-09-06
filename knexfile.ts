import type { Knex } from 'knex';

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
      ssl: process.env.DATABASE_CA_CERT ? {
        ca: process.env.DATABASE_CA_CERT,
        rejectUnauthorized: false // Let NODE_TLS_REJECT_UNAUTHORIZED handle validation
      } : true
    },
    migrations: {
      directory: './migrations'
    }
  },
  // Add a default configuration that uses SSL with CA certificate when available
  default: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_CA_CERT ? {
        ca: process.env.DATABASE_CA_CERT,
        rejectUnauthorized: false // Let NODE_TLS_REJECT_UNAUTHORIZED handle validation
      } : true
    },
    migrations: {
      directory: './migrations'
    }
  }
};

export default config;


