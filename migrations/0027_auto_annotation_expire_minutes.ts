import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('social_media_service_config', (t) => {
    t.integer('auto_annotation_expire_minutes').defaultTo(120);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('social_media_service_config', (t) => {
    t.dropColumn('auto_annotation_expire_minutes');
  });
}
