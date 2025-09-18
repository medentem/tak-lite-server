import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  console.log('Ensuring all social media tables have correct structure...');
  
  // Check and fix social_media_monitors table
  const hasMonitorsTable = await knex.schema.hasTable('social_media_monitors');
  if (hasMonitorsTable) {
    console.log('Checking social_media_monitors table structure...');
    
    // Check for missing columns and add them
    const columns = await knex('social_media_monitors').columnInfo();
    const expectedColumns = [
      'id', 'team_id', 'name', 'platform', 'api_provider', 'api_credentials',
      'search_query', 'query_type', 'monitoring_interval', 'is_active',
      'last_checked_at', 'created_by', 'created_at', 'updated_at'
    ];
    
    for (const column of expectedColumns) {
      if (!columns[column]) {
        console.log(`Adding missing column: ${column}`);
        
        switch (column) {
          case 'id':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.uuid('id').primary();
            });
            break;
          case 'team_id':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.uuid('team_id').notNullable().references('teams.id').onDelete('CASCADE');
              t.index(['team_id']);
            });
            break;
          case 'name':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.string('name').notNullable();
            });
            break;
          case 'platform':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.string('platform').defaultTo('twitter');
            });
            break;
          case 'api_provider':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.string('api_provider').defaultTo('twitterapi_io');
            });
            break;
          case 'api_credentials':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.jsonb('api_credentials').notNullable();
            });
            break;
          case 'search_query':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.text('search_query').notNullable();
            });
            break;
          case 'query_type':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.string('query_type').defaultTo('Latest');
            });
            break;
          case 'monitoring_interval':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.integer('monitoring_interval').defaultTo(300);
            });
            break;
          case 'is_active':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.boolean('is_active').defaultTo(true);
            });
            break;
          case 'last_checked_at':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.timestamp('last_checked_at').nullable();
            });
            break;
          case 'created_by':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.uuid('created_by').references('users.id');
            });
            break;
          case 'created_at':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.timestamp('created_at').defaultTo(knex.fn.now());
            });
            break;
          case 'updated_at':
            await knex.schema.alterTable('social_media_monitors', (t) => {
              t.timestamp('updated_at').defaultTo(knex.fn.now());
            });
            break;
        }
      }
    }
    
    // Add missing indexes
    try {
      await knex.schema.alterTable('social_media_monitors', (t) => {
        t.index(['is_active']);
      });
    } catch (error) {
      // Index might already exist, ignore error
    }
  }
  
  // Check and create other social media tables if they don't exist
  const tablesToCheck = [
    'social_media_posts',
    'threat_analyses', 
    'threat_annotations',
    'ai_configurations',
    'social_media_service_config'
  ];
  
  for (const tableName of tablesToCheck) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) {
      console.log(`Creating missing table: ${tableName}`);
      
      switch (tableName) {
        case 'social_media_posts':
          await knex.schema.createTable('social_media_posts', (t) => {
            t.uuid('id').primary();
            t.uuid('monitor_id').notNullable().references('social_media_monitors.id').onDelete('CASCADE');
            t.string('platform_post_id').notNullable();
            t.text('content').notNullable();
            t.jsonb('author_info').notNullable();
            t.jsonb('engagement_metrics').nullable();
            t.jsonb('entities').nullable();
            t.jsonb('raw_data').nullable();
            t.timestamp('created_at').defaultTo(knex.fn.now());
            t.unique(['monitor_id', 'platform_post_id']);
            t.index(['monitor_id']);
            t.index(['created_at']);
          });
          break;
          
        case 'threat_analyses':
          await knex.schema.createTable('threat_analyses', (t) => {
            t.uuid('id').primary();
            t.uuid('post_id').notNullable().references('social_media_posts.id').onDelete('CASCADE');
            t.jsonb('openai_analysis').notNullable();
            t.string('threat_level').notNullable();
            t.string('threat_type').nullable();
            t.decimal('confidence_score', 3, 2).notNullable();
            t.text('ai_summary').nullable();
            t.jsonb('extracted_locations').nullable();
            t.jsonb('keywords').nullable();
            t.jsonb('processing_metadata').nullable();
            t.timestamp('created_at').defaultTo(knex.fn.now());
            t.index(['post_id']);
            t.index(['threat_level']);
            t.index(['created_at']);
          });
          break;
          
        case 'threat_annotations':
          await knex.schema.createTable('threat_annotations', (t) => {
            t.uuid('id').primary();
            t.uuid('threat_analysis_id').notNullable().references('threat_analyses.id').onDelete('CASCADE');
            t.uuid('team_id').notNullable().references('teams.id').onDelete('CASCADE');
            t.string('annotation_type').defaultTo('threat_poi');
            t.jsonb('position').notNullable();
            t.string('threat_level').notNullable();
            t.string('threat_type').nullable();
            t.string('title').nullable();
            t.text('description').nullable();
            t.string('source_post_url').nullable();
            t.string('source_author').nullable();
            t.boolean('is_verified').defaultTo(false);
            t.uuid('verified_by').nullable().references('users.id');
            t.timestamp('verified_at').nullable();
            t.timestamp('expires_at').nullable();
            t.timestamp('created_at').defaultTo(knex.fn.now());
            t.timestamp('updated_at').defaultTo(knex.fn.now());
            t.index(['team_id']);
            t.index(['threat_level']);
            t.index(['is_verified']);
            t.index(['expires_at']);
          });
          break;
          
        case 'ai_configurations':
          await knex.schema.createTable('ai_configurations', (t) => {
            t.uuid('id').primary();
            t.uuid('team_id').notNullable().references('teams.id').onDelete('CASCADE');
            t.string('provider').defaultTo('openai');
            t.text('api_key_encrypted').notNullable();
            t.string('model').defaultTo('gpt-4');
            t.integer('max_tokens').defaultTo(1000);
            t.decimal('temperature', 2, 1).defaultTo(0.3);
            t.boolean('is_active').defaultTo(true);
            t.uuid('created_by').references('users.id');
            t.timestamp('created_at').defaultTo(knex.fn.now());
            t.timestamp('updated_at').defaultTo(knex.fn.now());
            t.index(['team_id']);
            t.index(['is_active']);
          });
          break;
          
        case 'social_media_service_config':
          await knex.schema.createTable('social_media_service_config', (t) => {
            t.uuid('id').primary();
            t.boolean('service_enabled').defaultTo(false);
            t.boolean('auto_start_monitors').defaultTo(false);
            t.integer('max_monitors_per_team').defaultTo(5);
            t.integer('default_monitoring_interval').defaultTo(300);
            t.jsonb('service_settings').defaultTo(JSON.stringify({
              max_posts_per_hour: 1000
            }));
            t.timestamp('created_at').defaultTo(knex.fn.now());
            t.timestamp('updated_at').defaultTo(knex.fn.now());
          });
          
          // Insert default configuration
          await knex('social_media_service_config').insert({
            id: knex.raw('gen_random_uuid()'),
            service_enabled: false,
            auto_start_monitors: false,
            max_monitors_per_team: 5,
            default_monitoring_interval: 300,
            service_settings: {
              max_posts_per_hour: 1000
            }
          });
          break;
      }
    }
  }
  
  console.log('Social media tables structure verification complete');
}

export async function down(knex: Knex): Promise<void> {
  // This migration is designed to fix existing tables, so we don't need a down migration
  // The original migrations should handle table creation/destruction
  console.log('No down migration needed for table structure fixes');
}
