// ===== BACKEND CONNECTION =====
const BACKEND_URL = 'https://scriible-backend.onrender.com'; // Change when you deploy
const socket = io(BACKEND_URL, { transports: ['websocket'] });

// ===== PALETTE =====
const PALETTE_COLORS = ["#000000","#e6194b","#3cb44b","#ffe119","#4363d8","#f58231","#911eb4","#46f0f0","#f032e6","#bcf60c","#fabebe","#008080","#e6beff","#9a6324","#fffac8","#800000","#aaffc3","#808000","#ffd8b1","#000075","#808080","#ffffff"];
const PALETTE_NAMES = { "#000000":"Black","#e6194b":"Red","#3cb44b":"Green","#ffe119":"Yellow","#4363d8":"Blue","#f58231":"Orange","#911eb4":"Purple","#46f0f0":"Cyan","#f032e6":"Magenta","#bcf60c":"Lime","#fabebe":"Pink","#008080":"Teal","#e6beff":"Lavender","#9a6324":"Brown","#fffac8":"Beige","#800000":"Maroon","#aaffc3":"Mint","#808000":"Olive","#ffd8b1":"Peach","#000075":"Navy","#808080":"Gray","#ffffff":"White"};

let selectedColor = "#000000";
let drawing = false;
let lastX = 0, lastY = 0;
let roomCode = null;
let currentMaxRounds = 6;

// Canvas setup (logical size for drawing)
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const LOGICAL_WIDTH = 800;
const LOGICAL_HEIGHT = 500;

canvas.width = LOGICAL_WIDTH;
canvas.height = LOGICAL_HEIGHT;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.lineWidth = 5;

// ===== RESPONSIVE CANVAS RESIZING =====
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scaleX = LOGICAL_WIDTH / rect.width;
  const scaleY = LOGICAL_HEIGHT / rect.height;

  // Only scale visually, not the drawing buffer
  const container = canvas.parentNode;
  const containerRect = container.getBoundingClientRect();
  const maxWidth = containerRect.width;
  const maxHeight = containerRect.height || 500;

  const ratio = Math.min(maxWidth / LOGICAL_WIDTH, maxHeight / LOGICAL_HEIGHT);
  canvas.style.width = (LOGICAL_WIDTH * ratio) + 'px';
  canvas.style.height = (LOGICAL_HEIGHT * ratio) + 'px';
}

// Run on load & resize
window.addEventListener('load', resizeCanvas);
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100); // Extra safety

// ===== COORDINATE SCALING =====
function getCoordinates(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = LOGICAL_WIDTH / rect.width;
  const scaleY = LOGICAL_HEIGHT / rect.height;

  let clientX, clientY;
  if (e.touches) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  } else {
    clientX = e.clientX;
    clientY = e.clientY;
  }

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

// ===== DRAWING FUNCTIONS =====
function drawLine(x0, y0, x1, y1, color, size, emit = true) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();

  if (emit) {
    socket.emit('draw', { x0, y0, x1, y1, color, size });
  }
}

// Mouse
canvas.addEventListener('mousedown', e => {
  drawing = true;
  const pos = getCoordinates(e);
  lastX = pos.x;
  lastY = pos.y;
});

canvas.addEventListener('mousemove', e => {
  if (!drawing) return;
  const pos = getCoordinates(e);
  const size = document.getElementById('brushSize').value;
  drawLine(lastX, lastY, pos.x, pos.y, selectedColor, size);
  lastX = pos.x;
  lastY = pos.y;
});

canvas.addEventListener('mouseup', () => drawing = false);
canvas.addEventListener('mouseout', () => drawing = false);

// Touch (Mobile)
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  drawing = true;
  const pos = getCoordinates(e);
  lastX = pos.x;
  lastY = pos.y;
});

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!drawing) return;
  const pos = getCoordinates(e);
  const size = document.getElementById('brushSize').value;
  drawLine(lastX, lastY, pos.x, pos.y, selectedColor, size);
  lastX = pos.x;
  lastY = pos.y;
});

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  drawing = false;
});

// ===== UI FUNCTIONS =====
function startGame() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  resizeCanvas();
}

function createRoom() {
  const name = document.getElementById('username').value.trim() || "Player";
  const rounds = Math.max(3, Math.min(20, parseInt(document.getElementById('numRounds').value) || 6));
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  document.getElementById('roomCode').value = code;
  socket.emit('createRoom', code, name, rounds);
}

