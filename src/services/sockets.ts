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
      const annotation = await this.sync.handleAnnotationUpdate(user.id, data);
      if (data.teamId) this.io.to(`team:${data.teamId}`).emit('annotation:update', annotation);
    });

    socket.on('message:send', async (data: { teamId?: string; [key: string]: unknown }) => {
      const user = (socket.data as any).user;
      if (!user) return socket.emit('error', { message: 'Not authenticated' });
      const message = await this.sync.handleMessage(user.id, data);
      if (data.teamId) this.io.to(`team:${data.teamId}`).emit('message:received', message);
    });
  }
}


