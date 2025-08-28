import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable('audit_logs');
  if (!has) {
    await knex.schema.createTable('audit_logs', (t) => {
      t.uuid('id').primary();
      t.uuid('actor_user_id').nullable();
      t.string('action').notNullable();
      t.string('resource_type').notNullable();
      t.string('resource_id').nullable();
      t.jsonb('metadata').notNullable().defaultTo('{}');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.index(['resource_type', 'resource_id']);
      t.index(['actor_user_id', 'created_at']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
}


