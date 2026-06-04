const { Server } = require('socket.io');
const { getClientUrl } = require('../utils/env');

let io = null;

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
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on('leave:user', (userId) => {
      if (userId) socket.leave(`user:${userId}`);
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
};
