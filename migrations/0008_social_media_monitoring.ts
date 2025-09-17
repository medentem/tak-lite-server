import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Social media monitoring configurations
  await knex.schema.createTable('social_media_monitors', (t) => {
    t.uuid('id').primary();
    t.uuid('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('platform').defaultTo('twitter');
    t.string('api_provider').defaultTo('twitterapi_io');
    t.jsonb('api_credentials').notNullable(); // Encrypted API key
    t.text('search_query').notNullable(); // Advanced search query
    t.string('query_type').defaultTo('Latest'); // Latest or Top
    t.integer('monitoring_interval').defaultTo(300); // Seconds between checks
    t.boolean('is_active').defaultTo(true);
    t.timestamp('last_checked_at').nullable();
    t.uuid('created_by').references('users.id');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Raw social media posts from twitterapi.io
  await knex.schema.createTable('social_media_posts', (t) => {
    t.uuid('id').primary();
    t.uuid('monitor_id').notNullable().references('social_media_monitors.id').onDelete('CASCADE');
    t.string('platform_post_id').notNullable(); // Original post ID from platform
    t.text('content').notNullable();
    t.jsonb('author_info').notNullable(); // Complete author object from API
    t.jsonb('engagement_metrics').nullable(); // retweetCount, likeCount, etc.
    t.jsonb('entities').nullable(); // hashtags, urls, user_mentions
    t.jsonb('raw_data').nullable(); // Complete API response
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['monitor_id', 'platform_post_id']);
  });

  // AI threat analysis results
  await knex.schema.createTable('threat_analyses', (t) => {
    t.uuid('id').primary();
    t.uuid('post_id').notNullable().references('social_media_posts.id').onDelete('CASCADE');
    t.jsonb('openai_analysis').notNullable(); // Complete OpenAI response
    t.string('threat_level').notNullable(); // LOW, MEDIUM, HIGH, CRITICAL
    t.string('threat_type').nullable(); // VIOLENCE, TERRORISM, NATURAL_DISASTER, etc.
    t.decimal('confidence_score', 3, 2).notNullable(); // 0.00 to 1.00
    t.text('ai_summary').nullable();
    t.jsonb('extracted_locations').nullable();
    t.jsonb('keywords').nullable();
    t.jsonb('processing_metadata').nullable(); // Model version, tokens used, etc.
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // Threat annotations on map
  await knex.schema.createTable('threat_annotations', (t) => {
    t.uuid('id').primary();
    t.uuid('threat_analysis_id').notNullable().references('threat_analyses.id').onDelete('CASCADE');
    t.uuid('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.string('annotation_type').defaultTo('threat_poi');
    t.jsonb('position').notNullable(); // {lat, lng, accuracy}
    t.string('threat_level').notNullable();
    t.string('threat_type').nullable();
    t.string('title').nullable();
    t.text('description').nullable();
    t.string('source_post_url').nullable();
    t.string('source_author').nullable();
    t.boolean('is_verified').defaultTo(false);
    t.uuid('verified_by').nullable().references('users.id');
    t.timestamp('verified_at').nullable();
    t.timestamp('expires_at').nullable(); // Auto-cleanup old threats
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // OpenAI API configuration
  await knex.schema.createTable('ai_configurations', (t) => {
    t.uuid('id').primary();
    t.uuid('team_id').notNullable().references('teams.id').onDelete('CASCADE');
    t.string('provider').defaultTo('openai');
    t.text('api_key_encrypted').notNullable(); // Encrypted OpenAI API key
    t.string('model').defaultTo('gpt-4');
    t.integer('max_tokens').defaultTo(1000);
    t.decimal('temperature', 2, 1).defaultTo(0.3);
    t.boolean('is_active').defaultTo(true);
    t.uuid('created_by').references('users.id');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Add indexes for performance
  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.index(['team_id']);
    t.index(['is_active']);
  });

  await knex.schema.alterTable('social_media_posts', (t) => {
    t.index(['monitor_id']);
    t.index(['created_at']);
  });

  await knex.schema.alterTable('threat_analyses', (t) => {
    t.index(['post_id']);
    t.index(['threat_level']);
    t.index(['created_at']);
  });

  await knex.schema.alterTable('threat_annotations', (t) => {
    t.index(['team_id']);
    t.index(['threat_level']);
    t.index(['is_verified']);
    t.index(['expires_at']);
  });

  await knex.schema.alterTable('ai_configurations', (t) => {
    t.index(['team_id']);
    t.index(['is_active']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('threat_annotations');
  await knex.schema.dropTableIfExists('threat_analyses');
  await knex.schema.dropTableIfExists('social_media_posts');
  await knex.schema.dropTableIfExists('social_media_monitors');
  await knex.schema.dropTableIfExists('ai_configurations');
}
