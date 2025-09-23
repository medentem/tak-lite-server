import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add fields to track threat updates and AI decisions
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.timestamp('last_updated_at').defaultTo(knex.fn.now()); // Track when threat was last updated
    t.integer('update_count').defaultTo(0); // Track number of times this threat has been updated
    t.text('last_update_reasoning').nullable(); // AI reasoning for the last update
    t.jsonb('update_history').nullable(); // Store summary of what was updated
  });

  // Add index for efficient querying by last update time
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.index(['last_updated_at']);
    t.index(['update_count']);
  });

  // Add semantic hash for faster similarity detection
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.string('semantic_hash', 64).nullable(); // Hash of key threat characteristics for quick similarity
  });

  await knex.schema.alterTable('threat_analyses', (t) => {
    t.index(['semantic_hash']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop the indexes we created
  await knex.raw('DROP INDEX IF EXISTS threat_analyses_last_updated_at_index');
  await knex.raw('DROP INDEX IF EXISTS threat_analyses_update_count_index');
  await knex.raw('DROP INDEX IF EXISTS threat_analyses_semantic_hash_index');

  // Remove the added columns
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.dropColumn('last_updated_at');
    t.dropColumn('update_count');
    t.dropColumn('last_update_reasoning');
    t.dropColumn('update_history');
    t.dropColumn('semantic_hash');
  });
}
