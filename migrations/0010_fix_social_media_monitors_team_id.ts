import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Check if the social_media_monitors table exists
  const hasTable = await knex.schema.hasTable('social_media_monitors');
  
  if (hasTable) {
    // Check if team_id column exists
    const hasTeamIdColumn = await knex.schema.hasColumn('social_media_monitors', 'team_id');
    
    if (!hasTeamIdColumn) {
      console.log('Adding missing team_id column to social_media_monitors table...');
      
      // Add the missing team_id column
      await knex.schema.alterTable('social_media_monitors', (t) => {
        t.uuid('team_id').notNullable().references('teams.id').onDelete('CASCADE');
        t.index(['team_id']);
      });
      
      console.log('team_id column added successfully');
    } else {
      console.log('team_id column already exists in social_media_monitors table');
    }
  } else {
    console.log('social_media_monitors table does not exist, skipping fix');
  }
}

export async function down(knex: Knex): Promise<void> {
  // Check if the social_media_monitors table exists
  const hasTable = await knex.schema.hasTable('social_media_monitors');
  
  if (hasTable) {
    // Check if team_id column exists
    const hasTeamIdColumn = await knex.schema.hasColumn('social_media_monitors', 'team_id');
    
    if (hasTeamIdColumn) {
      console.log('Removing team_id column from social_media_monitors table...');
      
      // Remove the team_id column
      await knex.schema.alterTable('social_media_monitors', (t) => {
        t.dropIndex(['team_id']);
        t.dropColumn('team_id');
      });
      
      console.log('team_id column removed successfully');
    }
  }
}
