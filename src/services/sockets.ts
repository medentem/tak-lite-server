import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ConfigService } from './config';
import { SecurityService } from './security';
import { SyncService } from './sync';

export class SocketGateway {
  private security: SecurityService;
  constructor(private io: Server, private config: ConfigService, private sync: SyncService) {
    this.security = new SecurityService(config);
  }

  bind() {
    // Start periodic admin stats updates
    this.startPeriodicStatsUpdates();
    
    // Require authentication during connection via auth token in query or headers
    this.io.use(async (socket, next) => {
      try {
        console.log('[SOCKET] Authentication attempt:', {
          auth: socket.handshake.auth,
          headers: socket.handshake.headers,
          query: socket.handshake.query
        });
        
        const token = (socket.handshake.auth?.token as string) || (socket.handshake.headers['authorization']?.toString().split(' ')[1] || '');
        if (!token) {
          console.log('[SOCKET] Missing token');
          return next(new Error('Missing token'));
        }
        
        console.log('[SOCKET] Token found, verifying...');
        const payload = await this.security.verifyJwt<{ sub: string; is_admin?: boolean }>(token);
        (socket.data as any).user = { id: payload.sub, is_admin: !!payload.is_admin };
        console.log('[SOCKET] Authentication successful for user:', payload.sub);
        next();
      } catch (e) {
        console.error('[SOCKET] Authentication failed:', e);
        next(new Error('Invalid token'));
      }
    });
    this.io.on('connection', (socket: Socket) => this.onConnection(socket));
  }

  private async onConnection(socket: Socket) {
    console.log('[SOCKET] Client connected:', socket.id);
    socket.emit('hello');
    
    // Emit admin stats update for admin users
    const user = (socket.data as any).user;
    if (user?.is_admin) {
      this.emitAdminStatsUpdate();
    }

    socket.on('team:join', async (teamId: string) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      try {
        await this.sync.assertTeamMembership(user.id, teamId);
        await socket.join(`team:${teamId}`);
        socket.emit('team:joined', { teamId });
      } catch (err: any) {
        socket.emit('error', { message: err.message || 'Join failed' });
      }
    });

