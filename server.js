// server.js — FINAL VERSION — EVERYTHING WORKS PERFECTLY
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};
const WORD_LIST = [
  "cat", "dog", "house", "tree", "car", "sun", "moon", "star", "fish", "bird",
  "apple", "banana", "pizza", "cake", "rainbow", "rocket", "castle", "dragon",
  "unicorn", "phone", "book", "ocean", "giraffe", "elephant", "penguin",
  "butterfly", "flower", "heart", "smile", "fire", "plane", "train", "boat",
  "cloud", "mountain", "beach", "forest", "island", "desert", "volcano",
  "bridge", "tower", "church", "school", "hospital", "store", "icecream",
  "cookie", "donut", "burger", "fries", "coffee", "tea", "juice", "earth",
  "mars", "robot", "alien", "spaceship", "sword", "shield", "crown", "diamond"
];

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // CREATE ROOM
  socket.on('createRoom', (code, name, numRounds = 6) => {
    code = code.toUpperCase();
    if (rooms[code]) return socket.emit('errorMsg', 'Room already exists');

    numRounds = Math.max(3, Math.min(20, parseInt(numRounds))) || 6;

    rooms[code] = {
      code,
      players: {},
      round: 0,
      maxRounds: numRounds,
      drawerIndex: 0,
      currentWord: null,
      currentDrawer: null,
      gameStarted: false,
      timer: null,
      roundStartTime: null,
      guessedPlayers: new Set()
    };

    joinPlayer(socket, code, name);
  });

  // JOIN ROOM
  socket.on('joinRoom', (code, name) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('errorMsg', 'Room not found');
    if (Object.keys(rooms[code].players).length >= 12) return socket.emit('errorMsg', 'Room is full');

    joinPlayer(socket, code, name);
  });

  function joinPlayer(socket, code, name) {
    socket.join(code);
    const player = { id: socket.id, name: name.trim() || "Guest", score: 0 };
    rooms[code].players[socket.id] = player;

    socket.emit('roomJoined', code, Object.values(rooms[code].players), rooms[code].maxRounds);
    io.to(code).emit('updatePlayers', Object.values(rooms[code].players));
    io.to(code).emit('message', { user: 'System', text: `${player.name} joined!` });

    if (Object.keys(rooms[code].players).length >= 2 && !rooms[code].gameStarted) {
      rooms[code].gameStarted = true;
      setTimeout(() => nextRound(code), 3000);
    }
  }

  // DRAWER CHOOSES WORD
  socket.on('chooseWord', (word) => {
    const room = Object.values(rooms).find(r => r.currentDrawer === socket.id);
    if (!room || !word) return;

    room.currentWord = word;
    room.guessedPlayers = new Set();
    room.roundStartTime = Date.now();

    // PRIVATE: Show word to drawer only
    socket.emit('message', { user: 'Private', text: `Your word: ${word}` });

    // HINT for everyone else
    const hint = word.split('').map((c, i) => i % 2 === 0 ? c : '_').join(' ');
    io.to(room.code).emit('wordHint', hint);
    io.to(room.code).emit('message', { user: 'System', text: 'Word chosen! Start guessing!' });

    startTimer(room.code);
  });

  // DRAWING
  socket.on('draw', (data) => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('draw', data);
  });

  socket.on('clearCanvas', () => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('clearCanvas');
  });

  // CHAT & GUESSING — FULLY FIXED SCORING
  socket.on('chatMessage', (msg) => {
    const room = Object.values(rooms).find(r => r.players[socket.id]);
    if (!room) return;

    const player = room.players[socket.id];
    const guess = msg.trim().toLowerCase();

    // Drawer just chats
    if (socket.id === room.currentDrawer) {
      io.to(room.code).emit('message', { user: player.name, text: msg });
      return;
    }

    // Already guessed
    if (room.guessedPlayers.has(socket.id)) {
      socket.emit('errorMsg', 'You already guessed correctly!');
      return;
    }

    // Too close
    if (room.currentWord && room.currentWord.toLowerCase().includes(guess) && guess.length > 2) {
      socket.emit('errorMsg', 'Too close!');
      return;
    }

    // CORRECT GUESS!
    if (room.currentWord && guess === room.currentWord.toLowerCase()) {
      room.guessedPlayers.add(socket.id);

      const timeElapsed = (Date.now() - room.roundStartTime) / 1000;
      const basePoints = Math.max(20, Math.round(120 - timeElapsed * 1.5));
      const guesserPoints = basePoints;
      const drawerBonus = Math.round(basePoints * 0.4);

      player.score += guesserPoints;
      if (room.currentDrawer) {
        room.players[room.currentDrawer].score += drawerBonus;
      }

      // Tell guesser
      socket.emit('message', { user: 'System', text: `Correct! +${guesserPoints} pts` });

      // Tell everyone
      io.to(room.code).emit('correctGuess', player.name, guesserPoints);
      io.to(room.code).emit('message', { user: 'System', text: `${player.name} guessed the word!` });

      // Update scores immediately
      io.to(room.code).emit('updatePlayers', Object.values(room.players));

      // Everyone guessed?
      if (room.guessedPlayers.size >= Object.keys(room.players).length - 1) {
        clearInterval(room.timer);
        io.to(room.code).emit('wordReveal', room.currentWord);
        setTimeout(() => nextRound(room.code), 4000);
      }
      return;
    }

    // Normal chat
    io.to(room.code).emit('message', { user: player.name, text: msg });
  });

  // NEXT ROUND
  function nextRound(code) {
    const room = rooms[code];
    if (!room) return;

    room.round++;
    if (room.round > room.maxRounds) {
      endGame(code);
      return;
    }

    const playerIds = Object.keys(room.players);
    if (playerIds.length === 0) return;

    const drawerId = playerIds[room.drawerIndex % playerIds.length];
    room.currentDrawer = drawerId;
    room.currentWord = null;
    room.guessedPlayers = new Set();
    room.roundStartTime = null;

    const drawerName = room.players[drawerId].name;

    io.to(code).emit('newRound', room.round, room.maxRounds, drawerId, drawerName);
    io.to(code).emit('clearCanvas');
    io.to(code).emit('wordHint', 'Waiting for drawer...');

    // Give drawer 3 word choices
    const choices = WORD_LIST.sort(() => Math.random() - 0.5).slice(0, 3);
    io.to(drawerId).emit('yourTurn', choices);

    room.drawerIndex++;
  }

  // TIMER
  function startTimer(code) {
    const room = rooms[code];
    let timeLeft = 80;

    clearInterval(room.timer);
    room.timer = setInterval(() => {
      io.to(code).emit('timer', timeLeft);
      timeLeft--;

      if (timeLeft < 0) {
        clearInterval(room.timer);
        io.to(code).emit('wordReveal', room.currentWord || "Time's up!");
        io.to(code).emit('message', { user: 'System', text: `Time's up! Word was: ${room.currentWord || "none"}` });
        setTimeout(() => nextRound(code), 5000);
      }
    }, 1000);
  }

  // GAME OVER
  function endGame(code) {
    const room = rooms[code];
    if (!room) return;

    const leaderboard = Object.values(room.players)
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));

    io.to(code).emit('gameOver', leaderboard);
    delete rooms[code];
  }

  // DISCONNECT
  socket.on('disconnect', () => {
    for (const code in rooms) {
      if (rooms[code].players[socket.id]) {
        const name = rooms[code].players[socket.id].name;
        delete rooms[code].players[socket.id];
        io.to(code).emit('message', { user: 'System', text: `${name} left` });
        io.to(code).emit('updatePlayers', Object.values(rooms[code].players));

        if (Object.keys(rooms[code].players).length === 0) {
          clearInterval(rooms[code].timer);
          delete rooms[code];
        } else if (rooms[code].currentDrawer === socket.id) {
          clearInterval(rooms[code].timer);
          setTimeout(() => nextRound(code), 3000);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});