import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ConfigService } from './config';
import { SyncService } from './sync';

export class SocketGateway {
  constructor(private io: Server, private config: ConfigService, private sync: SyncService) {}

  bind() {
    this.io.on('connection', (socket: Socket) => this.onConnection(socket));
  }

  private async onConnection(socket: Socket) {
    socket.emit('hello');
    socket.on('authenticate', async (token: string) => {
      try {
        const secret = (await this.config.get<string>('security.jwt_secret')) || '';
        const payload = jwt.verify(token, secret) as { sub: string; is_admin?: boolean };
        (socket.data as any).user = { id: payload.sub };
        socket.emit('authenticated', { success: true });
      } catch {
        socket.emit('authenticated', { success: false, error: 'Invalid token' });
      }
    });

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


