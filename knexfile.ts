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
      ssl: {
        rejectUnauthorized: true,
        ca: process.env.DATABASE_CA_CERT
      }
    },
    migrations: {
      directory: './migrations'
    }
  },
  // Add a default configuration that always uses SSL with disabled certificate validation
  default: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: true,
        ca: process.env.DATABASE_CA_CERT
      }
    },
    migrations: {
      directory: './migrations'
    }
  }
};

export default config;


