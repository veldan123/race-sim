'use strict';

/* ================= Car catalog ================= */
// stats: maxSpd/accel in world px/s, turn in rad/s, grip = lateral damping
const CARS = {
  cruiser: { name: 'Cruiser',   maxSpd: 680, accel: 560, turn: 2.50, grip: 6.5, basic: true },
  falcon:  { name: 'Falcon RS', maxSpd: 705, accel: 720, turn: 2.55, grip: 6.9 },
  viper:   { name: 'Viper GT',  maxSpd: 800, accel: 610, turn: 2.50, grip: 6.6 },
  ghost:   { name: 'Ghost X1',  maxSpd: 720, accel: 630, turn: 2.95, grip: 8.4 },
  apex:    { name: 'Apex Prime', maxSpd: 810, accel: 700, turn: 2.85, grip: 7.9 },
};
const CAR_ORDER = ['cruiser', 'falcon', 'viper', 'ghost', 'apex'];
const BOX_COST = 100;
const WIN_REWARD = 10;
const COLORS = ['#ff4757', '#2ed3f7', '#ffd32a', '#7bed9f', '#ff7f50', '#c56cf0', '#f8f8f8', '#3ae374'];

/* ================= Player profile (localStorage) ================= */
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
let coins = loadJSON('apexrush-coins', 0);
let garage = loadJSON('apexrush-garage', ['cruiser']);
if (!garage.includes('cruiser')) garage.unshift('cruiser');
let selCar = localStorage.getItem('apexrush-car') || 'cruiser';
if (!garage.includes(selCar)) selCar = 'cruiser';
let selColor = localStorage.getItem('apexrush-color') || COLORS[0];
if (!COLORS.includes(selColor)) selColor = COLORS[0];

function saveProfile() {
  localStorage.setItem('apexrush-coins', JSON.stringify(coins));
  localStorage.setItem('apexrush-garage', JSON.stringify(garage));
  localStorage.setItem('apexrush-car', selCar);
  localStorage.setItem('apexrush-color', selColor);
}

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);
const screens = {
  menu: $('screen-menu'),
  garage: $('screen-garage'),
  lobby: $('screen-lobby'),
  game: $('screen-game'),
};
function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('active', k === name);
}
let toastTimer = null;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ================= Track (long night circuit) ================= */
const TRACK_HALF_W = 58;
const LAPS = 3;

const CONTROL = [
  [700, 620], [1700, 400], [2600, 560], [3200, 320], [4000, 430],
  [4620, 800], [4720, 1500], [4300, 1950], [4560, 2480], [4120, 3000],
  [3300, 3160], [2720, 2820], [2180, 3060], [1500, 3220], [820, 2920],
  [460, 2300], [720, 1800], [400, 1150],
];

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

const PTS = [];
{
  const n = CONTROL.length, SAMPLES = 22;
  for (let i = 0; i < n; i++) {
    const p0 = CONTROL[(i - 1 + n) % n], p1 = CONTROL[i];
    const p2 = CONTROL[(i + 1) % n], p3 = CONTROL[(i + 2) % n];
    for (let s = 0; s < SAMPLES; s++) PTS.push(catmullRom(p0, p1, p2, p3, s / SAMPLES));
  }
}
const N = PTS.length;
let TRACK_LEN = 0;
for (let i = 0; i < N; i++) {
  const a = PTS[i], b = PTS[(i + 1) % N];
  TRACK_LEN += Math.hypot(b[0] - a[0], b[1] - a[1]);
}
const SPACING = TRACK_LEN / N; // avg px between samples

function trackDir(i) {
  const a = PTS[((i % N) + N) % N], b = PTS[(((i + 1) % N) + N) % N];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}
function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const TB = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };
for (const p of PTS) {
  TB.minX = Math.min(TB.minX, p[0]); TB.maxX = Math.max(TB.maxX, p[0]);
  TB.minY = Math.min(TB.minY, p[1]); TB.maxY = Math.max(TB.maxY, p[1]);
}

/* ================= Net ================= */
let ws = null;
let myId = null;
let isHost = false;
let roomPin = null;
let roster = [];            // [{id,name,color,model,isHost}]
let serverOffset = 0;

function rosterById(id) { return roster.find(p => p.id === id); }

