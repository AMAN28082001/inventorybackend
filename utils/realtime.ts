import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';

let io: SocketIOServer | null = null;

const normalizeOrigins = (origins: string[]): Set<string> => {
  return new Set(origins.map((origin) => origin.trim()).filter(Boolean));
};

export const attachRealtimeServer = (app: any, allowedOrigins: string[]): HttpServer => {
  const httpServer = createServer(app);
  const allowed = normalizeOrigins(allowedOrigins);

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowed.has(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true
    }
  });

  io.use((socket, next) => {
    const authToken = socket.handshake.auth?.token;
    const headerToken = socket.handshake.headers.authorization;
    const rawToken = typeof authToken === 'string'
      ? authToken
      : (typeof headerToken === 'string' ? headerToken : '');
    const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7) : rawToken;

    if (!token) {
      socket.data.identity = null;
      next();
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      socket.data.identity = null;
      next();
      return;
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as { id?: string; role?: string };
      if (decoded?.id && decoded?.role) {
        socket.data.identity = { id: decoded.id, role: decoded.role };
      } else {
        socket.data.identity = null;
      }
    } catch {
      socket.data.identity = null;
    }
    next();
  });

  io.on('connection', (socket) => {
    const identity = socket.data.identity as { id: string; role: string } | null;
    if (identity) {
      socket.join(`user:${identity.id}`);
      socket.join(`role:${identity.role}`);
      socket.join('stream:backend');
    }

    socket.on('realtime:subscribe', (roomOrRooms: string | string[]) => {
      const rooms = typeof roomOrRooms === 'string' ? [roomOrRooms] : roomOrRooms;
      if (!Array.isArray(rooms)) return;

      const roomList = rooms.map((room) => (typeof room === 'string' ? room.trim() : '')).filter(Boolean);
      for (const room of roomList) {
        // Protect role/user scoped streams.
        if (room.startsWith('role:')) {
          if (identity && room === `role:${identity.role}`) socket.join(room);
          continue;
        }
        if (room.startsWith('user:')) {
          if (identity && room === `user:${identity.id}`) socket.join(room);
          continue;
        }
        // Generic backend streams require auth.
        if (room.startsWith('stream:') && !identity) continue;
        socket.join(room);
      }
    });

    socket.on('realtime:unsubscribe', (roomOrRooms: string | string[]) => {
      if (typeof roomOrRooms === 'string') {
        socket.leave(roomOrRooms);
        return;
      }
      if (Array.isArray(roomOrRooms)) {
        for (const room of roomOrRooms) {
          if (typeof room === 'string' && room.trim()) {
            socket.leave(room.trim());
          }
        }
      }
    });
  });

  return httpServer;
};

export const emitRealtime = (event: string, payload: unknown, room?: string): void => {
  if (!io) return;
  if (room) {
    io.to(room).emit(event, payload);
    return;
  }
  io.emit(event, payload);
};

export const realtimeEvents = {
  backendMutation: 'backend:mutation',
  dealerDirectoryUpdated: 'dealer:directory-updated',
  callingActionsUpdated: 'calling:actions-updated',
  callingUploadsUpdated: 'calling:uploads-updated'
} as const;
