// server.js — Merged, fixed, production-safe
// Behavior: word revealed ONLY on timer. Drawer receives bonus on correct guesses.

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
const MAX_ROUNDS = 6;
const ROUND_TIME = 80;

const wordList = [
  "cat", "dog", "house", "tree", "car", "sun", "moon", "star", "fish", "bird",
  "apple", "banana", "pizza", "cake", "rainbow", "rocket", "castle", "dragon",
  "unicorn", "computer", "phone", "book", "mountain", "ocean", "giraffe",
  "elephant", "penguin", "butterfly", "flower", "heart", "smile", "fire"
];

// -------------------- Helpers --------------------
function getRoomCodeFromSocket(socket) {
  // Works whether socket.rooms contains [socket.id, roomCode] or [roomCode] or different ordering
  return Array.from(socket.rooms).find(r => rooms[r]);
}

function findRoomByPlayerId(playerId) {
  return Object.values(rooms).find(r => r.players && r.players[playerId]);
}

function sendPlayersUpdate(code) {
  if (!rooms[code]) return;
  // send array of players sorted by score desc
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

  // Create room
  socket.on('createRoom', (code, name = 'Host') => {
    if (!code) return socket.emit('roomError', 'Invalid code');
    code = code.toUpperCase();
    if (rooms[code]) return socket.emit('roomError', 'Room exists');
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
      guessedPlayers: new Set()
    };
    joinPlayerToRoom(socket, code, name);
  });

  // Join room
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

    // send array for compatibility with front-end
    socket.emit('roomJoined', code, Object.values(rooms[code].players).sort((a,b)=>b.score-a.score), MAX_ROUNDS);
    sendPlayersUpdate(code);
    io.to(code).emit('message', { user: 'System', text: `${player.name} joined!` });

    // Auto-start when >= 2 players
    if (Object.keys(rooms[code].players).length >= 2 && !rooms[code].gameStarted) {
      rooms[code].gameStarted = true;
      setTimeout(() => nextRound(code), 3000);
    }
  }

  // Drawer chooses a word
  socket.on('chooseWord', (word) => {
    const room = findRoomByPlayerId(socket.id);
    if (!room) return;
    if (room.currentDrawer !== socket.id) return;

    room.currentWord = word;
    room.guessedPlayers = new Set();
    room.roundStartTime = Date.now();

    // hint with every second char hidden
    const hint = room.currentWord.split('').map((c,i)=> i%2===0 ? c : '_').join(' ');
    io.to(room.code).emit('wordHint', hint);
    socket.emit('message', { user: 'Private', text: `Your word: ${room.currentWord}` });

    // start timer for this round
    startTimer(room.code);
  });

  // drawing broadcast
  socket.on('draw', (data) => {
    const roomCode = getRoomCodeFromSocket(socket);
    if (roomCode) socket.to(roomCode).emit('draw', data);
  });

  socket.on('clearCanvas', () => {
    const roomCode = getRoomCodeFromSocket(socket);
    if (roomCode) socket.to(roomCode).emit('clearCanvas');
  });

  // Chat & guessing
  socket.on('chatMessage', (msg) => {
    if (!msg) return;
    const room = findRoomByPlayerId(socket.id);
    if (!room || !room.currentWord) return;

    const player = room.players[socket.id];
    const guessRaw = msg.trim();
    if (!player) return;

    // Drawer sending chat
    if (socket.id === room.currentDrawer) {
      io.to(room.code).emit('message', { user: player.name, text: guessRaw });
      return;
    }

    // already guessed this round
    if (room.guessedPlayers.has(socket.id)) {
      socket.emit('message', { user: 'System', text: 'You already guessed it!' });
      return;
    }

    const guess = guessRaw.toLowerCase();
    const target = room.currentWord.toLowerCase();

    // too close (substring) check
    if (guess.length > 2 && target.includes(guess) && guess !== target) {
      socket.emit('message', { user: 'System', text: 'Too close!' });
      return;
    }

    // correct guess (award points, but DO NOT reveal the word — reveal only on timer)
    if (guess === target) {
      room.guessedPlayers.add(socket.id);

      const timeElapsed = Math.floor((Date.now() - room.roundStartTime) / 1000);
      // scoring formula — ensures a minimum and scales with speed
      const guesserPoints = Math.max(20, Math.round(120 - timeElapsed * 1.5));
      const drawerBonus = Math.round(guesserPoints * 0.4);

      // update scores
      player.score += guesserPoints;
      if (room.currentDrawer && room.players[room.currentDrawer]) {
        room.players[room.currentDrawer].score += drawerBonus;
      }

      // notify everyone that someone guessed correctly (without revealing the word)
      io.to(room.code).emit('message', {
        user: 'System',
        text: `<strong style="color:#FFD700">${player.name}</strong> guessed it! +${guesserPoints} pts • Drawer +${drawerBonus} pts`
      });

      // private confirmation to guesser
      socket.emit('message', { user: 'System', text: `Correct! +${guesserPoints} pts` });

      // send a dedicated event if front-end wants special handling
      io.to(room.code).emit('correctGuess', player.name, guesserPoints, drawerBonus);

      // MUST update players for everybody
      sendPlayersUpdate(room.code);

      // if everyone except drawer guessed, end round early WITHOUT revealing the word
      const totalGuessers = Object.keys(room.players).length - 1;
      if (room.guessedPlayers.size >= totalGuessers) {
        // stop timer and proceed to next round without revealing the word
        if (room.timer) {
          clearInterval(room.timer);
          room.timer = null;
        }
        io.to(room.code).emit('message', { user: 'System', text: 'All players guessed — proceeding to next round.' });
        // small delay for UX
        setTimeout(() => nextRound(room.code), 3000);
      }

      return;
    }

    // normal chat broadcast
    io.to(room.code).emit('message', { user: player.name, text: guessRaw });
  });

  // Next round logic
  function nextRound(code) {
    const room = rooms[code];
    if (!room) return;

    // end game if beyond max rounds
    if (room.round > MAX_ROUNDS) {
      endGame(code);
      return;
    }

    const playerIds = Object.keys(room.players);
    if (playerIds.length === 0) return;

    // choose drawer
    const drawerId = playerIds[room.drawerIndex % playerIds.length];
    room.currentDrawer = drawerId;
    room.currentWord = null;
    room.guessedPlayers = new Set();
    room.roundStartTime = null;

    const drawerName = room.players[drawerId].name;

    // notify clients
    io.to(code).emit('newRound', room.round, MAX_ROUNDS, drawerId, drawerName);
    io.to(code).emit('clearCanvas');
    io.to(code).emit('wordHint', 'Waiting...');

    // pick choices for drawer
    const choices = getRandomWords(3);
    io.to(drawerId).emit('yourTurn', choices);

    // if drawer doesn't pick, auto choose after 15s
    room.wordChoiceTimeout && clearTimeout(room.wordChoiceTimeout);
    room.wordChoiceTimeout = setTimeout(() => {
      if (!room.currentWord) {
        const autoWord = choices[0];
        room.currentWord = autoWord;
        const hint = autoWord.split('').map((c,i) => i%2===0 ? c : '_').join(' ');
        io.to(code).emit('wordHint', hint);
        io.to(drawerId).emit('autoChooseWord', autoWord);
        io.to(drawerId).emit('message', { user: 'Private', text: `Auto-selected: ${autoWord}` });

        // start timer once auto selected
        startTimer(code);
      }
    }, 15000);

    room.drawerIndex++;
    room.round++;
  }

  // Timer logic — reveal word only when timer finishes
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
        // reveal the word to everyone only when timer ends
        io.to(code).emit('wordReveal', room.currentWord || 'None');
        io.to(code).emit('message', { user: 'System', text: `Time's up! Word was: ${room.currentWord || 'none'}` });

        // small delay then next round
        setTimeout(() => nextRound(code), 5000);
      }
    }, 1000);
  }

  // End game
  function endGame(code) {
    const room = rooms[code];
    if (!room) return;

    const leaderboard = Object.values(room.players)
      .sort((a,b) => b.score - a.score)
      .map((p, i) => ({ rank: i+1, name: p.name, score: p.score }));

    io.to(code).emit('gameOver', leaderboard);

    // cleanup
    if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
    delete rooms[code];
  }

  // Disconnect handling
  socket.on('disconnect', () => {
    // find room(s) which include this player
    for (const code in rooms) {
      if (rooms[code].players[socket.id]) {
        const name = rooms[code].players[socket.id].name;
        delete rooms[code].players[socket.id];

        // notify
        sendPlayersUpdate(code);
        io.to(code).emit('message', { user: 'System', text: `${name} left` });

        // if empty room then cleanup
        if (Object.keys(rooms[code].players).length === 0) {
          if (rooms[code].timer) { clearInterval(rooms[code].timer); rooms[code].timer = null; }
          delete rooms[code];
        } else if (rooms[code].currentDrawer === socket.id) {
          // if drawer disconnected: stop timer and start next round
          if (rooms[code].timer) { clearInterval(rooms[code].timer); rooms[code].timer = null; }
          setTimeout(() => nextRound(code), 3000);
        }
        break;
      }
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
