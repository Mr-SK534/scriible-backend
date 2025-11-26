// server.js — FINAL VERSION — ROUND SELECTION FIXED & EVERYTHING ELSE PERFECT
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ==================== GAME STATE ====================
const rooms = {};
const ROUND_TIME = 80;

const wordList = [
  // Simple/Classic
  "cat", "dog", "house", "tree", "car", "sun", "moon", "star", "fish", "bird",
  "apple", "banana", "pizza", "cake", "rainbow", "rocket", "castle", "dragon",
  "unicorn", "computer", "phone", "book", "mountain", "ocean", "giraffe",
  "elephant", "penguin", "butterfly", "flower", "heart", "smile", "fire",
  "key", "cloud", "boat", "hat", "shoe", "egg", "chair", "train", "train", "bus", "map",
  "whale", "island", "plane", "bottle", "circle", "ear", "nose", "balloon", "candle",
  "guitar", "bicycle", "truck", "cow", "robot", "turtle", "octopus", "rocket", "starfish",
  "lion", "tiger", "bear", "wolf", "rose", "leaf", "cup", "spoon", "mirror", "glove",
  "ring", "watch", "backpack", "girl", "boy", "dress", "monkey", "banana", "hand", "foot",
  "window", "door", "bed", "tower", "cloud", "camera", "teeth", "spider", "cupcake", "cookie", "belt",
  "fork", "cake", "broom", "duck", "pear", "ant", "banana", "desk", "snail", "fan",
 
  "microscope", "helicopter", "skyscraper", "refrigerator", "lighthouse",
  "parachute", "recycle", "headphones", "fountain", "flashlight", 
  "thermometer", "compass", "bulldozer", "wheelchair", "shoppingcart",
  "disco ball", "fire extinguisher", "washing machine", "submarine", "wind turbine",
  "mountaineer", "astronaut", "traffic jam", "vending machine", "magnifying glass"
];


// -------------------- Helpers --------------------
function getRoomCodeFromSocket(socket) {
  return Array.from(socket.rooms).find(r => rooms[r]);
}

function findRoomByPlayerId(playerId) {
  return Object.values(rooms).find(r => r.players && r.players[playerId]);
}

function sendPlayersUpdate(code) {
  if (!rooms[code]) return;
  const arr = Object.values(rooms[code].players).sort((a,b) => b.score - a.score);
  io.to(code).emit('updatePlayers', arr);
}

