import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('locations', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').notNullable();
    t.uuid('team_id').notNullable();
    t.double('latitude').notNullable();
    t.double('longitude').notNullable();
    t.double('altitude').nullable();
    t.double('accuracy').nullable();
    t.bigint('timestamp').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('annotations', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').notNullable();
    t.uuid('team_id').notNullable();
    t.string('type').notNullable();
    t.jsonb('data').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.foreign('user_id').references('users.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('messages', (t) => {
    t.uuid('id').primary();
    t.uuid('user_id').notNullable();
    t.uuid('team_id').notNullable();
    t.string('message_type').notNullable().defaultTo('text');
    t.text('content').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.foreign('user_id').references('users.id').onDelete('SET NULL');
  });

  await knex.schema.alterTable('team_memberships', (t) => {
    t.index(['user_id']);
    t.index(['team_id']);
  });
  await knex.schema.alterTable('locations', (t) => {
    t.index(['team_id', 'timestamp']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('annotations');
  await knex.schema.dropTableIfExists('locations');
}


