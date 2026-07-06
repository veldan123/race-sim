# Product

## Register

product

## Users

Friends and small groups (2–8 players) who want a quick pick-up racing game in the browser. One person hosts on their machine, shares a 6-digit PIN, everyone else joins from their own browser on the same network. Context: casual, social, short sessions — a few laps between other things. Keyboard players on laptops/desktops.

## Product Purpose

A web-based multiplayer race car driving simulator. Host a session → get a 6-digit PIN → friends join → race 3 laps on a shared circuit with live positions, lap timing, and results. Success = a stranger can go from opening the page to racing a friend in under 30 seconds, and the driving feels responsive and fun.

## Brand Personality

Fast, focused, night-race. The mood: floodlit tarmac at a night circuit — amber sodium glow, cold floodlights, adrenaline held under control. UI stays out of the way; the track is the star.

## Anti-references

- Kahoot/party-quiz styling (bouncy purple gradients, cartoon confetti) — the PIN-join flow invites this; resist it.
- Racing-game HUD clutter (fake carbon fiber textures, italic speed-lines everywhere, 6 gauges).
- Generic SaaS dark dashboard — this is a game, timing and speed readouts should feel like race telemetry, not analytics cards.

## Design Principles

1. **Track first** — chrome recedes; menus are brief pit stops, the canvas is the product.
2. **30 seconds to green flag** — every screen has exactly one obvious next action (enter name → host/join → start).
3. **Telemetry, not decoration** — numbers (PIN, speed, lap times) are the visual voice; set them in mono, make them big, make them honest.
4. **Readable at speed** — HUD elements must parse in a glance while driving; high contrast, fixed positions, no motion on data.

## Accessibility & Inclusion

- Keyboard-only play (arrows or WASD) — no mouse needed once in a race.
- HUD text contrast ≥ 4.5:1 over any canvas content (solid/scrimmed backgrounds behind HUD text).
- `prefers-reduced-motion`: no UI transitions; countdown swaps instantly instead of scaling.
- Player identity never by color alone — names always shown alongside car colors.
