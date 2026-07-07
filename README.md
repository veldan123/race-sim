# Apex Rush — Multiplayer Race Car Simulator

Web-based top-down racing game for 2–8 players. One person hosts a session and gets a **6-digit PIN**; everyone else joins with that PIN from their own browser. There's also a **single-player mode** against 3 AI drivers.

## Cars, coins & the Mystery Box

- Everyone starts with one car: the **Cruiser**. Pick your car in the **Garage**, then pick your paint color.
- Winning a race (multiplayer or single player) earns **10 coins**.
- A **Mystery Box costs 100 coins** and unlocks a random better car from a pool of nine: **Comet** and **Falcon RS** (acceleration), **Zephyr** and **Ghost X1** (handling), **Raptor SR** (balanced), **Viper GT** and **Titan V8** (top speed), and the top-tier **Apex Prime** and **Phantom Z**.
- Coins and unlocked cars are saved in your browser (localStorage).

## Run

```bash
cd race-sim
npm install   # first time only
npm start     # server on http://localhost:3000
```

- **Host**: open http://localhost:3000, enter a name, click **Host a Session** → share the PIN.
- **Friends**: open `http://<your-local-ip>:3000` (same Wi-Fi/network), enter the PIN, join.
- Host clicks **Start Race** — 3-2-1-GO, 3 laps, live positions, results at the end.

Find your local IP on macOS: `ipconfig getifaddr en0`

## Controls

| Key | Action |
|---|---|
| ↑ / W | Throttle |
| ↓ / S | Brake / reverse |
| ← → / A D | Steer |
| Space | Handbrake (drift) |

Driving on the grass slows you down hard — stay on the tarmac.

## How it works

- `server.js` — Node + `ws` WebSocket server. Manages sessions keyed by 6-digit PIN (create/join/leave, host migration, 8-player cap), carries each player's chosen car model + color, relays car states at 20 Hz, tracks finishes and standings.
- `public/game.js` — canvas renderer + arcade physics (per-model speed/accel/grip stats, speed-sensitive steering, drift, off-track drag), a ~16,600 px Catmull-Rom circuit, lap tracking, remote-car interpolation, AI drivers (look-ahead steering with curvature-based braking), garage/coins economy, HUD + minimap.
- Each client simulates its own car and reports state; the server relays and referees (start, standings, race over).
