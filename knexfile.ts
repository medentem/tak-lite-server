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
        rejectUnauthorized: false // Disable certificate validation for DigitalOcean managed DB
      }
    },
    migrations: {
      directory: './migrations'
    }
  }
};

export default config;


