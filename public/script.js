const BACKEND_URL = 'https://scriible-backend.onrender.com';
const socket = io(BACKEND_URL, { transports: ['websocket'] });

const PALETTE_COLORS = [
  "#000000","#e6194b","#3cb44b","#ffe119","#4363d8","#f58231","#911eb4",
  "#46f0f0","#f032e6","#bcf60c","#fabebe","#008080","#e6beff","#9a6324",
  "#fffac8","#800000","#aaffc3","#808000","#ffd8b1","#000075","#808080","#ffffff"
];

const PALETTE_NAMES = {
  "#000000": "Black", "#e6194b": "Red", "#3cb44b": "Green", "#ffe119": "Yellow",
  "#4363d8": "Blue", "#f58231": "Orange", "#911eb4": "Purple", "#46f0f0": "Cyan",
  "#f032e6": "Magenta", "#bcf60c": "Lime", "#fabebe": "Pink", "#008080": "Teal",
  "#e6beff": "Lavender", "#9a6324": "Brown", "#fffac8": "Beige", "#800000": "Maroon",
  "#aaffc3": "Mint", "#808000": "Olive", "#ffd8b1": "Peach", "#000075": "Navy",
  "#808080": "Gray", "#ffffff": "White"
};

let selectedColor = "#000000";
let drawing = false;
let lastX = 0, lastY = 0;
let roomCode = null;
let currentMaxRounds = 6;

// Canvas
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const LOGICAL_WIDTH = 800;
const LOGICAL_HEIGHT = 500;
canvas.width = LOGICAL_WIDTH;
canvas.height = LOGICAL_HEIGHT;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.lineWidth = 5;

// Responsive
function resizeCanvas() {
  const container = canvas.parentElement;
  const ratio = Math.min(container.clientWidth / LOGICAL_WIDTH, (window.innerHeight * 0.65) / LOGICAL_HEIGHT);
  canvas.style.width = LOGICAL_WIDTH * ratio + 'px';
  canvas.style.height = LOGICAL_HEIGHT * ratio + 'px';
}
window.addEventListener('load', resizeCanvas);
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

function getCoordinates(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = LOGICAL_WIDTH / rect.width;
  const scaleY = LOGICAL_HEIGHT / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function drawLine(x0, y0, x1, y1, color, size, emit = true) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
  if (emit) socket.emit('draw', { x0, y0, x1, y1, color, size });
}

// Touch & Mouse
['mousedown', 'touchstart'].forEach(ev => canvas.addEventListener(ev, e => {
  e.preventDefault(); drawing = true; const p = getCoordinates(e); lastX = p.x; lastY = p.y;
}));
['mousemove', 'touchmove'].forEach(ev => canvas.addEventListener(ev, e => {
  if (!drawing) return;
  e.preventDefault();
  const p = getCoordinates(e);
  drawLine(lastX, lastY, p.x, p.y, selectedColor, ctx.lineWidth);
  lastX = p.x; lastY = p.y;
}));
['mouseup', 'mouseout', 'touchend', 'touchcancel'].forEach(ev => canvas.addEventListener(ev, () => drawing = false));

// UI Functions
function startGame() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  resizeCanvas();
}

function createRoom() {
  const name = document.getElementById('username').value.trim() || 'Player';
  const rounds = Math.max(3, Math.min(20, parseInt(document.getElementById('numRounds').value) || 6));
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  document.getElementById('roomCode').value = code;
  socket.emit('createRoom', code, name, rounds);
}

function joinRoom() {
  const name = document.getElementById('username').value.trim() || 'Player';
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!code) return document.getElementById('error').textContent = 'Enter room code!';
  socket.emit('joinRoom', code, name);
}
window.createRoom = createRoom;
window.joinRoom = joinRoom;

// Color Palette
const paletteDiv = document.getElementById('colorPalette');
PALETTE_COLORS.forEach(c => {
  const s = document.createElement('div');
  s.className = 'palette-swatch';
  s.style.background = c;
  s.title = PALETTE_NAMES[c];
  s.onclick = () => {
    selectedColor = c;
    document.getElementById('colorPicker').value = c;
    document.querySelectorAll('.palette-swatch').forEach(x => x.classList.remove('selected'));
    s.classList.add('selected');
    document.getElementById('colorNameDisplay').textContent = 'Color: ' + PALETTE_NAMES[c];
  };
  paletteDiv.appendChild(s);
  if (c === '#000000') s.classList.add('selected');
});
document.getElementById('colorNameDisplay').textContent = 'Color: Black';
document.getElementById('colorPicker').addEventListener('input', e => selectedColor = e.target.value);
document.getElementById('brushSize').addEventListener('input', e => ctx.lineWidth = e.target.value);
document.getElementById('clearBtn').onclick = () => {
  if (confirm('Clear canvas?')) {
    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    socket.emit('clearCanvas');
  }
};

// Player List — NOW SORTED + SHOWS (you)
function updatePlayers(players) {
  const container = document.getElementById('players');
  container.innerHTML = '<h3 style="color:#FFA447;margin:0 0 8px 0;">Players</h3>';
  
  Object.values(players)
    .sort((a, b) => b.score - a.score)
    .forEach(p => {
      const div = document.createElement('div');
      div.className = 'player';
      div.textContent = `${p.name}${p.id === socket.id ? ' (you)' : ''} → ${p.score} pts`;
      if (p.id === socket.id) div.style.fontWeight = 'bold';
      container.appendChild(div);
    });
}

// Socket Events
socket.on('roomJoined', (code, players, maxRounds) => {
  currentMaxRounds = maxRounds;
  roomCode = code;
  document.getElementById('roomDisplay').textContent = code;
  document.getElementById('roundInfo').textContent = `Round 0/${maxRounds}`;
  startGame();
  updatePlayers(players);
});

socket.on('updatePlayers', players => updatePlayers(players));

socket.on('newRound', (round, maxRounds, drawerId, drawerName) => {
  document.getElementById('roundInfo').textContent = `Round ${round}/${maxRounds}`;
  addMessage('System', `${drawerName} is drawing!`);
  if (socket.id === drawerId) document.getElementById('wordChoices').classList.remove('hidden');
});

socket.on('yourTurn', choices => {
  const d = document.getElementById('wordChoices');
  d.innerHTML = '';
  choices.forEach(w => {
    const b = document.createElement('button');
    b.textContent = w;
    b.onclick = () => { socket.emit('chooseWord', w); d.classList.add('hidden'); };
    d.appendChild(b);
  });
});

socket.on('wordHint', h => document.getElementById('wordHint').textContent = h);
socket.on('timer', t => document.getElementById('timer').textContent = t);
socket.on('clearCanvas', () => ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT));
socket.on('draw', d => drawLine(d.x0, d.y0, d.x1, d.y1, d.color, d.size, false));

socket.on('message', m => addMessage(m.user, m.text));
socket.on('correctGuess', (name, pts) => addMessage('System', `${name} guessed it! (+${pts} pts)`));
socket.on('wordReveal', w => addMessage('System', `Word was: ${w}`));
socket.on('gameOver', lb => {
  let txt = 'Game Over!\n\n';
  lb.forEach((p, i) => txt += `${i + 1}. ${p.name} → ${p.score} pts\n`);
  alert(txt);
});

// Chat
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
  div.style.marginBottom = '6px';
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}