function connect(onOpen) {
  if (ws && ws.readyState === 1) { onOpen(); return; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = onOpen;
  ws.onmessage = (ev) => handleMsg(JSON.parse(ev.data));
  ws.onclose = () => {
    if (phase !== 'menu' && mode === 'multi') {
      toast('Connection lost.');
      setTimeout(() => location.reload(), 1600);
    }
  };
}
function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function handleMsg(msg) {
  switch (msg.type) {
    case 'hosted':
    case 'joined':
      myId = msg.id;
      roomPin = msg.pin;
      roster = msg.players;
      isHost = rosterById(myId)?.isHost || false;
      enterLobby();
      break;

    case 'player_joined':
      roster = msg.players;
      renderLobby();
      toast(`${roster[roster.length - 1].name} joined`);
      break;

    case 'player_left': {
      const gone = rosterById(msg.id);
      roster = msg.players;
      isHost = rosterById(myId)?.isHost || false;
      delete remoteCars[msg.id];
      renderLobby();
      if (gone) toast(`${gone.name} left`);
      break;
    }

    case 'race_start':
      serverOffset = msg.serverNow - Date.now();
      startRace(msg.grid, msg.startAt - serverOffset);
      break;

    case 'states':
      onStates(msg);
      break;

    case 'standings':
      standings = msg.standings;
      checkWinReward();
      renderResults(false);
      break;

    case 'race_over':
      standings = msg.standings;
      checkWinReward();
      renderResults(true);
      break;

    case 'lobby_return':
      roster = msg.players;
      isHost = rosterById(myId)?.isHost || false;
      phase = 'lobby';
      $('results').classList.add('hidden');
      $('hud').classList.add('hidden');
      enterLobby();
      break;

    case 'error':
      if (phase === 'menu') $('menu-error').textContent = msg.message;
      else toast(msg.message);
      break;
  }
}

/* ================= Menu / Lobby / Garage UI ================= */
let phase = 'menu'; // menu | garage | lobby | race
let mode = 'multi'; // multi | solo

function getName() {
  const name = $('name-input').value.trim();
  if (!name) { $('menu-error').textContent = 'Enter a driver name first.'; return null; }
  localStorage.setItem('apexrush-name', name);
  return name;
}
$('name-input').value = localStorage.getItem('apexrush-name') || '';

function updateMenuCar() {
  $('menu-car-name').textContent = CARS[selCar].name;
  $('menu-car-color').style.background = selColor;
}
updateMenuCar();

$('btn-host').onclick = () => {
  const name = getName();
  if (!name) return;
  $('menu-error').textContent = '';
  mode = 'multi';
  connect(() => send({ type: 'host', name, color: selColor, model: selCar }));
};
$('btn-join').onclick = () => {
  const name = getName();
  if (!name) return;
  const pin = $('pin-input').value.trim();
  if (!/^\d{6}$/.test(pin)) { $('menu-error').textContent = 'PIN must be 6 digits.'; return; }
  $('menu-error').textContent = '';
  mode = 'multi';
  connect(() => send({ type: 'join', pin, name, color: selColor, model: selCar }));
};
$('btn-solo').onclick = () => {
  const name = getName();
  if (!name) return;
  $('menu-error').textContent = '';
  startSolo(name);
};
$('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-start').onclick = () => send({ type: 'start' });
$('btn-leave').onclick = () => location.reload();
$('btn-lobby').onclick = () => send({ type: 'back_to_lobby' });
$('btn-menu').onclick = () => {
  phase = 'menu';
  aiCars = [];
  $('results').classList.add('hidden');
  $('hud').classList.add('hidden');
  updateMenuCar();
  showScreen('menu');
};

/* ---- Garage ---- */
$('btn-garage').onclick = () => {
  phase = 'garage';
  renderGarage();
  showScreen('garage');
};
$('garage-back').onclick = () => {
  phase = 'menu';
  updateMenuCar();
  showScreen('menu');
};

const STAT_MAX = {
  maxSpd: Math.max(...CAR_ORDER.map(id => CARS[id].maxSpd)),
  accel: Math.max(...CAR_ORDER.map(id => CARS[id].accel)),
  hdl: Math.max(...CAR_ORDER.map(id => CARS[id].turn * CARS[id].grip)),
};

function statBars(c) {
  const rows = [
    ['SPD', c.maxSpd / STAT_MAX.maxSpd],
    ['ACC', c.accel / STAT_MAX.accel],
    ['HDL', (c.turn * c.grip) / STAT_MAX.hdl],
  ];
  const wrap = document.createElement('div');
  wrap.className = 'car-stats';
  for (const [label, v] of rows) {
    const row = document.createElement('div');
    row.className = 'stat-row';
    const lab = document.createElement('span');
    lab.className = 'stat-label';
    lab.textContent = label;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = Math.round(v * 100) + '%';
    bar.appendChild(fill);
    row.appendChild(lab); row.appendChild(bar);
    wrap.appendChild(row);
  }
  return wrap;
}

function renderGarage() {
  $('garage-coins').textContent = coins;

  const list = $('car-list');
  list.innerHTML = '';
  for (const id of CAR_ORDER) {
    const c = CARS[id];
    const owned = garage.includes(id);
    const card = document.createElement('button');
    card.className = 'car-card' + (id === selCar ? ' selected' : '') + (owned ? '' : ' locked');
    card.type = 'button';

    const idBox = document.createElement('div');
    idBox.className = 'car-id';
    const nm = document.createElement('span');
    nm.className = 'car-name';
    nm.textContent = c.name;
    const tag = document.createElement('span');
    if (id === selCar) { tag.className = 'car-tag sel'; tag.textContent = 'SELECTED'; }
    else if (owned) { tag.className = 'car-tag owned'; tag.textContent = c.basic ? 'STARTER CAR' : 'OWNED'; }
    else { tag.className = 'car-tag lock'; tag.textContent = 'LOCKED — MYSTERY BOX'; }
    idBox.appendChild(nm); idBox.appendChild(tag);

    card.appendChild(idBox);
    card.appendChild(statBars(c));
    card.onclick = () => {
      if (!owned) { toast('Locked — open a Mystery Box to unlock faster cars.'); return; }
      selCar = id;
      saveProfile();
      renderGarage();
    };
    list.appendChild(card);
  }

  const pool = CAR_ORDER.filter(id => !garage.includes(id));
  const boxBtn = $('btn-box');
  boxBtn.disabled = pool.length === 0;
  boxBtn.querySelector('span').textContent = pool.length === 0 ? 'All cars unlocked' : 'Mystery Box';

  const colors = $('color-list');
  colors.innerHTML = '';
  for (const col of COLORS) {
    const dot = document.createElement('button');
    dot.className = 'color-dot' + (col === selColor ? ' selected' : '');
    dot.type = 'button';
    dot.style.background = col;
    dot.setAttribute('aria-label', 'Car color ' + col);
    dot.onclick = () => { selColor = col; saveProfile(); renderGarage(); };
    colors.appendChild(dot);
  }
}

$('btn-box').onclick = () => {
  const pool = CAR_ORDER.filter(id => !garage.includes(id));
  if (!pool.length) return;
  if (coins < BOX_COST) {
    toast(`Not enough coins — you have ${coins}, the box costs ${BOX_COST}.`);
    return;
  }
  coins -= BOX_COST;
  const won = pool[Math.floor(Math.random() * pool.length)];
  garage.push(won);
  selCar = won;
  saveProfile();
  renderGarage();
  const res = $('box-result');
  res.textContent = `Unlocked: ${CARS[won].name}!`;
  res.classList.remove('hidden');
  res.style.animation = 'none';
  void res.offsetHeight;
  res.style.animation = '';
};

function enterLobby() {
  phase = 'lobby';
  $('lobby-pin').textContent = roomPin;
  $('lobby-url').textContent = location.host;
  renderLobby();
  showScreen('lobby');
}

function renderLobby() {
  if (phase !== 'lobby') return;
  $('lobby-count').textContent = `(${roster.length}/8)`;
  const ul = $('lobby-players');
  ul.innerHTML = '';
  for (const p of roster) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = p.color;
    li.appendChild(sw);
    li.appendChild(document.createTextNode(`${p.name} · ${CARS[p.model]?.name || 'Cruiser'}`));
    if (p.id === myId) {
      const you = document.createElement('span');
      you.className = 'you-tag';
      you.textContent = '(you)';
      li.appendChild(you);
    }
    if (p.isHost) {
      const tag = document.createElement('span');
      tag.className = 'host-tag';
      tag.textContent = 'HOST';
      li.appendChild(tag);
    }
    ul.appendChild(li);
  }
  $('btn-start').classList.toggle('hidden', !isHost);
  $('lobby-wait').classList.toggle('hidden', isHost);
}

