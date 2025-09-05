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
        ca: process.env.NODE_EXTRA_CA_CERTS 
      }
    },
    migrations: {
      directory: './migrations'
    }
  }
};

export default config;


