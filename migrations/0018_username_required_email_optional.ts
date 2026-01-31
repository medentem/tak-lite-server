import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Resolve duplicate names so we can add a unique constraint.
  //    For any user whose name appears more than once, set name = email (unique), so existing
  //    users can continue to log in using their email as username.
  await knex.raw(`
    UPDATE users u
    SET name = u.email
    WHERE u.name IN (
      SELECT name FROM users GROUP BY name HAVING COUNT(*) > 1
    ) AND u.email IS NOT NULL
  `);

  // Handle remaining duplicates (e.g. same name with null email) by appending id prefix
  const duplicateNames = await knex('users')
    .select('name')
    .groupBy('name')
    .havingRaw('COUNT(*) > 1');
  for (const row of duplicateNames) {
    const name = (row as { name: string }).name;
    const users = await knex('users').select('id', 'name').where({ name });
    for (let i = 1; i < users.length; i++) {
      const idPrefix = (users[i] as { id: string }).id.replace(/-/g, '').slice(0, 8);
      const newName = `${name}_${idPrefix}`;
      await knex('users').where({ id: (users[i] as { id: string }).id }).update({ name: newName });
    }
  }

  // 2. Make email optional (nullable)
  await knex.schema.alterTable('users', (t) => {
    t.string('email').nullable().alter();
  });

  // 3. Enforce unique username (name)
  await knex.schema.alterTable('users', (t) => {
    t.unique(['name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropUnique(['name']);
  });
  await knex.schema.alterTable('users', (t) => {
    t.string('email').notNullable().alter();
  });
}
