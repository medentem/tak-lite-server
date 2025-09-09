import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add user_status column to locations table to support status-based styling
  await knex.schema.alterTable('locations', (t: Knex.CreateTableBuilder) => {
    t.string('user_status', 20).nullable().defaultTo('GREEN');
  });
  
  // Add index for status-based queries
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS locations_user_status_index ON locations (user_status)'
  );
}

export async function down(knex: Knex): Promise<void> {
  // Remove the user_status column and index
  await knex.raw('DROP INDEX IF EXISTS locations_user_status_index');
  await knex.schema.alterTable('locations', (t: Knex.CreateTableBuilder) => {
    t.dropColumn('user_status');
  });
}
