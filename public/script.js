// public/script.js — FINAL, STABLE, FULLY COMPATIBLE WITH FIXED BACKEND

const BACKEND_URL = 'https://scriible-backend.onrender.com';

const socket = io(BACKEND_URL, {
  transports: ['websocket', 'polling'],
  timeout: 20000,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});

// ======================
// Canvas Setup
// ======================

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const LOGICAL_WIDTH = 800;
const LOGICAL_HEIGHT = 500;

canvas.width = LOGICAL_WIDTH;
canvas.height = LOGICAL_HEIGHT;

ctx.lineCap = "round";
ctx.lineJoin = "round";
ctx.lineWidth = 5;

function resizeCanvas() {
  const container = canvas.parentElement;
  const ratio = Math.min(
    container.clientWidth / LOGICAL_WIDTH,
    (window.innerHeight * 0.65) / LOGICAL_HEIGHT
  );
  canvas.style.width = LOGICAL_WIDTH * ratio + "px";
  canvas.style.height = LOGICAL_HEIGHT * ratio + "px";
}

window.addEventListener("load", resizeCanvas);
window.addEventListener("resize", resizeCanvas);

// ======================
// Drawing logic
// ======================

let drawing = false;
let lastX = 0, lastY = 0;
let selectedColor = "#000000";

function getCoordinates(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = LOGICAL_WIDTH / rect.width;
  const scaleY = LOGICAL_HEIGHT / rect.height;

  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;

  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function drawLine(x0, y0, x1, y1, color, size, emit = true) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
  ctx.closePath();

  if (emit) {
    socket.emit("draw", { x0, y0, x1, y1, color, size });
  }
}

["mousedown", "touchstart"].forEach(ev => {
  canvas.addEventListener(ev, e => {
    e.preventDefault();
    drawing = true;
    const pos = getCoordinates(e);
    lastX = pos.x;
    lastY = pos.y;
  });
});

["mousemove", "touchmove"].forEach(ev => {
  canvas.addEventListener(ev, e => {
    if (!drawing) return;
    e.preventDefault();
    const pos = getCoordinates(e);
    drawLine(lastX, lastY, pos.x, pos.y, selectedColor, ctx.lineWidth);
    lastX = pos.x;
    lastY = pos.y;
  });
});

["mouseup", "mouseout", "touchend", "touchcancel"].forEach(ev => {
  canvas.addEventListener(ev, () => (drawing = false));
});

// ======================
// UI Logic
// ======================

function startGame() {
  document.getElementById("menu").classList.add("hidden");
  document.getElementById("game").classList.remove("hidden");
  resizeCanvas();
}

window.createRoom = function () {
  const name = document.getElementById("username").value.trim() || "Player";
  const rounds = parseInt(document.getElementById("numRounds").value) || 6;
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  document.getElementById("roomCode").value = code;
  socket.emit("createRoom", code, name, rounds);
};

window.joinRoom = function () {
  const name = document.getElementById("username").value.trim() || "Player";
  const code = document.getElementById("roomCode").value.trim().toUpperCase();
  if (!code)
    return (document.getElementById("error").textContent = "Enter room code!");

  socket.emit("joinRoom", code, name);
};

// ======================
// Color Picker
// ======================

document.getElementById("colorPicker").addEventListener("input", e => {
  selectedColor = e.target.value;
});

document.getElementById("brushSize").addEventListener("input", e => {
  ctx.lineWidth = e.target.value;
});

document.getElementById("clearBtn").onclick = () => {
  if (confirm("Clear canvas?")) {
    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    socket.emit("clearCanvas");
  }
};

// ======================
// Player List
// ======================

function updatePlayers(players) {
  const container = document.getElementById("players");
  container.innerHTML = `<h3 style="color:#FFA447;margin-bottom:6px;">Players</h3>`;

  players
    .sort((a, b) => b.score - a.score)
    .forEach(p => {
      const div = document.createElement("div");
      div.textContent = `${p.name}${p.id === socket.id ? " (you)" : ""} → ${p.score} pts`;
      if (p.id === socket.id) div.style.fontWeight = "bold";
      container.appendChild(div);
    });
}

// ======================
// Chat
// ======================

document.getElementById("chatSendBtn").onclick = sendChat;

document.getElementById("chatInput").addEventListener("keydown", e => {
  if (e.key === "Enter") sendChat();
});

function sendChat() {
  const input = document.getElementById("chatInput");
  if (input.value.trim()) {
    socket.emit("chatMessage", input.value.trim());
    input.value = "";
  }
}

function addMessage(user, text) {
  const div = document.createElement("div");
  div.innerHTML = `<strong>${user}:</strong> ${text}`;
  div.style.marginBottom = "6px";

  const msgBox = document.getElementById("messages");
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
}

// ======================
// Socket Events
// ======================

socket.on("connect", () => console.log("Connected to server"));

socket.on("roomJoined", (code, players, maxRounds) => {
  document.getElementById("roomDisplay").textContent = code;
  document.getElementById("roundInfo").textContent = `Round 0/${maxRounds}`;

  startGame();
  updatePlayers(players);
});

socket.on("updatePlayers", players => updatePlayers(players));

socket.on("newRound", (round, maxRounds, drawerId, drawerName) => {
  document.getElementById("roundInfo").textContent = `Round ${round}/${maxRounds}`;
  addMessage("System", `${drawerName} is drawing!`);

  if (socket.id === drawerId) {
    document.getElementById("wordChoices").classList.remove("hidden");
  }
});

socket.on("yourTurn", choices => {
  const container = document.getElementById("wordChoices");
  container.innerHTML = "";

  choices.forEach(w => {
    const btn = document.createElement("button");
    btn.textContent = w.toUpperCase();
    btn.onclick = () => {
      socket.emit("chooseWord", w);
      container.classList.add("hidden");
    };
    container.appendChild(btn);
  });
});

socket.on("wordHint", hint => {
  document.getElementById("wordHint").textContent = hint;
});

socket.on("timer", t => {
  document.getElementById("timer").textContent = t;
});

socket.on("clearCanvas", () => {
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
});

socket.on("draw", d => {
  drawLine(d.x0, d.y0, d.x1, d.y1, d.color, d.size, false);
});

socket.on("message", m => addMessage(m.user, m.text));

socket.on("wordReveal", w => {
  addMessage("System", `Word was: <strong>${w.toUpperCase()}</strong>`);
});

socket.on("gameOver", leaderboard => {
  let txt = "Game Over! Leaderboard:\n\n";
  leaderboard.forEach(p => {
    txt += `${p.rank}. ${p.name} → ${p.score} pts\n`;
  });
  alert(txt);

  location.reload();
});

socket.on("errorMsg", msg => {
  document.getElementById("error").textContent = msg;
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
});