    socket.on('team:leave', async (teamId: string) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      await socket.leave(`team:${teamId}`);
      socket.emit('team:left', { teamId });
    });

    socket.on('location:update', async (data: { teamId?: string; [key: string]: unknown }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      await this.sync.handleLocationUpdate(user.id, data);
      if (data.teamId) this.io.to(`team:${data.teamId}`).emit('location:update', { userId: user.id, ...data });
    });

    socket.on('annotation:update', async (data: { teamId?: string; [key: string]: unknown }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      
      try {
        const annotation = await this.sync.handleAnnotationUpdate(user.id, data);
        if (data.teamId) this.io.to(`team:${data.teamId}`).emit('annotation:update', annotation);
      } catch (error: any) {
        console.error('[SOCKET] Annotation update error:', error);
        socket.emit('error', { 
          message: error.message || 'Failed to process annotation update',
          code: 'ANNOTATION_UPDATE_ERROR'
        });
      }
    });

    socket.on('annotation:delete', async (data: { teamId?: string; annotationId: string }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      
      try {
        await this.sync.handleAnnotationDelete(user.id, data);
        if (data.teamId) this.io.to(`team:${data.teamId}`).emit('annotation:delete', { annotationId: data.annotationId });
      } catch (error: any) {
        console.error('[SOCKET] Annotation delete error:', error);
        socket.emit('error', { 
          message: error.message || 'Failed to process annotation deletion',
          code: 'ANNOTATION_DELETE_ERROR'
        });
      }
    });

    socket.on('annotation:bulk_delete', async (data: { teamId?: string; annotationIds: string[] }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      
      try {
        const result = await this.sync.handleBulkAnnotationDelete(user.id, data);
        
        if (data.teamId) {
          this.io.to(`team:${data.teamId}`).emit('annotation:bulk_delete', { 
            annotationIds: data.annotationIds 
          });
        }
        
        socket.emit('annotation:bulk_delete_result', result);
      } catch (error: any) {
        console.error('[SOCKET] Bulk annotation delete error:', error);
        socket.emit('error', { 
          message: error.message || 'Failed to process bulk annotation deletion',
          code: 'BULK_ANNOTATION_DELETE_ERROR'
        });
      }
    });

    socket.on('message:send', async (data: { teamId?: string; [key: string]: unknown }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      const message = await this.sync.handleMessage(user.id, data);
      if (data.teamId) this.io.to(`team:${data.teamId}`).emit('message:received', message);
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('[SOCKET] Client disconnected:', socket.id);
      this.emitAdminConnectionUpdate('disconnect', socket.id);
    });
  }
  
  // Emit admin stats update to all admin users
  private async emitAdminStatsUpdate() {
    try {
      const stats = await this.getAdminStats();
      this.io.emit('admin:stats_update', stats);
    } catch (error) {
      console.error('[SOCKET] Failed to emit admin stats update:', error);
    }
  }
  
  // Emit admin connection update
  private emitAdminConnectionUpdate(type: string, socketId: string) {
    const rooms = Object.fromEntries(
      Array.from(this.io.sockets.adapter.rooms.entries())
        .filter(([name]) => name.startsWith('team:'))
        .map(([name, set]) => [name, set.size])
    );
    
    this.io.emit('admin:connection_update', {
      type,
      socketId,
      rooms,
      totalConnections: this.io.engine.clientsCount,
      authenticatedConnections: Array.from(this.io.sockets.sockets.values()).filter((s) => (s.data as any)?.user).length
    });
  }
  
  // Get admin statistics
  private async getAdminStats() {
    try {
      const [users, teams, annotations, messages, locations] = await Promise.all([
        this.sync.database.client('users').count<{ count: string }>('id as count').first(),
        this.sync.database.client('teams').count<{ count: string }>('id as count').first(),
        this.sync.database.client('annotations').count<{ count: string }>('id as count').first(),
        this.sync.database.client('messages').count<{ count: string }>('id as count').first(),
        this.sync.database.client('locations').count<{ count: string }>('id as count').first()
      ]);

      const socketsTotal = this.io.engine.clientsCount;
      const socketsAuth = Array.from(this.io.sockets.sockets.values()).filter((s) => (s.data as any)?.user).length;
      const rooms = Object.fromEntries(
        Array.from(this.io.sockets.adapter.rooms.entries())
          .filter(([name]) => name.startsWith('team:'))
          .map(([name, set]) => [name, set.size])
      );

      return {
        db: {
          users: users ? Number(users.count) : 0,
          teams: teams ? Number(teams.count) : 0,
          annotations: annotations ? Number(annotations.count) : 0,
          messages: messages ? Number(messages.count) : 0,
          locations: locations ? Number(locations.count) : 0
        },
        sockets: {
          totalConnections: socketsTotal,
          authenticatedConnections: socketsAuth,
          rooms
        }
      };
    } catch (error) {
      console.error('[SOCKET] Failed to get admin stats:', error);
      return null;
    }
  }
  
  // Emit sync activity to admin users
  public emitSyncActivity(type: string, details: string) {
    this.io.emit('admin:sync_activity', { type, details });
  }
  
  // Start periodic stats updates for admin users
  private startPeriodicStatsUpdates() {
    setInterval(async () => {
      try {
        // Check if there are any admin users connected
        const adminSockets = Array.from(this.io.sockets.sockets.values())
          .filter((s) => (s.data as any)?.user?.is_admin);
        
        if (adminSockets.length > 0) {
          await this.emitAdminStatsUpdate();
        }
      } catch (error) {
        console.error('[SOCKET] Periodic stats update failed:', error);
      }
    }, 10000); // Update every 10 seconds
  }
}


