import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable('refresh_tokens');
  if (!has) {
    await knex.schema.createTable('refresh_tokens', (t) => {
      t.uuid('id').primary(); // jti
      t.uuid('user_id').notNullable();
      t.string('token_hash').notNullable();
      t.timestamp('expires_at').notNullable();
      t.boolean('revoked').notNullable().defaultTo(false);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.foreign('user_id').references('users.id').onDelete('CASCADE');
      t.index(['user_id', 'revoked']);
      t.index(['expires_at']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
}