function joinRoom() {
  const name = document.getElementById('username').value.trim() || "Player";
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!code) return document.getElementById('error').textContent = "Enter room code!";
  socket.emit('joinRoom', code, name);
}

window.createRoom = createRoom;
window.joinRoom = joinRoom;

// ===== COLOR PALETTE =====
const colorPaletteDiv = document.getElementById("colorPalette");
PALETTE_COLORS.forEach(col => {
  const btn = document.createElement('div');
  btn.className = "palette-swatch";
  btn.style.background = col;
  btn.title = PALETTE_NAMES[col];
  btn.onclick = () => {
    selectedColor = col;
    document.getElementById('colorPicker').value = col;
    [...colorPaletteDiv.children].forEach(c => c.classList.remove("selected"));
    btn.classList.add("selected");
    document.getElementById('colorNameDisplay').textContent = "Color: " + PALETTE_NAMES[col];
  };
  colorPaletteDiv.appendChild(btn);
  if (col === "#000000") btn.classList.add("selected");
});
document.getElementById('colorNameDisplay').textContent = "Color: Black";

document.getElementById('colorPicker').addEventListener('input', e => {
  selectedColor = e.target.value;
  [...colorPaletteDiv.children].forEach(c => c.classList.remove("selected"));
});

document.getElementById('brushSize').addEventListener('input', e => {
  ctx.lineWidth = e.target.value;
});

document.getElementById('clearBtn').onclick = () => {
  if (confirm("Clear canvas?")) {
    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    socket.emit('clearCanvas');
  }
};

// ===== SOCKET EVENTS =====
socket.on('connect', () => console.log('Connected!'));

socket.on('errorMsg', msg => {
  document.getElementById('error').textContent = msg;
  setTimeout(() => document.getElementById('error').textContent = "", 4000);
});

socket.on('roomJoined', (code, players, maxRounds) => {
  currentMaxRounds = maxRounds;
  roomCode = code;
  document.getElementById('roomDisplay').textContent = code;
  document.getElementById('roundInfo').textContent = `Round 0/${currentMaxRounds}`;
  startGame();
  updatePlayers(players);
});

socket.on('updatePlayers', players => updatePlayers(players));

socket.on('newRound', (round, maxRounds, drawerId, drawerName) => {
  document.getElementById('roundInfo').textContent = `Round ${round}/${maxRounds}`;
  addMessage('System', `${drawerName} is drawing!`);
  if (socket.id === drawerId) {
    document.getElementById('wordChoices').classList.remove('hidden');
  }
});

socket.on('yourTurn', choices => {
  const div = document.getElementById('wordChoices');
  div.innerHTML = '';
  choices.forEach(word => {
    const btn = document.createElement('button');
    btn.textContent = word;
    btn.onclick = () => {
      socket.emit('chooseWord', word);
      div.classList.add('hidden');
    };
    div.appendChild(btn);
  });
});

socket.on('wordHint', hint => document.getElementById('wordHint').textContent = hint);
socket.on('timer', time => document.getElementById('timer').textContent = time);
socket.on('clearCanvas', () => ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT));
socket.on('draw', data => drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size, false));
socket.on('message', msg => addMessage(msg.user, msg.text));
socket.on('correctGuess', (name, pts) => addMessage('System', `${name} guessed it! (+${pts} pts)`));
socket.on('wordReveal', word => addMessage('System', `Word was: ${word}`));
socket.on('gameOver', leaderboard => {
  let result = "Game Over!\n\n";
  leaderboard.forEach((p, i) => result += `${i+1}. ${p.name} → ${p.score} pts\n`);
  alert(result);
});

// ===== CHAT =====
function sendChat() {
  const input = document.getElementById('chatInput');
  if (input.value.trim()) {
    socket.emit('chatMessage', input.value.trim());
    input.value = '';
  }
}
document.getElementById('chatInput').addEventListener('keydown', e => e.key === 'Enter' && sendChat());
document.getElementById('chatSendBtn').onclick = sendChat;

function addMessage(user, text) {
  const div = document.createElement('div');
  div.innerHTML = `<strong>${user}:</strong> ${text}`;
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function updatePlayers(players) {
  const container = document.getElementById('players');
  container.innerHTML = '<h3 style="color:#FFA447;margin-bottom:8px;">Players</h3>';
  Object.values(players)
    .sort((a, b) => b.score - a.score)
    .forEach(p => {
      const div = document.createElement('div');
      div.className = 'player';
      div.textContent = `${p.name}${p.id === socket.id ? ' (you)' : ''} → ${p.score || 0} pts`;
      container.appendChild(div);
    });
}