/* ================= Race state ================= */
const car = {
  x: 0, y: 0, angle: 0, f: 0, l: 0,
  trackIdx: 0, lap: 0,
  onGrass: false, drifting: false, finished: false,
};
let remoteCars = {};          // multi: id -> {buf:[prev,cur], lap, idx, finished, speed}
let aiCars = [];              // solo: full simulated cars
let standings = [];
let goTime = 0;
let finishTimeMs = 0;
let skids = [];
let sendTimer = null;
let awarded = false;
let myRaceId = null;          // id used in standings (server id, or 0 in solo)
let myName = '';

function spawnPose(gridPos) {
  const back = 14 + Math.floor(gridPos / 2) * 12;
  const side = (gridPos % 2 === 0 ? -1 : 1) * 24;
  const i = (N - back + N) % N;
  const d = trackDir(i);
  const nx = -Math.sin(d), ny = Math.cos(d);
  return { x: PTS[i][0] + nx * side, y: PTS[i][1] + ny * side, angle: d, idx: i };
}

function resetRaceUI() {
  standings = [];
  skids = [];
  awarded = false;
  finishTimeMs = 0;
  $('results').classList.add('hidden');
  $('results-coins').classList.add('hidden');
  $('results-wait').classList.remove('hidden');
  $('btn-lobby').classList.add('hidden');
  $('btn-menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  showScreen('game');
  resize();
}

function placeMyCar(gridPos) {
  const pose = spawnPose(gridPos);
  car.x = pose.x; car.y = pose.y; car.angle = pose.angle;
  car.f = 0; car.l = 0; car.trackIdx = pose.idx; car.lap = 0;
  car.finished = false;
}

/* ---- Multiplayer race ---- */
function startRace(grid, startAtLocal) {
  phase = 'race';
  mode = 'multi';
  myRaceId = myId;
  remoteCars = {};
  aiCars = [];
  goTime = startAtLocal;

  placeMyCar(Math.max(grid.indexOf(myId), 0));
  for (const p of roster) {
    if (p.id === myId) continue;
    const rp = spawnPose(Math.max(grid.indexOf(p.id), 0));
    remoteCars[p.id] = {
      buf: [
        { x: rp.x, y: rp.y, angle: rp.angle, rt: performance.now() - 50 },
        { x: rp.x, y: rp.y, angle: rp.angle, rt: performance.now() },
      ],
      lap: 0, idx: rp.idx, finished: false, speed: 0,
    };
  }
  resetRaceUI();

  clearInterval(sendTimer);
  sendTimer = setInterval(() => {
    if (phase !== 'race' || mode !== 'multi' || car.finished) return;
    send({
      type: 'state',
      x: Math.round(car.x * 10) / 10, y: Math.round(car.y * 10) / 10,
      angle: Math.round(car.angle * 1000) / 1000,
      speed: Math.round(car.f),
      lap: car.lap, idx: car.trackIdx, drift: car.drifting,
    });
  }, 50);
}

function onStates(msg) {
  if (phase !== 'race' || mode !== 'multi') return;
  const now = performance.now();
  for (const c of msg.cars) {
    if (c.id === myId) continue;
    let rc = remoteCars[c.id];
    if (!rc) {
      rc = remoteCars[c.id] = { buf: [{ ...c, rt: now - 50 }, { ...c, rt: now }], lap: 0, idx: 0, finished: false, speed: 0 };
    }
    rc.buf[0] = rc.buf[1];
    rc.buf[1] = { x: c.x, y: c.y, angle: c.angle, rt: now };
    rc.lap = c.lap; rc.idx = c.idx; rc.finished = c.finished; rc.speed = c.speed;
  }
}

/* ---- Single player vs AI ---- */
const AI_NAMES = ['Blitz', 'Nitro', 'Vega', 'Koba', 'Dash', 'Rex'];

function startSolo(name) {
  phase = 'race';
  mode = 'solo';
  myRaceId = 0;
  myName = name;
  remoteCars = {};
  goTime = Date.now() + 3800;

  const aiColors = COLORS.filter(c => c !== selColor);
  const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
  const skills = [0.90, 0.94, 0.985].sort(() => Math.random() - 0.5);
  aiCars = [];
  for (let k = 0; k < 3; k++) {
    const model = CAR_ORDER[Math.floor(Math.random() * CAR_ORDER.length)];
    aiCars.push({
      id: -(k + 1), name: names[k], color: aiColors[k % aiColors.length], model,
      skill: skills[k],
      x: 0, y: 0, angle: 0, f: 0, l: 0, trackIdx: 0, lap: 0,
      onGrass: false, drifting: false, finished: false, finishTime: 0,
    });
  }

  // Grid: player + AI shuffled
  const order = [{ kind: 'me' }, ...aiCars].sort(() => Math.random() - 0.5);
  order.forEach((entry, gridPos) => {
    if (entry.kind === 'me') { placeMyCar(gridPos); return; }
    const pose = spawnPose(gridPos);
    entry.x = pose.x; entry.y = pose.y; entry.angle = pose.angle;
    entry.trackIdx = pose.idx;
  });

  clearInterval(sendTimer);
  resetRaceUI();
}

function stepAI(ai, dt) {
  const stats = CARS[ai.model];
  const started = Date.now() >= goTime;
  let inp = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  if (started && !ai.finished) {
    // Steer toward a look-ahead point on the centerline
    const lookSamples = Math.round((60 + ai.f * 0.35) / SPACING);
    const ti = (ai.trackIdx + lookSamples) % N;
    const desired = Math.atan2(PTS[ti][1] - ai.y, PTS[ti][0] - ai.x);
    const da = wrapPi(desired - ai.angle);
    inp.steer = Math.max(-1, Math.min(1, da * 2.6));

    // Slow for upcoming curvature
    const curv = Math.abs(wrapPi(trackDir(ti + 16) - trackDir(ti)));
    const vmax = stats.maxSpd * ai.skill;
    const target = Math.max(250, vmax * (1.05 - curv * 1.35));
    inp.throttle = ai.f < target ? 1 : 0;
    inp.brake = ai.f > target + 50 ? 1 : 0;
  }

  simulate(ai, inp, stats, dt);

  if (ai.finished) ai.f *= Math.exp(-1.2 * dt);
  const ev = stepProgress(ai);
  if (ev === 'lap' && ai.lap >= LAPS && !ai.finished) {
    ai.finished = true;
    ai.finishTime = Date.now() - goTime;
    soloFinish(ai.id, ai.name, ai.color, ai.finishTime);
  }
}

function soloFinish(id, name, color, timeMs) {
  standings.push({ id, name, color, timeMs });
  standings.sort((a, b) => a.timeMs - b.timeMs);
  checkWinReward();
  const allDone = car.finished && aiCars.every(a => a.finished);
  renderResults(allDone);
}

/* ================= Input ================= */
const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

function inputState() {
  return {
    throttle: (keys['arrowup'] || keys['w']) ? 1 : 0,
    brake: (keys['arrowdown'] || keys['s']) ? 1 : 0,
    steer: ((keys['arrowright'] || keys['d']) ? 1 : 0) - ((keys['arrowleft'] || keys['a']) ? 1 : 0),
    handbrake: !!keys[' '],
  };
}

/* ================= Physics (shared by player + AI) ================= */
const BRAKE = 950, DRAG = 0.5;
const MAX_REV = -190;
const GRASS_MAX = 230, GRASS_DRAG = 1.6;

function nearestOnTrack(x, y, fromIdx, window_) {
  let best = fromIdx, bestD = Infinity;
  for (let k = -window_; k <= window_; k++) {
    const i = (fromIdx + k + N) % N;
    const dx = x - PTS[i][0], dy = y - PTS[i][1];
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, dist: Math.sqrt(bestD) };
}

// Advances c (x,y,angle,f,l,onGrass,drifting) one step. Progress/lap handled separately.
function simulate(c, inp, stats, dt) {
  const near = nearestOnTrack(c.x, c.y, c.trackIdx, 40);
  c.onGrass = near.dist > TRACK_HALF_W + 4;
  c._nearIdx = near.idx;

  if (inp.throttle) c.f += stats.accel * dt;
  if (inp.brake) c.f -= (c.f > 0 ? BRAKE : stats.accel * 0.6) * dt;
  c.f -= c.f * DRAG * dt;
  if (c.onGrass) {
    c.f -= c.f * GRASS_DRAG * dt;
    c.f = Math.min(c.f, GRASS_MAX);
  }
  c.f = Math.max(MAX_REV, Math.min(stats.maxSpd, c.f));

  const spdFac = Math.max(-1, Math.min(1, c.f / 170));
  const steerRate = stats.turn * (inp.handbrake ? 1.35 : 1);
  const dAngle = inp.steer * steerRate * spdFac * dt;
  c.angle += dAngle;

  c.l += -dAngle * c.f * 0.55;
  const grip = inp.handbrake ? 1.7 : (c.onGrass ? 3.0 : stats.grip);
  c.l *= Math.exp(-grip * dt);
  c.drifting = Math.abs(c.l) > 90 && Math.abs(c.f) > 120;

  const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
  c.x += (cos * c.f - sin * c.l) * dt;
  c.y += (sin * c.f + cos * c.l) * dt;
}

// Updates trackIdx/lap from last simulate; returns 'lap' when a lap is completed
function stepProgress(c) {
  const prevIdx = c.trackIdx;
  c.trackIdx = c._nearIdx ?? c.trackIdx;
  if (prevIdx > N - 45 && c.trackIdx < 45) { c.lap++; return 'lap'; }
  if (c.trackIdx > N - 45 && prevIdx < 45) { c.lap--; }
  return null;
}

function stepCar(dt) {
  const started = Date.now() >= goTime;
  const inp = (started && !car.finished) ? inputState() : { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const prevX = car.x, prevY = car.y;

  simulate(car, inp, CARS[selCar], dt);
  if (car.finished) car.f *= Math.exp(-1.2 * dt);

  if (car.drifting && !car.onGrass) {
    skids.push({ x1: prevX, y1: prevY, x2: car.x, y2: car.y });
    if (skids.length > 500) skids.splice(0, skids.length - 500);
  }

  // Soft collisions
  const others = mode === 'multi'
    ? Object.values(remoteCars).map(rc => rc.buf[1])
    : aiCars;
  for (const o of others) {
    const dx = car.x - o.x, dy = car.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.01 && d < 30) {
      const push = (30 - d) * 0.6;
      car.x += (dx / d) * push;
      car.y += (dy / d) * push;
      car.f *= 0.985;
    }
  }

  const ev = stepProgress(car);
  if (ev === 'lap' && car.lap >= LAPS && !car.finished) finishRace();
}

function finishRace() {
  car.finished = true;
  finishTimeMs = Date.now() - goTime;
  $('results').classList.remove('hidden');
  if (mode === 'multi') {
    send({ type: 'finish', timeMs: finishTimeMs });
    renderResults(false);
  } else {
    soloFinish(myRaceId, myName, selColor, finishTimeMs);
  }
}

/* ================= Results & coins ================= */
function checkWinReward() {
  if (awarded || !standings.length) return;
  if (standings[0].id === myRaceId) {
    awarded = true;
    coins += WIN_REWARD;
    saveProfile();
    const el = $('results-coins');
    el.textContent = `You won! +${WIN_REWARD} coins · total ${coins}`;
    el.classList.remove('hidden');
  }
}

function fmtTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function renderResults(over) {
  const ol = $('results-list');
  ol.innerHTML = '';
  for (const s of standings) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = s.color;
    li.appendChild(sw);
    li.appendChild(document.createTextNode(s.name + (s.id === myRaceId ? ' (you)' : '')));
    const t = document.createElement('span');
    t.className = 'r-time';
    t.textContent = fmtTime(s.timeMs);
    li.appendChild(t);
    ol.appendChild(li);
  }
  if (over) {
    $('results').classList.remove('hidden');
    $('results-wait').classList.add('hidden');
    $('btn-lobby').classList.toggle('hidden', !(mode === 'multi' && isHost));
    $('btn-menu').classList.toggle('hidden', mode !== 'solo');
  }
}

