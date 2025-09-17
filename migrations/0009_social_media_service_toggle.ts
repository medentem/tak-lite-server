import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add service-level configuration table
  await knex.schema.createTable('social_media_service_config', (t) => {
    t.uuid('id').primary();
    t.boolean('service_enabled').defaultTo(false); // Global service toggle
    t.boolean('auto_start_monitors').defaultTo(false); // Auto-start monitors when service is enabled
    t.integer('max_monitors_per_team').defaultTo(5); // Limit monitors per team
    t.integer('default_monitoring_interval').defaultTo(300); // Default interval in seconds
    t.jsonb('service_settings').nullable(); // Additional service settings
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Insert default service configuration
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

  // Add service status tracking to monitors
  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.boolean('service_enabled').defaultTo(true); // Individual monitor toggle
    t.timestamp('last_cost_check').nullable(); // Track API usage costs
    t.integer('posts_processed_today').defaultTo(0); // Daily usage tracking
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('social_media_monitors', (t) => {
    t.dropColumn('service_enabled');
    t.dropColumn('last_cost_check');
    t.dropColumn('posts_processed_today');
  });
  
  await knex.schema.dropTableIfExists('social_media_service_config');
}
