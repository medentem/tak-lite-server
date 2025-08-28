import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from './database';

export type AuditEvent = {
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

export class AuditService {
  constructor(private db: DatabaseService) {}

  async log(event: AuditEvent): Promise<void> {
    await this.db.client('audit_logs').insert({
      id: uuidv4(),
      actor_user_id: event.actorUserId || null,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId || null,
      metadata: event.metadata || {},
    });
  }
}