/* ================= Rendering ================= */
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const mini = $('minimap');
const mctx = mini.getContext('2d');
let DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * DPR;
  canvas.height = innerHeight * DPR;
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
}
window.addEventListener('resize', resize);
resize();

function remotePose(rc) {
  const [a, b] = rc.buf;
  const span = Math.max(b.rt - a.rt, 30);
  const u = Math.max(0, Math.min(1.2, (performance.now() - b.rt) / span));
  const da = wrapPi(b.angle - a.angle);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, angle: a.angle + da * u };
}

function tracePath(c) {
  c.beginPath();
  c.moveTo(PTS[0][0], PTS[0][1]);
  for (let i = 1; i < N; i++) c.lineTo(PTS[i][0], PTS[i][1]);
  c.closePath();
}

function drawWorld() {
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#101c12';
  ctx.fillRect(0, 0, W, H);

  const spd = Math.abs(car.f);
  const scale = DPR * Math.max(0.5, Math.min(1.05, H / DPR / 860)) * (1 - (spd / 820) * 0.16);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.translate(-car.x, -car.y);

  // Mowing stripes
  ctx.fillStyle = 'rgba(255,255,255,0.018)';
  for (let y = TB.minY - 800; y < TB.maxY + 800; y += 520) ctx.fillRect(TB.minX - 900, y, (TB.maxX - TB.minX) + 1800, 260);

  // Kerbs
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  tracePath(ctx);
  ctx.strokeStyle = '#a83232';
  ctx.lineWidth = TRACK_HALF_W * 2 + 20;
  ctx.stroke();
  ctx.strokeStyle = '#d8d8d8';
  ctx.setLineDash([26, 26]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Road
  tracePath(ctx);
  ctx.strokeStyle = '#2c2c33';
  ctx.lineWidth = TRACK_HALF_W * 2;
  ctx.stroke();

  // Centerline
  tracePath(ctx);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 4;
  ctx.setLineDash([34, 48]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Skid marks
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  for (const s of skids) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
  ctx.stroke();

  drawStartLine();

  // Other cars, then mine on top
  if (mode === 'multi') {
    for (const id in remoteCars) {
      const pose = remotePose(remoteCars[id]);
      const p = rosterById(+id);
      drawCar(pose.x, pose.y, pose.angle, p ? p.color : '#999', p ? p.model : 'cruiser');
      if (p) drawName(pose.x, pose.y, p.name);
    }
  } else {
    for (const ai of aiCars) {
      drawCar(ai.x, ai.y, ai.angle, ai.color, ai.model);
      drawName(ai.x, ai.y, ai.name);
    }
  }
  drawCar(car.x, car.y, car.angle, selColor, selCar);

  ctx.restore();

  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawStartLine() {
  const d = trackDir(0);
  ctx.save();
  ctx.translate(PTS[0][0], PTS[0][1]);
  ctx.rotate(d);
  const half = TRACK_HALF_W, sq = 13;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < Math.ceil((half * 2) / sq); i++) {
      ctx.fillStyle = (i + row) % 2 === 0 ? '#e8e8e8' : '#1a1a1e';
      ctx.fillRect(row * sq - sq, -half + i * sq, sq, Math.min(sq, half * 2 - i * sq));
    }
  }
  ctx.restore();
}

function drawCar(x, y, angle, color, model) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Headlight cone
  ctx.fillStyle = 'rgba(255,240,190,0.07)';
  ctx.beginPath();
  ctx.moveTo(16, -6); ctx.lineTo(150, -46); ctx.lineTo(150, 46); ctx.lineTo(16, 6);
  ctx.closePath();
  ctx.fill();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 3, 20, 12, 0, 0, Math.PI * 2); ctx.fill();

  // Wheels
  ctx.fillStyle = '#111';
  ctx.fillRect(-15, -11, 9, 5); ctx.fillRect(-15, 6, 9, 5);
  ctx.fillRect(7, -11, 9, 5); ctx.fillRect(7, 6, 9, 5);

  // Body
  ctx.fillStyle = color;
  roundRect(ctx, -18, -9, 36, 18, 5);
  ctx.fill();

  // Model accents
  if (model === 'falcon') {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-16, -2.5, 30, 1.8);
    ctx.fillRect(-16, 0.7, 30, 1.8);
  } else if (model === 'viper' || model === 'apex') {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-21, -10, 4, 20); // rear wing
  }
  if (model === 'ghost' || model === 'apex') {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(10, -7, 2.5, 14); // front canards
  }

  // Cockpit
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, -6, -6, 13, 12, 3);
  ctx.fill();

  // Nose stripe
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(12, -2, 5, 4);

  ctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawName(x, y, name) {
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(name).width + 12;
  ctx.fillStyle = 'rgba(10,10,12,0.7)';
  roundRect(ctx, x - w / 2, y - 38, w, 18, 5);
  ctx.fill();
  ctx.fillStyle = '#f2f2f2';
  ctx.fillText(name, x, y - 25);
}

