const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// Store connected users
const users = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register', (userId) => {
    users.set(userId, socket.id);
    io.emit('users-update', Array.from(users.keys()));
  });

  socket.on('disconnect', () => {
    for (const [userId, socketId] of users.entries()) {
      if (socketId === socket.id) {
        users.delete(userId);
        break;
      }
    }
    io.emit('users-update', Array.from(users.keys()));
  });

  // WebRTC Signaling
  socket.on('call-user', ({ targetUserId, offer, callerUserId }) => {
    const targetSocketId = users.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', {
        offer,
        callerUserId
      });
    }
  });

  socket.on('call-accepted', ({ targetUserId, answer }) => {
    const targetSocketId = users.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-accepted', { answer });
    }
  });

  socket.on('ice-candidate', ({ targetUserId, candidate }) => {
    const targetSocketId = users.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { candidate });
    }
  });

  socket.on('end-call', ({ targetUserId }) => {
    const targetSocketId = users.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-ended');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});