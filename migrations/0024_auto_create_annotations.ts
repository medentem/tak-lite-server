import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('social_media_service_config', (t) => {
    t.boolean('auto_create_annotations').defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('social_media_service_config', (t) => {
    t.dropColumn('auto_create_annotations');
  });
}
