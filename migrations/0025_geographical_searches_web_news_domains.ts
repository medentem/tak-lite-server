import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('geographical_searches', (t) => {
    t.jsonb('web_news_domains').nullable().comment('Up to 5 domain names for web_search allowed_domains (e.g. bbc.com)');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('geographical_searches', (t) => {
    t.dropColumn('web_news_domains');
  });
}
