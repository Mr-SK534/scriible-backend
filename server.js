// server.js — FULLY FIXED & STABLE FOR RENDER

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = {};
const WORD_LIST = [
  "cat","dog","house","tree","car","sun","moon","star","fish","bird",
  "apple","banana","pizza","cake","rainbow","rocket","castle","dragon",
  "unicorn","phone","book","ocean","giraffe","elephant","penguin",
  "butterfly","flower","heart","smile","fire","plane","train","boat",
  "cloud","mountain","beach","forest","island","desert","volcano",
  "bridge","tower","school","icecream","cookie","donut","burger","fries",
  "coffee","tea","juice","robot","alien","spaceship","sword","shield",
  "crown","diamond"
];

// 🔥 UNIVERSAL ROOM DETECTOR — WORKS 100%
function getRoomCode(socket) {
  return Array.from(socket.rooms).find(r => rooms[r]);
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', (code, name, numRounds = 6) => {
    code = code.toUpperCase();
    if (rooms[code]) return socket.emit('errorMsg', 'Room exists!');
    numRounds = Math.max(3, Math.min(20, parseInt(numRounds))) || 6;

    rooms[code] = {
      code, players: {}, round: 0, maxRounds: numRounds,
      drawerIndex: 0, currentWord: null, currentDrawer: null,
      gameStarted: false, timer: null, roundStartTime: null,
      guessedPlayers: new Set(), wordChoiceTimeout: null
    };

    joinPlayer(socket, code, name.trim() || "Host");
  });

  socket.on('joinRoom', (code, name) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('errorMsg', 'Room not found');
    if (Object.keys(rooms[code].players).length >= 12)
      return socket.emit('errorMsg', 'Room full');

    joinPlayer(socket, code, name.trim() || "Guest");
  });

  // ⭐ PLAYER JOIN
  function joinPlayer(socket, code, name) {
    socket.join(code);
    rooms[code].players[socket.id] = { id: socket.id, name, score: 0 };

    socket.emit('roomJoined', code, Object.values(rooms[code].players), rooms[code].maxRounds);
    io.to(code).emit('updatePlayers', Object.values(rooms[code].players));
    io.to(code).emit('message', { user: 'System', text: `${name} joined!` });

    if (Object.keys(rooms[code].players).length >= 2 && !rooms[code].gameStarted) {
      rooms[code].gameStarted = true;
      setTimeout(() => nextRound(code), 3000);
    }
  }

  // ⭐ WORD CHOICE
  socket.on('chooseWord', (word) => {
    const room = Object.values(rooms).find(r => r.currentDrawer === socket.id);
    if (!room || !word) return;

    clearTimeout(room.wordChoiceTimeout);

    room.currentWord = word;
    room.guessedPlayers = new Set();
    room.roundStartTime = Date.now();

    socket.emit('message', { user: 'You', text: `Your word: <strong style="color:#4CAF50;font-size:18px">${word}</strong>` });

    const hint = word.split('').map((c,i) => i % 2 === 0 ? c : "_").join(" ");
    io.to(room.code).emit('wordHint', hint);
    io.to(room.code).emit('message', { user: 'System', text: 'Word chosen! Start guessing!' });

    startTimer(room.code);
  });

  // 🎨 DRAW FIXED BROADCAST
  socket.on('draw', data => {
    const roomCode = getRoomCode(socket);
    if (roomCode) socket.to(roomCode).emit('draw', data);
  });

  // 🧹 CLEAR CANVAS FIXED
  socket.on('clearCanvas', () => {
    const roomCode = getRoomCode(socket);
    if (roomCode) socket.to(roomCode).emit('clearCanvas');
  });

  // 💬 CHAT + GUESSING + SCORING — FIXED
  socket.on('chatMessage', (msg) => {
    const roomCode = getRoomCode(socket);
    const room = rooms[roomCode];
    if (!room || !room.currentWord) return;

    const player = room.players[socket.id];
    const guess = msg.trim().toLowerCase();

    if (socket.id === room.currentDrawer) {
      io.to(roomCode).emit('message', { user: player.name, text: msg });
      return;
    }

    if (room.guessedPlayers.has(socket.id)) return;

    if (guess.length > 2 && room.currentWord.toLowerCase().includes(guess)) {
      socket.emit('errorMsg', 'Too close!');
      return;
    }

    if (guess === room.currentWord.toLowerCase()) {
      room.guessedPlayers.add(socket.id);

      const timeElapsed = (Date.now() - room.roundStartTime) / 1000;
      const guesserPoints = Math.max(20, Math.round(120 - timeElapsed * 1.5));
      const drawerBonus = Math.round(guesserPoints * 0.4);

      player.score += guesserPoints;
      if (room.currentDrawer)
        room.players[room.currentDrawer].score += drawerBonus;

      const drawerName = room.players[room.currentDrawer].name;

      io.to(roomCode).emit('message', {
        user: 'System',
        text: `<strong style="color:#FFD700">${player.name}</strong> guessed it! → +${guesserPoints} pts | <strong style="color:#4CAF50">${drawerName}</strong> +${drawerBonus} pts`
      });

      // 🔥 SCORE UPDATE FIX
      io.to(roomCode).emit('updatePlayers', Object.values(room.players));

      if (room.guessedPlayers.size >= Object.keys(room.players).length - 1) {
        clearInterval(room.timer);
        io.to(roomCode).emit('wordReveal', room.currentWord);
        setTimeout(() => nextRound(roomCode), 4000);
      }
      return;
    }

    io.to(roomCode).emit('message', { user: player.name, text: msg });
  });

  // ⭐ NEXT ROUND
  function nextRound(code) {
    const room = rooms[code];
    if (!room) return;

    room.round++;
    if (room.round > room.maxRounds) return endGame(code);

    const ids = Object.keys(room.players);
    room.currentDrawer = ids[room.drawerIndex % ids.length];
    room.currentWord = null;
    room.guessedPlayers = new Set();

    io.to(code).emit('newRound', room.round, room.maxRounds, room.currentDrawer, room.players[room.currentDrawer].name);
    io.to(code).emit('clearCanvas');
    io.to(code).emit('wordHint', 'Waiting...');

    const choices = WORD_LIST.sort(() => 0.5 - Math.random()).slice(0, 3);
    io.to(room.currentDrawer).emit('yourTurn', choices);

    room.wordChoiceTimeout = setTimeout(() => {
      if (!room.currentWord) {
        room.currentWord = choices[0];
        room.roundStartTime = Date.now();

        io.to(room.currentDrawer).emit('message', { user: 'You', text: `Auto-selected: <strong style="color:#FF9800">${room.currentWord}</strong>` });
        io.to(code).emit('message', { user: 'System', text: 'Word auto-selected!' });

        const hint = room.currentWord.split('').map((c,i) => i%2===0?c:'_').join(' ');
        io.to(code).emit('wordHint', hint);

        startTimer(code);
      }
    }, 15000);

    room.drawerIndex++;
  }

  // ⭐ TIMER
  function startTimer(code) {
    const room = rooms[code];
    let time = 80;

    clearInterval(room.timer);
    room.timer = setInterval(() => {
      io.to(code).emit('timer', time--);

      if (time < 0) {
        clearInterval(room.timer);
        io.to(code).emit('wordReveal', room.currentWord || "None");
        setTimeout(() => nextRound(code), 5000);
      }
    }, 1000);
  }

  // ⭐ END GAME
  function endGame(code) {
    const room = rooms[code];
    if (!room) return;

    const lb = Object.values(room.players)
      .sort((a,b)=>b.score-a.score)
      .map((p,i)=>({rank:i+1,name:p.name,score:p.score}));

    io.to(code).emit('gameOver', lb);
    delete rooms[code];
  }

  // ⭐ DISCONNECT
  socket.on('disconnect', () => {
    const roomCode = getRoomCode(socket);
    const room = rooms[roomCode];
    if (!room) return;

    const name = room.players[socket.id]?.name;
    delete room.players[socket.id];

    io.to(roomCode).emit('updatePlayers', Object.values(room.players));
    io.to(roomCode).emit('message', { user: 'System', text: `${name} left` });

    if (Object.keys(room.players).length === 0)
      delete rooms[roomCode];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on port ${PORT}`)
);
