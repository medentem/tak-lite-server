import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ai_usage_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    t.string('model').notNullable();
    t.integer('prompt_tokens').defaultTo(0);
    t.integer('completion_tokens').defaultTo(0);
    t.integer('total_tokens').defaultTo(0);
    t.decimal('estimated_cost_usd', 12, 6).defaultTo(0);
    t.uuid('geographical_search_id').nullable().references('geographical_searches.id').onDelete('SET NULL');
    t.string('call_type').notNullable(); // 'search' | 'deduplication' | 'test'
    t.jsonb('metadata').nullable();
  });

  await knex.schema.alterTable('ai_usage_log', (t) => {
    t.index(['created_at']);
    t.index(['geographical_search_id']);
    t.index(['call_type']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_usage_log');
}
