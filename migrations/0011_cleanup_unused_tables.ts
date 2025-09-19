import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Remove unused columns from social_media_monitors table
  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.dropColumn('api_provider');
    t.dropColumn('api_credentials');
    t.dropColumn('query_type');
  });

  // Remove unused columns from social_media_posts table
  await knex.schema.alterTable('social_media_posts', (t) => {
    t.dropColumn('author_info');
    t.dropColumn('engagement_metrics');
    t.dropColumn('entities');
    t.dropColumn('raw_data');
  });

  // Remove unused columns from threat_analyses table
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.dropColumn('openai_analysis');
  });

  // Remove unused columns from threat_annotations table
  await knex.schema.alterTable('threat_annotations', (t) => {
    t.dropColumn('annotation_type');
    t.dropColumn('source_post_url');
    t.dropColumn('source_author');
  });

  // Mark legacy AI configurations as inactive
  await knex.raw(`
    UPDATE ai_configurations 
    SET is_active = false 
    WHERE provider = 'openai' AND is_active = true
  `);

  // Add new columns to support Grok-specific features
  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.string('monitor_type').defaultTo('legacy'); // legacy, geographical
    t.text('geographical_area').nullable();
  });

  await knex.schema.alterTable('threat_annotations', (t) => {
    t.string('annotation_source').defaultTo('grok'); // grok, legacy
    t.jsonb('area_coordinates').nullable(); // For area annotations
    t.string('area_type').nullable(); // polygon, circle, rectangle
  });

  // Create indexes for new columns
  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.index(['monitor_type']);
  });

  await knex.schema.alterTable('threat_annotations', (t) => {
    t.index(['annotation_source']);
    t.index(['area_type']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // Remove new columns
  await knex.schema.alterTable('threat_annotations', (t) => {
    t.dropColumn('annotation_source');
    t.dropColumn('area_coordinates');
    t.dropColumn('area_type');
  });

  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.dropColumn('monitor_type');
    t.dropColumn('geographical_area');
  });

  // Restore removed columns (with default values)
  await knex.schema.alterTable('threat_annotations', (t) => {
    t.string('annotation_type').defaultTo('threat_poi');
    t.string('source_post_url').nullable();
    t.string('source_author').nullable();
  });

  await knex.schema.alterTable('threat_analyses', (t) => {
    t.jsonb('openai_analysis').nullable();
  });

  await knex.schema.alterTable('social_media_posts', (t) => {
    t.jsonb('author_info').nullable();
    t.jsonb('engagement_metrics').nullable();
    t.jsonb('entities').nullable();
    t.jsonb('raw_data').nullable();
  });

  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.string('api_provider').defaultTo('twitterapi_io');
    t.jsonb('api_credentials').nullable();
    t.string('query_type').defaultTo('Latest');
  });

  // Reactivate legacy AI configurations
  await knex.raw(`
    UPDATE ai_configurations 
    SET is_active = true 
    WHERE provider = 'openai'
  `);
}
