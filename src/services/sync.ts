import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';
import { DatabaseService } from './database';

export class SyncService {
  constructor(private io: Server, private db: DatabaseService) {}
  
  // Expose database client for admin stats
  public get database() {
    return this.db;
  }
  
  // Emit sync activity to admin users
  private emitSyncActivity(type: string, details: string) {
    // Access the socket gateway through the io instance
    const socketGateway = (this.io as any).socketGateway;
    if (socketGateway && typeof socketGateway.emitSyncActivity === 'function') {
      socketGateway.emitSyncActivity(type, details);
    }
  }

  async authenticateSocket(_token: string): Promise<{ id: string; teamId: string } | null> {
    // Placeholder: rely on REST login + token in app; full socket auth later
    return null;
  }

  public async assertTeamMembership(userId: string, teamId: string): Promise<void> {
    const membership = await this.db
      .client('team_memberships')
      .where({ user_id: userId, team_id: teamId })
      .first();
    if (!membership) {
      const error: any = new Error('Forbidden: user is not a member of the team');
      error.status = 403;
      throw error;
    }
  }

  async handleLocationUpdate(userId: string, payload: any): Promise<void> {
    const now = Date.now();
    const schema = Joi.object({
      teamId: Joi.string().uuid().required(),
      latitude: Joi.number().min(-90).max(90).precision(7).required(),
      longitude: Joi.number().min(-180).max(180).precision(7).required(),
      altitude: Joi.number().min(-500).max(15000).optional(),
      accuracy: Joi.number().min(0).max(10000).optional(),
      timestamp: Joi.number().integer().min(now - 1000 * 60 * 60 * 24 * 7).max(now + 1000 * 60 * 5).required()
    });
    const data = await schema.validateAsync(payload, { abortEarly: false, stripUnknown: true });
    await this.assertTeamMembership(userId, data.teamId);
    await this.db.client('locations').insert({ id: uuidv4(), user_id: userId, team_id: data.teamId, latitude: data.latitude, longitude: data.longitude, altitude: data.altitude, accuracy: data.accuracy, timestamp: data.timestamp });
    
    this.emitSyncActivity('location_update', `User ${userId} updated location in team ${data.teamId}`);
  }

  async handleAnnotationUpdate(userId: string, payload: any) {
    const schema = Joi.object({
      teamId: Joi.string().uuid().required(),
      annotationId: Joi.string().uuid().optional(),
      type: Joi.string().max(64).required(),
      data: Joi.object().max(50_000).required() // ~50KB max serialized
    });
    const { teamId, annotationId, type, data } = await schema.validateAsync(payload, { abortEarly: false, stripUnknown: true });
    await this.assertTeamMembership(userId, teamId);
    const id = annotationId || uuidv4();
    const row = { id, user_id: userId, team_id: teamId, type, data };
    await this.db.client('annotations').insert(row).onConflict('id').merge({ data, type, updated_at: this.db.client.fn.now() });
    
    this.emitSyncActivity('annotation_update', `User ${userId} ${annotationId ? 'updated' : 'created'} annotation ${id} in team ${teamId}`);
    return row;
  }

  async handleMessage(userId: string, payload: any) {
    const schema = Joi.object({
      teamId: Joi.string().uuid().required(),
      messageType: Joi.string().valid('text').default('text'),
      content: Joi.string().min(1).max(2000).required()
    });
    const { teamId, messageType, content } = await schema.validateAsync(payload, { abortEarly: false, stripUnknown: true });
    await this.assertTeamMembership(userId, teamId);
    const row = { id: uuidv4(), user_id: userId, team_id: teamId, message_type: messageType, content };
    await this.db.client('messages').insert(row);
    
    this.emitSyncActivity('message_send', `User ${userId} sent message in team ${teamId}`);
    return row;
  }
}


