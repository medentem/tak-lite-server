import type { Knex } from 'knex';

// Fix schema issues:
// - Make annotations.user_id/messages.user_id nullable to support ON DELETE SET NULL
// - Add missing FKs for team_id to teams.id
// - Normalize numeric types to double precision for geo fields
// - Add helpful indexes for common queries

export async function up(knex: Knex): Promise<void> {
  // annotations.user_id -> nullable + FK SET NULL, and add team FK
  const hasAnnotations = await knex.schema.hasTable('annotations');
  if (hasAnnotations) {
    await knex.schema.alterTable('annotations', (t: Knex.CreateTableBuilder) => {
      // Drop existing FK on user_id if present, then alter to nullable
      t.dropForeign(['user_id']);
      t.uuid('user_id').nullable().alter();
    });
    await knex.schema.alterTable('annotations', (t: Knex.CreateTableBuilder) => {
      t.foreign('user_id').references('users.id').onDelete('SET NULL');
      // team FK
      t.foreign('team_id').references('teams.id').onDelete('CASCADE');
    });
    // Index for recent updates per team (idempotent)
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS annotations_team_id_updated_at_index ON annotations (team_id, updated_at)'
    );
  }

  // messages.user_id -> nullable + FK SET NULL, and add team FK
  const hasMessages = await knex.schema.hasTable('messages');
  if (hasMessages) {
    await knex.schema.alterTable('messages', (t: Knex.CreateTableBuilder) => {
      t.dropForeign(['user_id']);
      t.uuid('user_id').nullable().alter();
    });
    await knex.schema.alterTable('messages', (t: Knex.CreateTableBuilder) => {
      t.foreign('user_id').references('users.id').onDelete('SET NULL');
      t.foreign('team_id').references('teams.id').onDelete('CASCADE');
    });
    // Index for recent messages per team (idempotent)
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS messages_team_id_created_at_index ON messages (team_id, created_at)'
    );
  }

  // locations: fix numeric types and add FK + index
  const hasLocations = await knex.schema.hasTable('locations');
  if (hasLocations) {
    await knex.schema.alterTable('locations', (t: Knex.CreateTableBuilder) => {
      // Replace non-standard double with double precision
      t.specificType('latitude', 'double precision').notNullable().alter();
      t.specificType('longitude', 'double precision').notNullable().alter();
      t.specificType('altitude', 'double precision').nullable().alter();
      t.specificType('accuracy', 'double precision').nullable().alter();
      // team FK
      t.foreign('team_id').references('teams.id').onDelete('CASCADE');
    });
    // Index for time-ordered lookups per team (may already exist from prior migration)
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS locations_team_id_timestamp_index ON locations (team_id, timestamp)'
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  // Best-effort revert: drop added indexes and team FK; keep safer nullable user_id
  const hasAnnotations = await knex.schema.hasTable('annotations');
  if (hasAnnotations) {
    await knex.raw('DROP INDEX IF EXISTS annotations_team_id_updated_at_index');
    await knex.schema.alterTable('annotations', (t: Knex.CreateTableBuilder) => {
      t.dropForeign(['team_id']);
      // Keep user_id nullable to avoid data loss on down migration
    });
  }

  const hasMessages = await knex.schema.hasTable('messages');
  if (hasMessages) {
    await knex.raw('DROP INDEX IF EXISTS messages_team_id_created_at_index');
    await knex.schema.alterTable('messages', (t: Knex.CreateTableBuilder) => {
      t.dropForeign(['team_id']);
    });
  }

  const hasLocations = await knex.schema.hasTable('locations');
  if (hasLocations) {
    await knex.raw('DROP INDEX IF EXISTS locations_team_id_timestamp_index');
    await knex.schema.alterTable('locations', (t: Knex.CreateTableBuilder) => {
      t.dropForeign(['team_id']);
      // Types left as double precision (no-op revert to avoid potential precision loss)
    });
  }
}


