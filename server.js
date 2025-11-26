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
const wordList = ["cat","dog","house","tree","car","sun","moon","star","fish","bird","apple","banana","pizza","cake","rainbow","rocket","castle","dragon","unicorn","phone","book","ocean","giraffe","elephant","penguin","butterfly","flower","heart","smile","fire","plane","train","boat","cloud","mountain","beach","forest","island","desert","volcano","bridge","tower","church","school","hospital","store","cake","icecream","cookie","donut","burger","fries","soda","coffee","tea","milk","juice","water","earth","mars","jupiter","saturn","neptune","pluto","comet","galaxy","blackhole","robot","alien","spaceship","sword","shield","crown","ring","diamond","gold","silver","bronze","trophy","medal","flag","map","compass","clock","watch","phone","laptop","tv","radio","camera","photo","music","guitar","piano","drum","violin","trumpet","microphone","headphones","game","controller","dice","card","puzzle","chess","soccer","basketball","tennis","swimming","running","cycling","skiing","fishing","camping","tent","backpack","flashlight","compass","binoculars","umbrella","rain","snow","wind","storm","lightning","tornado","earthquake","flood","fire","smoke","ash","lava","diamond","ruby","emerald","sapphire","pearl","coin","money","wallet","creditcard","piggybank","safe","lock","key","door","window","stairs","elevator","chair","table","bed","lamp","clock","mirror","picture","painting","vase","flowerpot","plant","tree","grass","leaf","branch","root","seed","fruit","vegetable","bread","cheese","egg","meat","fish","soup","salad","sandwich","pizza","pasta","rice","noodle","sushi","taco","burrito","hotdog","hamburger","steak","chicken","bacon","sausage","shrimp","crab","lobster","oyster","clam","octopus","squid","whale","shark","dolphin","seal","penguin","flamingo","peacock","parrot","eagle","owl","bat","wolf","fox","bear","panda","koala","kangaroo","zebra","giraffe","elephant","rhino","hippo","lion","tiger","leopard","cheetah","monkey","gorilla","chimpanzee","orangutan","sloth","raccoon","skunk","beaver","otter","deer","moose","elk","reindeer","camel","llama","alpaca","sheep","goat","cow","pig","horse","donkey","mule","chicken","turkey","duck","goose","swan","pelican","stork","crane","heron","flamingo","peacock","ostrich","emu","kiwi","puffin","toucan","hummingbird","butterfly","bee","ant","spider","scorpion","snake","lizard","crocodile","alligator","turtle","frog","toad","salamander","newt","shark","whale","dolphin","octopus","jellyfish","starfish","seahorse","crab","lobster","shrimp","clam","oyster","snail","slug","worm","ladybug","dragonfly","grasshopper","cricket","beetle","fly","mosquito","butterfly","moth","bee","wasp","hornet","ant","termite","cockroach","flea","tick","louse","mite","spider","scorpion","centipede","millipede","earthworm","leech","jellyfish","coral","anemone","sponge","starfish","seaurchin","sanddollar","seashell","conch","nautilus","octopus","squid","cuttlefish","nautilus"];

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', (code, name, numRounds = 6) => {
    code = code.toUpperCase();
    if (rooms[code]) return socket.emit('errorMsg', 'Room already exists');
    numRounds = Math.max(3, Math.min(20, parseInt(numRounds))) || 6;

    rooms[code] = {
      code, players: {}, round: 0, maxRounds: numRounds, drawerIndex: 0,
      currentWord: null, currentDrawer: null, gameStarted: false,
      timer: null, roundStartTime: null, guessedPlayers: new Set()
    };
    joinPlayer(socket, code, name);
  });

  socket.on('joinRoom', (code, name) => {
    code = code.toUpperCase();
    if (!rooms[code]) return socket.emit('errorMsg', 'Room not found');
    if (Object.keys(rooms[code].players).length >= 12) return socket.emit('errorMsg', 'Room full');
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

  socket.on('chooseWord', (word) => {
    const room = Object.values(rooms).find(r => r.currentDrawer === socket.id);
    if (!room || !word) return;
    room.currentWord = word;
    room.guessedPlayers.clear();
    const hint = word.split('').map((l,i) => i%2===0 ? l : '_').join(' ');
    io.to(room.code).emit('wordHint', hint);
    startTimer(room.code);
  });

  socket.on('draw', data => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('draw', data);
  });
  socket.on('clearCanvas', () => {
    const roomCode = [...socket.rooms][1];
    if (roomCode) socket.to(roomCode).emit('clearCanvas');
  });

  socket.on('chatMessage', msg => {
    const room = Object.values(rooms).find(r => r.players[socket.id]);
    if (!room || !room.currentWord) return;
    // ... (your existing guessing logic)
    io.to(room.code).emit('message', { user: room.players[socket.id].name, text: msg });
  });

  function nextRound(code) {
    const room = rooms[code];
    if (!room) return;
    room.round++;
    if (room.round > room.maxRounds) return endGame(code);

    const ids = Object.keys(room.players);
    const drawerId = ids[room.drawerIndex % ids.length];
    room.currentDrawer = drawerId;
    room.currentWord = null;
    room.guessedPlayers.clear();

    io.to(code).emit('newRound', room.round, room.maxRounds, drawerId, room.players[drawerId].name);
    io.to(code).emit('clearCanvas');
    io.to(code).emit('wordHint', 'Waiting...');

    const choices = wordList.sort(() => 0.5 - Math.random()).slice(0, 3);
    io.to(drawerId).emit('yourTurn', choices);

    room.drawerIndex++;
  }

  function startTimer(code) {
    const room = rooms[code];
    let time = 80;
    clearInterval(room.timer);
    room.timer = setInterval(() => {
      io.to(code).emit('timer', time);
      if (--time < 0) {
        clearInterval(room.timer);
        io.to(code).emit('wordReveal', room.currentWord || "None");
        setTimeout(() => nextRound(code), 5000);
      }
    }, 1000);
  }

  function endGame(code) {
    const room = rooms[code];
    if (!room) return;
    const leaderboard = Object.values(room.players)
      .sort((a,b) => b.score - a.score)
      .map((p,i) => ({ rank: i+1, name: p.name, score: p.score }));
    io.to(code).emit('gameOver', leaderboard);
    delete rooms[code];
  }

  socket.on('disconnect', () => {
    // ... (your disconnect logic)
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));