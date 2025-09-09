import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('annotations', (t) => {
    t.boolean('mesh_origin').defaultTo(false);
    t.string('original_source').nullable();
    t.index(['mesh_origin']);
    t.index(['original_source']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('annotations', (t) => {
    t.dropIndex(['original_source']);
    t.dropIndex(['mesh_origin']);
    t.dropColumn('original_source');
    t.dropColumn('mesh_origin');
  });
}