function getRandomWords(n) {
  const shuffled = [...wordList].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

// -------------------- Socket Logic --------------------
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // FIXED: Round selection now works perfectly
  socket.on('createRoom', (code, name = 'Host', rounds = 6) => {
    if (!code) return socket.emit('roomError', 'Invalid code');
    code = code.toUpperCase();
    if (rooms[code]) return socket.emit('roomError', 'Room exists');

    const maxRounds = Math.max(3, Math.min(20, parseInt(rounds) || 6));

    rooms[code] = {
      code,
      players: {},
      round: 1,
      drawerIndex: 0,
      currentWord: null,
      currentDrawer: null,
      gameStarted: false,
      timer: null,
      roundStartTime: null,
      guessedPlayers: new Set(),
      maxRounds: maxRounds
    };
    joinPlayerToRoom(socket, code, name);
  });

  socket.on('joinRoom', (code, name = 'Guest') => {
    if (!code) return socket.emit('invalidCode');
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('invalidCode');
    if (Object.keys(rooms[code].players).length >= 10) return socket.emit('roomFull');
    joinPlayerToRoom(socket, code, name);
  });

  function joinPlayerToRoom(socket, code, name) {
    socket.join(code);
    const player = { id: socket.id, name: (name || 'Guest').trim(), score: 0 };
    rooms[code].players[socket.id] = player;

    // Send actual maxRounds from room
    socket.emit('roomJoined', code, Object.values(rooms[code].players), rooms[code].maxRounds);
    sendPlayersUpdate(code);
    io.to(code).emit('message', { user: 'System', text: `${player.name} joined!` });

    if (Object.keys(rooms[code].players).length >= 2 && !rooms[code].gameStarted) {
      rooms[code].gameStarted = true;
      setTimeout(() => nextRound(code), 3000);
    }
  }

  socket.on('chooseWord', (word) => {
    const room = findRoomByPlayerId(socket.id);
    if (!room || room.currentDrawer !== socket.id) return;

    room.currentWord = word;
    room.guessedPlayers = new Set();
    room.roundStartTime = Date.now();

    const hint = word.split('').map((c,i) => i%2===0 ? c : '_').join(' ');
    io.to(room.code).emit('wordHint', hint);
    socket.emit('message', { user: 'Private', text: `Your word: ${word}` });
    startTimer(room.code);
  });

  socket.on('draw', (data) => {
    const roomCode = getRoomCodeFromSocket(socket);
    if (roomCode) socket.to(roomCode).emit('draw', data);
  });

  socket.on('clearCanvas', () => {
    const roomCode = getRoomCodeFromSocket(socket);
    if (roomCode) socket.to(roomCode).emit('clearCanvas');
  });

  socket.on('chatMessage', (msg) => {
    if (!msg) return;
    const room = findRoomByPlayerId(socket.id);
    if (!room || !room.currentWord) return;

    const player = room.players[socket.id];
    const guessRaw = msg.trim();

    if (socket.id === room.currentDrawer) {
      io.to(room.code).emit('message', { user: player.name, text: guessRaw });
      return;
    }

    if (room.guessedPlayers.has(socket.id)) {
      socket.emit('message', { user: 'System', text: 'You already guessed it!' });
      return;
    }

    const guess = guessRaw.toLowerCase();
    const target = room.currentWord.toLowerCase();

    if (guess.length > 2 && target.includes(guess) && guess !== target) {
      socket.emit('message', { user: 'System', text: 'Too close!' });
      return;
    }

    if (guess === target) {
      room.guessedPlayers.add(socket.id);

      const timeElapsed = Math.floor((Date.now() - room.roundStartTime) / 1000);
      const guesserPoints = Math.max(20, Math.round(120 - timeElapsed * 1.5));
      const drawerBonus = Math.round(guesserPoints * 0.4);

      player.score += guesserPoints;
      if (room.currentDrawer) room.players[room.currentDrawer].score += drawerBonus;

      io.to(room.code).emit('message', {
        user: 'System',
        text: `<strong style="color:#FFD700">${player.name}</strong> guessed it! +${guesserPoints} pts • Drawer +${drawerBonus} pts`
      });

      socket.emit('message', { user: 'System', text: `Correct! +${guesserPoints} pts` });
      io.to(room.code).emit('correctGuess', player.name, guesserPoints, drawerBonus);
      sendPlayersUpdate(room.code);

      const totalGuessers = Object.keys(room.players).length - 1;
      if (room.guessedPlayers.size >= totalGuessers) {
        if (room.timer) clearInterval(room.timer);
        io.to(room.code).emit('message', { user: 'System', text: 'All players guessed — next round!' });
        setTimeout(() => nextRound(room.code), 3000);
      }
      return;
    }

    io.to(room.code).emit('message', { user: player.name, text: guessRaw });
  });

  function nextRound(code) {
    const room = rooms[code];
    if (!room) return;

    if (room.round > room.maxRounds) {  // ← Now uses correct value
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
    io.to(code).emit('wordHint', 'Waiting...');

    const choices = getRandomWords(3);
    io.to(drawerId).emit('yourTurn', choices);

    room.wordChoiceTimeout && clearTimeout(room.wordChoiceTimeout);
    room.wordChoiceTimeout = setTimeout(() => {
      if (!room.currentWord) {
        const autoWord = choices[0];
        room.currentWord = autoWord;
        const hint = autoWord.split('').map((c,i) => i%2===0 ? c : '_').join(' ');
        io.to(code).emit('wordHint', hint);
        io.to(drawerId).emit('autoChooseWord', autoWord);
        io.to(drawerId).emit('message', { user: 'Private', text: `Auto-selected: ${autoWord}` });
        startTimer(code);
      }
    }, 15000);

    room.drawerIndex++;
    room.round++;
  }

  function startTimer(code) {
    const room = rooms[code];
    if (!room) return;
    room.roundStartTime = Date.now();

    let timeLeft = ROUND_TIME;
    if (room.timer) clearInterval(room.timer);
    room.timer = setInterval(() => {
      io.to(code).emit('timer', timeLeft);
      timeLeft--;
      if (timeLeft < 0) {
        clearInterval(room.timer);
        room.timer = null;
        io.to(code).emit('wordReveal', room.currentWord || 'None');
        io.to(code).emit('message', { user: 'System', text: `Time's up! Word was: ${room.currentWord || 'none'}` });
        setTimeout(() => nextRound(code), 5000);
      }
    }, 1000);
  }

  function endGame(code) {
    const room = rooms[code];
    if (!room) return;

    const leaderboard = Object.values(room.players)
      .sort((a,b) => b.score - a.score)
      .map((p, i) => ({ rank: i+1, name: p.name, score: p.score }));

    io.to(code).emit('gameOver', leaderboard);

    if (room.timer) clearInterval(room.timer);
    delete rooms[code];
  }

  socket.on('disconnect', () => {
    for (const code in rooms) {
      if (rooms[code].players[socket.id]) {
        const name = rooms[code].players[socket.id].name;
        delete rooms[code].players[socket.id];
        sendPlayersUpdate(code);
        io.to(code).emit('message', { user: 'System', text: `${name} left` });

        if (Object.keys(rooms[code].players).length === 0) {
          if (rooms[code].timer) clearInterval(rooms[code].timer);
          delete rooms[code];
        } else if (rooms[code].currentDrawer === socket.id) {
          if (rooms[code].timer) clearInterval(rooms[code].timer);
          setTimeout(() => nextRound(code), 3000);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));