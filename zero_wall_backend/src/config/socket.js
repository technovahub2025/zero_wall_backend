const { Server } = require('socket.io');
const { getClientUrl } = require('../utils/env');

let io = null;
const presenceByUserId = new Map();

function nowIso() {
  return new Date().toISOString();
}

function getPresenceSnapshot() {
  return [...presenceByUserId.entries()].map(([userId, record]) => ({
    userId,
    connectedAt: record.connectedAt,
    socketCount: record.socketCount,
  }));
}

function markUserOnline(userId) {
  if (!userId) return null;
  const key = String(userId);
  const existing = presenceByUserId.get(key) || { connectedAt: nowIso(), socketCount: 0 };
  existing.socketCount += 1;
  if (existing.socketCount === 1) {
    existing.connectedAt = nowIso();
  }
  presenceByUserId.set(key, existing);
  return { userId: key, connectedAt: existing.connectedAt, socketCount: existing.socketCount };
}

function markUserOffline(userId) {
  if (!userId) return null;
  const key = String(userId);
  const existing = presenceByUserId.get(key);
  if (!existing) return null;

  existing.socketCount = Math.max(0, existing.socketCount - 1);
  if (existing.socketCount <= 0) {
    presenceByUserId.delete(key);
    return { userId: key, connectedAt: existing.connectedAt, socketCount: 0 };
  }

  presenceByUserId.set(key, existing);
  return { userId: key, connectedAt: existing.connectedAt, socketCount: existing.socketCount };
}

function initSocket(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    cors: {
      origin: getClientUrl(),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    socket.emit('connected', {
      message: 'Socket.io connected',
      socketId: socket.id,
    });

    socket.on('join:user', (userId) => {
      if (!userId) return;
      const key = String(userId);
      if (socket.data.joinedUserId === key) return;
      socket.join(`user:${key}`);
      socket.data.joinedUserId = key;
      const presence = markUserOnline(userId);
      if (presence) {
        emitToAdmin('monitor:presence:changed', presence);
      }
    });

    socket.on('leave:user', (userId) => {
      if (!userId) return;
      const key = String(userId);
      if (socket.data.joinedUserId !== key) return;
      socket.leave(`user:${key}`);
      socket.data.joinedUserId = null;
      const presence = markUserOffline(key);
      if (presence) {
        emitToAdmin('monitor:presence:changed', presence);
      }
    });

    socket.on('join:project', (projectId) => {
      if (projectId) socket.join(`project:${projectId}`);
    });

    socket.on('leave:project', (projectId) => {
      if (projectId) socket.leave(`project:${projectId}`);
    });

    socket.on('join:admin', () => {
      socket.join('admin');
    });

    socket.on('disconnect', () => {
      const joinedUserId = socket.data.joinedUserId;
      if (!joinedUserId) return;
      socket.data.joinedUserId = null;
      const presence = markUserOffline(joinedUserId);
      if (presence) {
        emitToAdmin('monitor:presence:changed', presence);
      }
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}

function emitToUser(userId, event, data) {
  if (!userId) return;
  getIO().to(`user:${userId}`).emit(event, data);
}

function emitToProject(projectId, event, data) {
  if (!projectId) return;
  getIO().to(`project:${projectId}`).emit(event, data);
}

function emitToAdmin(event, data) {
  getIO().to('admin').emit(event, data);
}

function emitToAll(event, data) {
  getIO().emit(event, data);
}

module.exports = {
  initSocket,
  getIO,
  emitToUser,
  emitToProject,
  emitToAdmin,
  emitToAll,
  getPresenceSnapshot,
};
