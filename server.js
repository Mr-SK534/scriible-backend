const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);

const io = socketIo(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const rooms = {};
const WORD_LIST = [
  "cat","dog","house","tree","car","sun","moon","star","fish","bird",
  "apple","banana","pizza","cake","rainbow","rocket","castle","dragon","unicorn","phone",
  "book","ocean","giraffe","elephant","penguin","butterfly","flower","heart","smile",
  "fire","plane","train","boat","cloud","mountain","beach","forest","island","desert",
  "volcano","bridge","tower","school","icecream","cookie","donut","burger","fries",
  "coffee","tea","juice","robot","alien","spaceship","sword","shield","crown",
  "diamond","laptop"
];

io.on('connection', (socket) => {

  // CREATE ROOM
  socket.on('createRoom', (code, name, numRounds = 6) => {
    code = code.toUpperCase();
    if (rooms[code]) return socket.emit('errorMsg', 'Room already exists!');
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
      guessedPlayers: new Set(),
      wordChoiceTimeout: null
    };
    const player = { id: socket.id, name: name.trim() || "Host", score: 0 };
    socket.join(code);
    rooms[code].players[socket.id] = player;
    socket.emit('roomJoined', code, Object.values(rooms[code].players), rooms[code].maxRounds);
    io.to(code).emit('updatePlayers', Object.values(rooms[code].players));
    io.to(code).emit('message', { user: 'System', text: `${player.name} created the room!` });
  });

  // JOIN ROOM
  socket.on('joinRoom', (code, name) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('errorMsg', 'Room not found');
    if (Object.keys(rooms[code].players).length >= 12) return socket.emit('errorMsg', 'Room is full');
    const player = { id: socket.id, name: name.trim() || "Guest", score: 0 };
    socket.join(code);
    rooms[code].players[socket.id] = player;
    socket.emit('roomJoined', code, Object.values(rooms[code].players), rooms[code].maxRounds);
    io.to(code).emit('updatePlayers', Object.values(rooms[code].players));
    io.to(code).emit('message', { user: 'System', text: `${player.name} joined!` });
    if (Object.keys(rooms[code].players).length >= 2 && !rooms[code].gameStarted) {
      rooms[code].gameStarted = true;
      setTimeout(() => nextRound(code), 3000);
    }
  });

  // Word Chosen
  socket.on('chooseWord', (word) => {
    const room = Object.values(rooms).find(r => r.currentDrawer === socket.id);
    if (!room || !word) return;
    if (room.wordChoiceTimeout) clearTimeout(room.wordChoiceTimeout);
    room.currentWord = word;
    room.guessedPlayers = new Set();
    room.roundStartTime = Date.now();
    // Private message to drawer
    socket.emit('message', { user: 'Private', text: `Your word: ${word}` });
    const hint = word.split('').map((c,i) => i % 2 === 0 ? c : '_').join(' ');
    io.to(room.code).emit('wordHint', hint);
    io.to(room.code).emit('message', { user: 'System', text: 'Word chosen! Start guessing!' });
    startTimer(room.code);
  });

  // Drawing events
  socket.on('draw', data => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('draw', data);
  });
  socket.on('clearCanvas', () => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('clearCanvas');
  });

  // Chat & Guessing
  socket.on('chatMessage', (msg) => {
    const room = Object.values(rooms).find(r => r.players[socket.id]);
    if (!room) return;
    const player = room.players[socket.id];
    const guess = msg.trim().toLowerCase();

    if (socket.id === room.currentDrawer) {
      io.to(room.code).emit('message', { user: player.name, text: msg });
      return;
    }
    if (room.guessedPlayers.has(socket.id)) {
      socket.emit('errorMsg', 'You already guessed it!');
      return;
    }
    if (room.currentWord && room.currentWord.toLowerCase().includes(guess) && guess.length > 2) {
      socket.emit('errorMsg', 'Too close!');
      return;
    }
    if (room.currentWord && guess === room.currentWord.toLowerCase()) {
      room.guessedPlayers.add(socket.id);
      const timeElapsed = (Date.now() - room.roundStartTime) / 1000;
      const points = Math.max(20, Math.round(120 - timeElapsed * 1.5));
      player.score += points;
      if (room.currentDrawer) {
        room.players[room.currentDrawer].score += Math.round(points * 0.4);
      }
      socket.emit('message', { user: 'System', text: `Correct! +${points} pts` });
      io.to(room.code).emit('correctGuess', player.name, points);
      io.to(room.code).emit('message', { user: 'System', text: `${player.name} guessed the word!` });
      io.to(room.code).emit('updatePlayers', Object.values(room.players));
      if (room.guessedPlayers.size >= Object.keys(room.players).length - 1) {
        clearInterval(room.timer);
        io.to(room.code).emit('wordReveal', room.currentWord);
        setTimeout(() => nextRound(room.code), 4000);
      }
      return;
    }
    io.to(room.code).emit('message', { user: player.name, text: msg });
  });

  // Next round + auto choose after 15s if needed
  function nextRound(code) {
    const room = rooms[code];
    if (!room) return;
    room.round++;
    if (room.round > room.maxRounds) return endGame(code);
    const ids = Object.keys(room.players);
    const drawerId = ids[room.drawerIndex % ids.length];
    room.currentDrawer = drawerId;
    room.currentWord = null;
    room.guessedPlayers = new Set();
    io.to(code).emit('newRound', room.round, room.maxRounds, drawerId, room.players[drawerId].name);
    io.to(code).emit('clearCanvas');
    io.to(code).emit('wordHint', 'Waiting...');
    const choices = WORD_LIST.sort(() => Math.random() - 0.5).slice(0, 3);
    io.to(drawerId).emit('yourTurn', choices);
    room.wordChoiceTimeout = setTimeout(() => {
      if (!room.currentWord) {
        const word = choices[0];
        room.currentWord = word;
        room.roundStartTime = Date.now();
        // Private to drawer + popup on client
        io.to(drawerId).emit('message', { user: 'System', text: `Auto-selected: ${word}` });
        io.to(code).emit('message', { user: 'System', text: 'Drawer was slow — auto word!' });
        const hint = word.split('').map((c,i) => i%2===0?c:'_').join(' ');
        io.to(code).emit('wordHint', hint);
        startTimer(code);
      }
    }, 15000);
    room.drawerIndex++;
  }

  function startTimer(code) {
    const room = rooms[code];
    let time = 80;
    clearInterval(room.timer);
    room.timer = setInterval(() => {
      io.to(code).emit('timer', time--);
      if (time < 0) {
        clearInterval(room.timer);
        io.to(code).emit('wordReveal', room.currentWord || "None");
        io.to(code).emit('message', { user: 'System', text: `Time's up! Word was: ${room.currentWord || "none"}` });
        setTimeout(() => nextRound(code), 5000);
      }
    }, 1000);
  }

  function endGame(code) {
    const room = rooms[code];
    if (!room) return;
    const leaderboard = Object.values(room.players).sort((a,b) => b.score - a.score)
      .map((p,i) => ({ rank: i+1, name: p.name, score: p.score }));
    io.to(code).emit('gameOver', leaderboard);
    delete rooms[code];
  }

  socket.on('disconnect', () => {
    for (const code in rooms) {
      if (rooms[code].players[socket.id]) {
        delete rooms[code].players[socket.id];
        io.to(code).emit('updatePlayers', Object.values(rooms[code].players));
        if (Object.keys(rooms[code].players).length === 0) {
          clearInterval(rooms[code].timer);
          if (rooms[code].wordChoiceTimeout) clearTimeout(rooms[code].wordChoiceTimeout);
          delete rooms[code];
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
