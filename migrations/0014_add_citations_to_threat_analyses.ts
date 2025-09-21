import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add citations column to threat_analyses table to store source citations from Grok
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.jsonb('citations').nullable(); // Array of citation objects with URLs, content previews, etc.
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove the citations column
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.dropColumn('citations');
  });
}
