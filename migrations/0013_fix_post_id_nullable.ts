import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Make post_id nullable to support geographical searches without specific posts
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.uuid('post_id').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Revert post_id to not nullable (this will fail if there are null values)
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.uuid('post_id').notNullable().alter();
  });
}
