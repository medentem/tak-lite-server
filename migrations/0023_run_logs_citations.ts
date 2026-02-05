import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('geographical_monitor_run_logs');
  if (!hasTable) return;

  await knex.schema.alterTable('geographical_monitor_run_logs', (t) => {
    t.jsonb('citations').nullable(); // Top-level source URLs from Responses API
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('geographical_monitor_run_logs');
  if (!hasTable) return;

  await knex.schema.alterTable('geographical_monitor_run_logs', (t) => {
    t.dropColumn('citations');
  });
}
