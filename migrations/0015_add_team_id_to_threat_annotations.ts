import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add team_id column to threat_annotations table to support team filtering
  await knex.schema.alterTable('threat_annotations', (t) => {
    t.uuid('team_id').nullable().references('teams.id').onDelete('SET NULL');
  });

  // Add index for efficient team filtering
  await knex.schema.alterTable('threat_annotations', (t) => {
    t.index(['team_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove the team_id column and its index
  await knex.schema.alterTable('threat_annotations', (t) => {
    t.dropIndex(['team_id']);
    t.dropColumn('team_id');
  });
}
