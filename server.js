// server.js - SKRIBBL.IO CLONE (Correct behavior: word revealed ONLY on timer)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// ADD THESE 3 LINES FOR VERCEL
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});
// END ADD

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== GAME STATE ====================
const rooms = {};
const MAX_ROUNDS = 6;
const ROUND_TIME = 80;

const wordList = [
  "cat", "dog", "house", "tree", "car", "sun", "moon", "star", "fish", "bird",
  "apple", "banana", "pizza", "cake", "rainbow", "rocket", "castle", "dragon",
  "unicorn", "computer", "phone", "book", "mountain", "ocean", "giraffe",
  "elephant", "penguin", "butterfly", "flower", "heart", "smile", "fire"
];

// ==================== SOCKET LOGIC ====================
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Create / Join Room
  socket.on('createRoom', (code, name) => {
    code = code.toUpperCase();
    if (rooms[code]) return socket.emit('roomError', 'Room exists');
    rooms[code] = {
      code, players: {}, round: 1, drawerIndex: 0,
      currentWord: null, currentDrawer: null,
      gameStarted: false, timer: null, roundStartTime: null,
      guessedPlayers: new Set()  // Track who already guessed correctly
    };
    joinPlayer(socket, code, name);
  });

  socket.on('joinRoom', (code, name) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('invalidCode');
    if (Object.keys(rooms[code].players).length >= 10) return socket.emit('roomFull');
    joinPlayer(socket, code, name);
  });

  function joinPlayer(socket, code, name) {
    socket.join(code);
    const player = { id: socket.id, name: name.trim() || "Guest", score: 0 };
    rooms[code].players[socket.id] = player;

    socket.emit('roomJoined', code, rooms[code].players);
    io.to(code).emit('updatePlayers', rooms[code].players);
    io.to(code).emit('message', { user: 'System', text: `${player.name} joined!` });

    if (Object.keys(rooms[code].players).length >= 2 && !rooms[code].gameStarted) {
      rooms[code].gameStarted = true;
      setTimeout(() => nextRound(code), 3000);
    }
  }

  // Word chosen by drawer
  socket.on('chooseWord', (word) => {
    const room = Object.values(rooms).find(r => r.players[socket.id]);
    if (!room || room.currentDrawer !== socket.id) return;

    room.currentWord = word;
    room.guessedPlayers = new Set(); // reset

    const hint = word.split('').map((l, i) => i % 2 === 0 ? l : '_').join(' ');
    io.to(room.code).emit('wordHint', hint);
    io.to(socket.id).emit('message', { user: 'Private', text: `Word: ${word}` });

    startTimer(room.code);
  });

  // Drawing
  socket.on('draw', (data) => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('draw', data);
  });
  socket.on('clearCanvas', () => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('clearCanvas');
  });

  // CHAT & GUESSING — WORD REVEALED ONLY ON TIMER!
  socket.on('chatMessage', (msg) => {
    const room = Object.values(rooms).find(r => r.players[socket.id]);
    if (!room || !room.currentWord) return;

    const player = room.players[socket.id];
    const guess = msg.trim();

    // Drawer can't guess
    if (socket.id === room.currentDrawer) {
      io.to(room.code).emit('message', { user: player.name, text: guess });
      return;
    }

    // Already guessed correctly this round?
    if (room.guessedPlayers.has(socket.id)) {
      socket.emit('message', { user: 'System', text: 'You already guessed it!' });
      return;
    }

    // CORRECT GUESS → points + private message
    if (guess.toLowerCase() === room.currentWord.toLowerCase()) {
      room.guessedPlayers.add(socket.id);

      const timeElapsed = Math.floor((Date.now() - room.roundStartTime) / 1000);
      const points = Math.max(20, 100 - timeElapsed);

      player.score += points;

      // Tell ONLY the guesser they got it right
      socket.emit('message', { user: 'System', text: `Correct! +${points} pts` });
      io.to(room.code).emit('correctGuess', player.name, points);

      // Optional: end round early if everyone guessed
      const totalGuessers = Object.keys(room.players).length - 1;
      if (room.guessedPlayers.size >= totalGuessers) {
        clearInterval(room.timer);
        setTimeout(() => {
          io.to(room.code).emit('wordReveal', room.currentWord);
          io.to(room.code).emit('message', { user: 'System', text: 'Everyone guessed!' });
          setTimeout(() => nextRound(room.code), 4000);
        }, 2000);
      }
      return;
    }

    // Too close → hide
    if (room.currentWord.toLowerCase().includes(guess.toLowerCase()) && guess.length > 2) {
      socket.emit('message', { user: 'System', text: 'Too close!' });
      return;
    }

    // Normal chat
    io.to(room.code).emit('message', { user: player.name, text: guess });
  });

  // Next Round
  function nextRound(code) {
    const room = rooms[code];
    if (!room || room.round > MAX_ROUNDS) {
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

    io.to(code).emit('newRound', room.round, drawerId, drawerName);
    io.to(code).emit('clearCanvas');
    io.to(code).emit('wordHint', 'Waiting...');

    const choices = getRandomWords(3);
    io.to(drawerId).emit('yourTurn', choices);

    setTimeout(() => {
      if (!room.currentWord) {
        const word = choices[0];
        room.currentWord = word;
        const hint = word.split('').map((l, i) => i % 2 === 0 ? l : '_').join(' ');
        io.to(code).emit('wordHint', hint);
        io.to(drawerId).emit('autoChooseWord', word);
        io.to(drawerId).emit('message', { user: 'Private', text: `Auto: ${word}` });
        startTimer(code);
      }
    }, 15000);

    room.drawerIndex++;
    room.round++;
  }

  function startTimer(code) {
    const room = rooms[code];
    room.roundStartTime = Date.now();

    let timeLeft = ROUND_TIME;
    room.timer = setInterval(() => {
      io.to(code).emit('timer', timeLeft);
      timeLeft--;

      if (timeLeft < 0) {
        clearInterval(room.timer);
        room.timer = null;
        io.to(code).emit('wordReveal', room.currentWord);
        io.to(code).emit('message', { user: 'System', text: `Time's up! Word was: ${room.currentWord}` });
        setTimeout(() => nextRound(code), 5000);
      }
    }, 1000);
  }

  function endGame(code) {
    const room = rooms[code];
    if (!room) return;

    const leaderboard = Object.values(room.players)
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));

    io.to(code).emit('gameOver', leaderboard);
    delete rooms[code];
  }

  // Disconnect
  socket.on('disconnect', () => {
    for (const code in rooms) {
      if (rooms[code].players[socket.id]) {
        const name = rooms[code].players[socket.id].name;
        delete rooms[code].players[socket.id];
        io.to(code).emit('updatePlayers', rooms[code].players);
        io.to(code).emit('message', { user: 'System', text: `${name} left` });

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

// Helpers
function getRandomWords(n) {
  const shuffled = [...wordList].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

// Start
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});