/* ================= Minimap ================= */
const MM = { pad: 14, w: 190, h: 150 };
const mmScale = Math.min(
  (MM.w - MM.pad * 2) / (TB.maxX - TB.minX),
  (MM.h - MM.pad * 2) / (TB.maxY - TB.minY)
);
function mm(x, y) {
  const px = MM.pad + (x - TB.minX) * mmScale + ((MM.w - MM.pad * 2) - (TB.maxX - TB.minX) * mmScale) / 2;
  const py = MM.pad + (y - TB.minY) * mmScale + ((MM.h - MM.pad * 2) - (TB.maxY - TB.minY) * mmScale) / 2;
  return [Math.max(6, Math.min(MM.w - 6, px)), Math.max(6, Math.min(MM.h - 6, py))];
}

function drawMinimap() {
  mctx.clearRect(0, 0, MM.w, MM.h);
  mctx.beginPath();
  const [sx, sy] = mm(PTS[0][0], PTS[0][1]);
  mctx.moveTo(sx, sy);
  for (let i = 2; i < N; i += 2) {
    const [px, py] = mm(PTS[i][0], PTS[i][1]);
    mctx.lineTo(px, py);
  }
  mctx.closePath();
  mctx.strokeStyle = 'rgba(255,255,255,0.35)';
  mctx.lineWidth = 5;
  mctx.lineJoin = 'round';
  mctx.stroke();

  const dots = mode === 'multi'
    ? Object.entries(remoteCars).map(([id, rc]) => ({ ...remotePose(rc), color: rosterById(+id)?.color || '#999' }))
    : aiCars.map(a => ({ x: a.x, y: a.y, color: a.color }));
  for (const d of dots) {
    const [px, py] = mm(d.x, d.y);
    mctx.fillStyle = d.color;
    mctx.beginPath(); mctx.arc(px, py, 3.5, 0, Math.PI * 2); mctx.fill();
  }
  const [mx, my] = mm(car.x, car.y);
  mctx.fillStyle = '#fff';
  mctx.beginPath(); mctx.arc(mx, my, 4.5, 0, Math.PI * 2); mctx.fill();
}

