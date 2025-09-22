import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Make team_id nullable in locations table to support global data
  await knex.schema.alterTable('locations', (t) => {
    t.uuid('team_id').nullable().alter();
  });

  // Make team_id nullable in annotations table to support global data
  await knex.schema.alterTable('annotations', (t) => {
    t.uuid('team_id').nullable().alter();
  });

  // Make team_id nullable in messages table to support global data
  await knex.schema.alterTable('messages', (t) => {
    t.uuid('team_id').nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Revert team_id to not nullable (this will fail if there are null values)
  await knex.schema.alterTable('locations', (t) => {
    t.uuid('team_id').notNullable().alter();
  });

  await knex.schema.alterTable('annotations', (t) => {
    t.uuid('team_id').notNullable().alter();
  });

  await knex.schema.alterTable('messages', (t) => {
    t.uuid('team_id').notNullable().alter();
  });
}
