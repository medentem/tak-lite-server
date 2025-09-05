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
        rejectUnauthorized: false, // Temporarily disable for DigitalOcean managed DB
        // If DATABASE_CA_CERT is available, use it
        ...(process.env.DATABASE_CA_CERT && { ca: process.env.DATABASE_CA_CERT })
      }
    },
    migrations: {
      directory: './migrations'
    }
  }
};

export default config;