/* ================= HUD ================= */
function progress(lap, idx) { return lap * N + idx; }

function updateHUD() {
  $('hud-lap').textContent = `${Math.max(1, Math.min(car.lap + 1, LAPS))}/${LAPS}`;
  $('hud-speed').textContent = String(Math.max(0, Math.round(car.f * 0.34)));

  const elapsed = Math.max(0, Date.now() - goTime);
  $('hud-time').textContent = car.finished ? fmtTime(finishTimeMs) : fmtTime(elapsed);

  const entries = [{ id: myRaceId, prog: progress(car.lap, car.trackIdx) }];
  if (mode === 'multi') {
    for (const id in remoteCars) entries.push({ id: +id, prog: progress(remoteCars[id].lap, remoteCars[id].idx) });
  } else {
    for (const ai of aiCars) entries.push({ id: ai.id, prog: progress(ai.lap, ai.trackIdx) });
  }
  entries.sort((a, b) => b.prog - a.prog);
  const pos = entries.findIndex(e => e.id === myRaceId) + 1;
  $('hud-pos').textContent = `${pos}/${entries.length}`;
}

/* ================= Countdown ================= */
let lastCount = null;
function updateCountdown() {
  const el = $('countdown');
  const remain = goTime - Date.now();
  if (remain > 0) {
    const n = Math.ceil(remain / 1000);
    const label = n > 3 ? '' : String(n);
    if (label !== lastCount) {
      lastCount = label;
      el.textContent = label;
      el.classList.toggle('hidden', !label);
      el.classList.remove('go');
      el.style.animation = 'none';
      void el.offsetHeight;
      el.style.animation = '';
    }
  } else if (remain > -900) {
    if (lastCount !== 'GO') {
      lastCount = 'GO';
      el.textContent = 'GO!';
      el.classList.remove('hidden');
      el.classList.add('go');
    }
  } else {
    if (lastCount !== null) { lastCount = null; el.classList.add('hidden'); }
  }
}

/* ================= Main loop ================= */
let lastT = performance.now();
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  if (phase === 'race') {
    stepCar(dt);
    if (mode === 'solo') for (const ai of aiCars) stepAI(ai, dt);
    drawWorld();
    drawMinimap();
    updateHUD();
    updateCountdown();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
