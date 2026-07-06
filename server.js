const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 8;
const TICK_MS = 50; // 20 Hz state broadcast

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const COLORS = ['#ff4757', '#2ed3f7', '#ffd32a', '#7bed9f', '#ff7f50', '#c56cf0', '#f8f8f8', '#3ae374'];

// pin -> room
const rooms = new Map();
let nextClientId = 1;

function genPin() {
  for (let i = 0; i < 1000; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(pin)) return pin;
  }
  return null;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId = null) {
  for (const p of room.players.values()) {
    if (p.id !== exceptId) send(p.ws, msg);
  }
}

function playerList(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, color: p.color, model: p.model, isHost: p.id === room.hostId,
  }));
}

function leaveRoom(client) {
  const room = client.room;
  if (!room) return;
  room.players.delete(client.id);
  client.room = null;
  if (room.players.size === 0) {
    rooms.delete(room.pin);
    return;
  }
  if (room.hostId === client.id) {
    room.hostId = room.players.keys().next().value;
  }
  broadcast(room, { type: 'player_left', id: client.id, players: playerList(room) });
  // If the leaver was the last driver still racing, end the race
  if (room.state === 'racing' && [...room.players.values()].every(q => q.finished)) {
    room.state = 'finished';
    const standings = [...room.players.values()]
      .filter(q => q.finished)
      .sort((a, b) => a.finishTime - b.finishTime)
      .map(q => ({ id: q.id, name: q.name, color: q.color, timeMs: q.finishTime }));
    broadcast(room, { type: 'race_over', standings });
  }
}

wss.on('connection', (ws) => {
  const client = { id: nextClientId++, ws, room: null, name: '' };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = client.room;

    switch (msg.type) {
      case 'host': {
        if (client.room) return;
        const pin = genPin();
        if (!pin) { send(ws, { type: 'error', message: 'Server full, try again.' }); return; }
        client.name = String(msg.name || 'Player').slice(0, 16) || 'Player';
        const newRoom = {
          pin,
          state: 'lobby',
          hostId: client.id,
          players: new Map(),
        };
        const player = makePlayer(client, newRoom, msg);
        newRoom.players.set(client.id, player);
        rooms.set(pin, newRoom);
        client.room = newRoom;
        send(ws, { type: 'hosted', pin, id: client.id, players: playerList(newRoom) });
        break;
      }

      case 'join': {
        if (client.room) return;
        const target = rooms.get(String(msg.pin || ''));
        if (!target) { send(ws, { type: 'error', message: 'No session found with that PIN.' }); return; }
        if (target.state !== 'lobby') { send(ws, { type: 'error', message: 'Race already in progress.' }); return; }
        if (target.players.size >= MAX_PLAYERS) { send(ws, { type: 'error', message: 'Session is full (8 players max).' }); return; }
        client.name = String(msg.name || 'Player').slice(0, 16) || 'Player';
        const player = makePlayer(client, target, msg);
        target.players.set(client.id, player);
        client.room = target;
        send(ws, { type: 'joined', pin: target.pin, id: client.id, players: playerList(target) });
        broadcast(target, { type: 'player_joined', players: playerList(target) }, client.id);
        break;
      }

      case 'start': {
        if (!room || room.hostId !== client.id || room.state !== 'lobby') return;
        room.state = 'racing';
        for (const p of room.players.values()) {
          p.lap = 0; p.idx = 0; p.finished = false; p.finishTime = null;
          p.x = 0; p.y = 0; p.angle = 0;
        }
        const now = Date.now();
        broadcast(room, {
          type: 'race_start',
          serverNow: now,
          startAt: now + 3800, // 3-2-1-GO countdown
          grid: [...room.players.keys()], // grid order = join order
        });
        break;
      }

      case 'state': {
        if (!room || room.state !== 'racing') return;
        const p = room.players.get(client.id);
        if (!p || p.finished) return;
        p.x = +msg.x || 0; p.y = +msg.y || 0; p.angle = +msg.angle || 0;
        p.speed = +msg.speed || 0;
        p.lap = msg.lap | 0; p.idx = msg.idx | 0;
        p.drift = !!msg.drift;
        break;
      }

      case 'finish': {
        if (!room || room.state !== 'racing') return;
        const p = room.players.get(client.id);
        if (!p || p.finished) return;
        p.finished = true;
        p.finishTime = +msg.timeMs || 0;
        const standings = [...room.players.values()]
          .filter(q => q.finished)
          .sort((a, b) => a.finishTime - b.finishTime)
          .map(q => ({ id: q.id, name: q.name, color: q.color, timeMs: q.finishTime }));
        broadcast(room, { type: 'standings', standings });
        if ([...room.players.values()].every(q => q.finished)) {
          room.state = 'finished';
          broadcast(room, { type: 'race_over', standings });
        }
        break;
      }

      case 'back_to_lobby': {
        if (!room || room.hostId !== client.id) return;
        room.state = 'lobby';
        broadcast(room, { type: 'lobby_return', players: playerList(room) });
        break;
      }
    }
  });

  ws.on('close', () => leaveRoom(client));
  ws.on('error', () => {});
});

function makePlayer(client, room, msg) {
  let color = String(msg.color || '');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    const used = new Set([...room.players.values()].map(p => p.color));
    color = COLORS.find(c => !used.has(c)) || COLORS[room.players.size % COLORS.length];
  }
  const model = String(msg.model || 'cruiser').slice(0, 20);
  return {
    id: client.id, ws: client.ws, name: client.name, color, model,
    x: 0, y: 0, angle: 0, speed: 0, lap: 0, idx: 0, drift: false,
    finished: false, finishTime: null,
  };
}

// Broadcast car states for racing rooms at 20 Hz
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.state !== 'racing') continue;
    const cars = [...room.players.values()].map(p => ({
      id: p.id, x: p.x, y: p.y, angle: p.angle, speed: p.speed,
      lap: p.lap, idx: p.idx, drift: p.drift, finished: p.finished,
    }));
    broadcast(room, { type: 'states', t: Date.now(), cars });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Race sim running at http://localhost:${PORT}`);
  console.log('Players on your network can join via your machine\'s local IP.');
});
