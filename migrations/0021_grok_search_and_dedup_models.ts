import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('grok_configurations', (t) => {
    t.string('deduplication_model').nullable();
  });
  // Backfill: existing rows use same model for dedup (null = use model)
  await knex.raw(`
    UPDATE grok_configurations SET deduplication_model = NULL WHERE 1=1
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('grok_configurations', (t) => {
    t.dropColumn('deduplication_model');
  });
}
