import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ConfigService } from './config';
import { SecurityService } from './security';
import { SyncService } from './sync';

export class SocketGateway {
  private security: SecurityService;
  private connectionCleanupInterval: NodeJS.Timeout;
  
  constructor(private io: Server, private config: ConfigService, private sync: SyncService) {
    this.security = new SecurityService(config);
    
    // Start periodic connection cleanup to prevent memory leaks
    this.connectionCleanupInterval = setInterval(() => {
      this.cleanupStaleConnections();
    }, 30000); // Clean up every 30 seconds
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
    
    // Emit admin connection update for all connections
    this.emitAdminConnectionUpdate('connect', socket.id);

    socket.on('team:join', async (teamId: string) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      try {
        console.log(`[SOCKET] User ${user.id} attempting to join team: ${teamId}`);
        await this.sync.assertTeamMembership(user.id, teamId);
        
        // Join both the specific team room and the global room
        await socket.join(`team:${teamId}`);
        await socket.join('global'); // Global room for null team_id data
        
        console.log(`[SOCKET] User ${user.id} successfully joined team: ${teamId} and global room`);
        socket.emit('team:joined', { teamId });
        
        // Store the team ID in socket data for reference
        (socket.data as any).teamId = teamId;
        
        // Emit admin connection update to show the new team room
        this.emitAdminConnectionUpdate('team_join', socket.id);
      } catch (err: any) {
        console.error(`[SOCKET] Failed to join team ${teamId}:`, err);
        socket.emit('error', { message: err.message || 'Join failed' });
      }
    });

