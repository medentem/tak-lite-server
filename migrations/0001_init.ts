import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('config', (t) => {
    t.string('key').primary();
    t.jsonb('value').notNullable();
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary();
    t.string('email').notNullable().unique();
    t.string('password_hash').notNullable();
    t.string('name').notNullable();
    t.boolean('is_admin').notNullable().defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('teams', (t) => {
    t.uuid('id').primary();
    t.string('name').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('team_memberships', (t) => {
    t.uuid('user_id').notNullable();
    t.uuid('team_id').notNullable();
    t.primary(['user_id', 'team_id']);
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
    t.foreign('team_id').references('teams.id').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('team_memberships');
  await knex.schema.dropTableIfExists('teams');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('config');
}


