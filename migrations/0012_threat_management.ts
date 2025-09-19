import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add admin management columns to threat_analyses table
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.string('admin_status').nullable(); // pending, reviewed, approved, dismissed
    t.text('admin_notes').nullable(); // Admin review notes
    t.uuid('reviewed_by').nullable().references('users.id'); // Who reviewed it
    t.timestamp('reviewed_at').nullable(); // When it was reviewed
    t.uuid('annotation_id').nullable().references('annotations.id'); // Link to created annotation
    t.jsonb('reasoning').nullable(); // AI reasoning for the threat assessment
  });

  // Add index for efficient querying by admin status
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.index(['admin_status']);
    t.index(['reviewed_at']);
    t.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove the added columns
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.dropColumn('admin_status');
    t.dropColumn('admin_notes');
    t.dropColumn('reviewed_by');
    t.dropColumn('reviewed_at');
    t.dropColumn('annotation_id');
    t.dropColumn('reasoning');
  });
}
