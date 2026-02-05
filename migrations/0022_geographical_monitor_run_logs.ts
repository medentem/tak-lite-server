import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('geographical_monitor_run_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('geographical_search_id').notNullable().references('geographical_searches.id').onDelete('CASCADE');
    t.timestamp('run_at').notNullable().defaultTo(knex.fn.now());
    t.text('system_prompt').notNullable();
    t.text('user_prompt').notNullable();
    t.text('response_raw').notNullable();
    t.integer('threats_found').defaultTo(0);
  });

  await knex.schema.alterTable('geographical_monitor_run_logs', (t) => {
    t.index(['geographical_search_id', 'run_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('geographical_monitor_run_logs');
}