    socket.on('team:leave', async (teamId: string) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      console.log(`[SOCKET] User ${user.id} leaving team: ${teamId}`);
      
      // Leave the specific team room but stay in global room
      await socket.leave(`team:${teamId}`);
      
      // Clear the team ID from socket data
      (socket.data as any).teamId = null;
      
      socket.emit('team:left', { teamId });
      
      // Emit admin connection update to show the team room change
      this.emitAdminConnectionUpdate('team_leave', socket.id);
    });

    socket.on('location:update', async (data: { teamId?: string; [key: string]: unknown }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      await this.sync.handleLocationUpdate(user.id, data);
      
      // Broadcast to appropriate rooms based on team filtering logic
      if (data.teamId) {
        // Broadcast to specific team room
        this.io.to(`team:${data.teamId}`).emit('location:update', { userId: user.id, ...data });
      } else {
        // Broadcast to global room for null team_id data
        this.io.to('global').emit('location:update', { userId: user.id, ...data });
      }
      
      // Emit admin event for real-time map updates
      this.emitAdminLocationUpdate(user.id, data);
    });

    socket.on('annotation:update', async (data: { teamId?: string; [key: string]: unknown }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      
      try {
        const annotation = await this.sync.handleAnnotationUpdate(user.id, data);
        
        // Broadcast to appropriate rooms based on team filtering logic
        if (data.teamId) {
          // Broadcast to specific team room
          this.io.to(`team:${data.teamId}`).emit('annotation:update', annotation);
        } else {
          // Broadcast to global room for null team_id data
          this.io.to('global').emit('annotation:update', annotation);
        }
        
        // Emit admin event for real-time map updates
        this.emitAdminAnnotationUpdate(user.id, annotation);
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
        const result = await this.sync.handleAnnotationDelete(user.id, data);
        
        // Broadcast to appropriate rooms based on team filtering logic
        if (data.teamId) {
          // Broadcast to specific team room
          this.io.to(`team:${data.teamId}`).emit('annotation:delete', { annotationId: data.annotationId });
        } else {
          // Broadcast to global room for null team_id data
          this.io.to('global').emit('annotation:delete', { annotationId: data.annotationId });
        }
        
        // Emit admin event for real-time map updates
        this.emitAdminAnnotationDelete(user.id, { annotationId: data.annotationId, teamId: data.teamId });
      } catch (error: any) {
        console.error('[SOCKET] Annotation delete error:', error);
        socket.emit('error', { 
          message: error.message || 'Failed to process annotation deletion',
          code: 'ANNOTATION_DELETE_ERROR'
        });
      }
    });

    socket.on('annotation:bulk_delete', async (data: { teamId?: string; annotationIds: string[] }) => {
      console.log('[SOCKET] Received bulk annotation delete request:', { 
        userId: (socket.data as any).user?.id, 
        teamId: data.teamId, 
        annotationCount: data.annotationIds?.length,
        annotationIds: data.annotationIds 
      });
      
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      
      try {
        const result = await this.sync.handleBulkAnnotationDelete(user.id, data);
        console.log('[SOCKET] Bulk annotation delete result:', result);
        
        // Broadcast to appropriate rooms based on team filtering logic
        if (data.teamId) {
          // Broadcast to specific team room
          this.io.to(`team:${data.teamId}`).emit('annotation:bulk_delete', { 
            annotationIds: data.annotationIds 
          });
          console.log('[SOCKET] Broadcasted bulk delete to team:', data.teamId);
        } else {
          // Broadcast to global room for null team_id data
          this.io.to('global').emit('annotation:bulk_delete', { 
            annotationIds: data.annotationIds 
          });
          console.log('[SOCKET] Broadcasted bulk delete to global room');
        }
        
        // Emit admin event for real-time map updates
        this.emitAdminBulkAnnotationDelete(user.id, { annotationIds: data.annotationIds, teamId: data.teamId });
        
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
      
      // Broadcast to appropriate rooms based on team filtering logic
      if (data.teamId) {
        // Broadcast to specific team room
        this.io.to(`team:${data.teamId}`).emit('message:received', message);
      } else {
        // Broadcast to global room for null team_id data
        this.io.to('global').emit('message:received', message);
      }
      
      // Emit admin event for real-time message monitoring
      this.emitAdminMessageReceived(user.id, message);
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log('[SOCKET] Client disconnected:', socket.id, 'reason:', reason);
      
      // Clean up socket data to prevent memory leaks
      if (socket.data) {
        socket.data = {};
      }
      
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
    
    // Get all rooms (including individual socket rooms) for debugging
    const allRooms = Object.fromEntries(
      Array.from(this.io.sockets.adapter.rooms.entries())
        .map(([name, set]) => [name, set.size])
    );
    
    this.io.emit('admin:connection_update', {
      type,
      socketId,
      rooms,
      allRooms, // Add all rooms for debugging
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
  
  // Emit location update to admin users
  public emitAdminLocationUpdate(userId: string, locationData: any) {
    // Get user information for the admin event
    this.getUserInfo(userId).then(userInfo => {
      if (userInfo) {
        const adminEventData = {
          userId: userId,
          user_name: userInfo.name,
          user_email: userInfo.email,
          teamId: locationData.teamId,
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          altitude: locationData.altitude,
          accuracy: locationData.accuracy,
          timestamp: locationData.timestamp,
          user_status: locationData.userStatus || 'GREEN'
        };
        this.io.emit('admin:location_update', adminEventData);
      }
    }).catch(error => {
      console.error('[SOCKET] Failed to get user info for admin location update:', error);
      // Emit with minimal data if user lookup fails
      this.io.emit('admin:location_update', {
        userId: userId,
        teamId: locationData.teamId,
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        altitude: locationData.altitude,
        accuracy: locationData.accuracy,
        timestamp: locationData.timestamp,
        user_status: locationData.userStatus || 'GREEN'
      });
    });
  }
  
  // Emit annotation update to admin users
  public emitAdminAnnotationUpdate(userId: string, annotation: any) {
    // Get user information for the admin event
    this.getUserInfo(userId).then(userInfo => {
      if (userInfo) {
        const adminEventData = {
          ...annotation,
          user_name: userInfo.name,
          user_email: userInfo.email
        };
        this.io.emit('admin:annotation_update', adminEventData);
      }
    }).catch(error => {
      console.error('[SOCKET] Failed to get user info for admin annotation update:', error);
      // Emit with minimal data if user lookup fails
      this.io.emit('admin:annotation_update', annotation);
    });
  }

  // Emit annotation deletion to admin users
  public emitAdminAnnotationDelete(userId: string, deletionData: any) {
    // Get user information for the admin event
    this.getUserInfo(userId).then(userInfo => {
      if (userInfo) {
        const adminEventData = {
          ...deletionData,
          user_name: userInfo.name,
          user_email: userInfo.email
        };
        this.io.emit('admin:annotation_delete', adminEventData);
      }
    }).catch(error => {
      console.error('[SOCKET] Failed to get user info for admin annotation delete:', error);
      // Emit with minimal data if user lookup fails
      this.io.emit('admin:annotation_delete', deletionData);
    });
  }

  // Emit bulk annotation deletion to admin users
  public emitAdminBulkAnnotationDelete(userId: string, deletionData: any) {
    // Get user information for the admin event
    this.getUserInfo(userId).then(userInfo => {
      if (userInfo) {
        const adminEventData = {
          ...deletionData,
          user_name: userInfo.name,
          user_email: userInfo.email
        };
        this.io.emit('admin:annotation_bulk_delete', adminEventData);
      }
    }).catch(error => {
      console.error('[SOCKET] Failed to get user info for admin bulk annotation delete:', error);
      // Emit with minimal data if user lookup fails
      this.io.emit('admin:annotation_bulk_delete', deletionData);
    });
  }

  // Emit message received to admin users
  public emitAdminMessageReceived(userId: string, messageData: any) {
    // Get user information for the admin event
    this.getUserInfo(userId).then(userInfo => {
      if (userInfo) {
        const adminEventData = {
          ...messageData,
          user_name: userInfo.name,
          user_email: userInfo.email
        };
        this.io.emit('admin:message_received', adminEventData);
      }
    }).catch(error => {
      console.error('[SOCKET] Failed to get user info for admin message received:', error);
      // Emit with minimal data if user lookup fails
      this.io.emit('admin:message_received', messageData);
    });
  }
  
  // Helper method to get user information
  private async getUserInfo(userId: string): Promise<{ name: string; email: string } | null> {
    try {
      const user = await this.sync.database.client('users').where('id', userId).select(['name', 'email']).first();
      return user || null;
    } catch (error) {
      console.error('[SOCKET] Failed to get user info:', error);
      return null;
    }
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

  // Clean up stale connections to prevent memory leaks
  private cleanupStaleConnections() {
    const sockets = Array.from(this.io.sockets.sockets.values());
    const now = Date.now();
    let cleanedCount = 0;
    
    sockets.forEach(socket => {
      // Check if socket has been idle for too long (5 minutes)
      const lastActivity = (socket as any).lastActivity || now;
      const idleTime = now - lastActivity;
      
      if (idleTime > 300000) { // 5 minutes
        console.log(`[SOCKET] Cleaning up stale connection: ${socket.id} (idle for ${Math.round(idleTime / 1000)}s)`);
        socket.disconnect(true);
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`[SOCKET] Cleaned up ${cleanedCount} stale connections`);
    }
  }

  // Emit threat alert to team members and global room
  public emitThreatAlert(teamId: string, threatData: any) {
    console.log('[SOCKET] Emitting threat alert:', { teamId, threatData });
    
    // Broadcast to specific team room
    this.io.to(`team:${teamId}`).emit('threat:new', {
      ...threatData,
      timestamp: new Date().toISOString()
    });
    
    // Also broadcast to global room for cross-team threat awareness
    this.io.to('global').emit('threat:new', {
      ...threatData,
      timestamp: new Date().toISOString()
    });
  }

  // Cleanup method to stop intervals
  public cleanup() {
    if (this.connectionCleanupInterval) {
      clearInterval(this.connectionCleanupInterval);
    }
  }
}


