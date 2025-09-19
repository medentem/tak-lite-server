import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create Grok API configuration table
  await knex.schema.createTable('grok_configurations', (t) => {
    t.uuid('id').primary();
    t.text('api_key_encrypted').notNullable(); // Encrypted Grok API key
    t.string('model').defaultTo('grok-beta');
    t.integer('max_tokens').defaultTo(2000);
    t.decimal('temperature', 2, 1).defaultTo(0.3);
    t.boolean('search_enabled').defaultTo(true);
    t.boolean('is_active').defaultTo(true);
    t.uuid('created_by').references('users.id');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Add Grok-specific columns to threat_analyses table
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.jsonb('grok_analysis').nullable(); // Complete Grok response
    t.text('search_query').nullable(); // Original search query
    t.text('geographical_area').nullable(); // Target geographical area
    t.jsonb('location_confidence').nullable(); // Location accuracy metrics
  });

  // Create threat area annotations table for general area threats
  await knex.schema.createTable('threat_area_annotations', (t) => {
    t.uuid('id').primary();
    t.uuid('threat_analysis_id').notNullable().references('threat_analyses.id').onDelete('CASCADE');
    t.string('area_type').defaultTo('polygon'); // polygon, circle, rectangle
    t.jsonb('coordinates').notNullable(); // GeoJSON format
    t.integer('radius_meters').nullable(); // for circular areas
    t.string('threat_level').notNullable();
    t.string('threat_type').nullable();
    t.string('title').nullable();
    t.text('description').nullable();
    t.boolean('is_verified').defaultTo(false);
    t.uuid('verified_by').nullable().references('users.id');
    t.timestamp('verified_at').nullable();
    t.timestamp('expires_at').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Create geographical search queries table
  await knex.schema.createTable('geographical_searches', (t) => {
    t.uuid('id').primary();
    t.text('geographical_area').notNullable(); // Target area description
    t.text('search_query').nullable(); // Optional specific search terms
    t.jsonb('search_parameters').nullable(); // Additional search filters
    t.integer('monitoring_interval').defaultTo(300); // Seconds between searches
    t.boolean('is_active').defaultTo(true);
    t.timestamp('last_searched_at').nullable();
    t.uuid('created_by').references('users.id');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Add indexes for performance
  await knex.schema.alterTable('grok_configurations', (t) => {
    t.index(['is_active']);
  });

  await knex.schema.alterTable('threat_analyses', (t) => {
    t.index(['geographical_area']);
    t.index(['search_query']);
  });

  await knex.schema.alterTable('threat_area_annotations', (t) => {
    t.index(['threat_level']);
    t.index(['is_verified']);
    t.index(['expires_at']);
    t.index(['area_type']);
  });

  await knex.schema.alterTable('geographical_searches', (t) => {
    t.index(['is_active']);
    t.index(['last_searched_at']);
  });

  // Migrate existing AI configurations to Grok configurations
  await knex.raw(`
    INSERT INTO grok_configurations (
      id, api_key_encrypted, model, max_tokens, temperature, 
      search_enabled, is_active, created_by, created_at, updated_at
    )
    SELECT 
      id, api_key_encrypted, 
      CASE WHEN model = 'gpt-4' THEN 'grok-beta' ELSE 'grok-beta' END,
      max_tokens, temperature, true, is_active, created_by, created_at, updated_at
    FROM ai_configurations
    WHERE is_active = true
  `);

  // Update existing threat analyses to mark them as legacy
  await knex.raw(`
    UPDATE threat_analyses 
    SET geographical_area = 'Legacy Analysis'
    WHERE geographical_area IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop new tables
  await knex.schema.dropTableIfExists('geographical_searches');
  await knex.schema.dropTableIfExists('threat_area_annotations');
  
  // Remove added columns from threat_analyses
  await knex.schema.alterTable('threat_analyses', (t) => {
    t.dropColumn('grok_analysis');
    t.dropColumn('search_query');
    t.dropColumn('geographical_area');
    t.dropColumn('location_confidence');
  });
  
  // Drop grok_configurations table
  await knex.schema.dropTableIfExists('grok_configurations');
}
