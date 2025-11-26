// ===== CONNECT TO BACKEND (LOCALHOST) =====
const BACKEND_URL = 'https://scriible-backend.onrender.com';
const socket = io(BACKEND_URL, { transports: ['websocket'] });

// ===== PALETTE INFO =====
const PALETTE_COLORS = [
  "#000000", "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324",
  "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1", "#000075", "#808080", "#ffffff"
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

// ===== CANVAS & CONTROLS =====
let drawing = false;
let lastX = 0, lastY = 0;
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.lineWidth = 5;

// ====== UI/ROOM =====
let roomCode = null;
function startGame() {
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
}
function createRoom() {
  const name = document.getElementById('username').value.trim() || "Player";
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  document.getElementById('roomCode').value = code;
  socket.emit('createRoom', code, name);
}
function joinRoom() {
  const name = document.getElementById('username').value.trim() || "Player";
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!code) return alert("Enter room code");
  socket.emit('joinRoom', code, name);
}
window.createRoom = createRoom;
window.joinRoom = joinRoom;

// ===== DRAWING TOOL AREA =====
// Build palette dynamically
const colorPaletteDiv = document.getElementById("colorPalette");
PALETTE_COLORS.forEach(col => {
  const btn = document.createElement('div');
  btn.className = "palette-swatch";
  btn.style.background = col;
  btn.title = PALETTE_NAMES[col];
  btn.tabIndex = 0;
  btn.onclick = () => {
    selectedColor = col;
    document.getElementById('colorPicker').value = col;
    [...colorPaletteDiv.children].forEach(c => c.classList.remove("selected"));
    btn.classList.add("selected");
    showColorName(col);
  };
  colorPaletteDiv.appendChild(btn);
  if (col === selectedColor) btn.classList.add("selected");
});
function showColorName(hex) {
  let el = document.getElementById('colorNameDisplay');
  if (!el) {
    el = document.createElement('div');
    el.id = "colorNameDisplay";
    el.style = "margin-top:3px;font-weight:500;color:#FFA447";
    colorPaletteDiv.after(el);
  }
  el.textContent = "Brush color: " + (PALETTE_NAMES[hex] || hex);
}
showColorName(selectedColor);

// Color picker integration
document.getElementById('colorPicker').addEventListener('input', e => {
  selectedColor = e.target.value;
  // Deselect palette swatches if custom
  [...colorPaletteDiv.children].forEach(c => {
    c.classList.toggle("selected", c.style.backgroundColor.replace(/ /g,'').toLowerCase() === selectedColor.toLowerCase());
  });
  showColorName(selectedColor);
});
document.getElementById("colorPicker").value = selectedColor;
document.getElementById('brushSize').addEventListener('input', e => {
  ctx.lineWidth = e.target.value;
});
document.getElementById('clearBtn').onclick = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit('clearCanvas');
};

// ===== DRAWING LOGIC =====
function drawLine(x0, y0, x1, y1, color, size, emit = true) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
  ctx.closePath();
  if (emit) socket.emit('draw', { x0, y0, x1, y1, color, size });
}
// Mouse
canvas.addEventListener('mousedown', (e) => {
  drawing = true;
  [lastX, lastY] = [e.offsetX, e.offsetY];
});
canvas.addEventListener('mousemove', (e) => {
  if (!drawing) return;
  const size = document.getElementById('brushSize').value;
  drawLine(lastX, lastY, e.offsetX, e.offsetY, selectedColor, size);
  [lastX, lastY] = [e.offsetX, e.offsetY];
});
canvas.addEventListener('mouseup', () => drawing = false);
canvas.addEventListener('mouseout', () => drawing = false);
// Touch/mobile
canvas.addEventListener('touchstart', (e) => {
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  drawing = true;
  lastX = touch.clientX - rect.left;
  lastY = touch.clientY - rect.top;
  e.preventDefault();
});
canvas.addEventListener('touchmove', (e) => {
  if (!drawing) return;
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const size = document.getElementById('brushSize').value;
  drawLine(lastX, lastY, touch.clientX - rect.left, touch.clientY - rect.top, selectedColor, size);
  lastX = touch.clientX - rect.left;
  lastY = touch.clientY - rect.top;
  e.preventDefault();
});
canvas.addEventListener('touchend', () => drawing = false);

// ===== SOCKET EVENTS =====
socket.on('connect', () => console.log('Connected!'));
socket.on('errorMsg', msg => {
  document.getElementById('error').textContent = msg;
});
socket.on('roomJoined', (code, players) => {
  roomCode = code;
  document.getElementById('roomDisplay').textContent = code;
  startGame();
  updatePlayers(players);
});
socket.on('updatePlayers', players => updatePlayers(players));
socket.on('newRound', (round, drawerId, drawerName) => {
  document.getElementById('roundInfo').textContent = `Round ${round}/6`;
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
socket.on('wordHint', hint => {
  document.getElementById('wordHint').textContent = hint;
});
socket.on('timer', time => document.getElementById('timer').textContent = time);
socket.on('clearCanvas', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
socket.on('draw', data => drawLine(data.x0, data.y0, data.x1, data.y1, data.color, data.size, false));
socket.on('message', msg => addMessage(msg.user, msg.text));
socket.on('correctGuess', (name, pts) => addMessage('System', `${name} guessed it! (+${pts} pts)`));
socket.on('wordReveal', word => addMessage('System', `Word was: ${word}`));
socket.on('gameOver', leaderboard => {
  alert(
    "Game Over!\n" +
    leaderboard.map((p, i) => `${i + 1}. ${p.name} - ${p.score}`).join('\n')
  );
});

// ===== CHAT & USERS =====
function sendChat() {
  const input = document.getElementById('chatInput');
  if (input.value.trim().length > 0) {
    socket.emit('chatMessage', input.value.trim());
    input.value = '';
  }
}

document.getElementById('chatInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendChat();
});
document.getElementById('chatSendBtn').addEventListener('click', sendChat);

function addMessage(user, text) {
  const div = document.createElement('div');
  div.innerHTML = `<strong>${user}:</strong> ${text}`;
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView();
}
function updatePlayers(players) {
  const container = document.getElementById('players');
  container.innerHTML = '';
  Object.values(players).forEach(p => {
    const div = document.createElement('div');
    div.className = "player";
    div.textContent = `${p.name}${p.id === socket.id ? ' (you)' : ''} - ${p.score || 0}`;
    container.appendChild(div);
  });
}
