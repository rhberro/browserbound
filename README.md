# BrowserBond

A turn-based multiplayer artillery game for browsers, inspired by GunBound.

## Stack

- **Client**: PixiJS (lightweight WebGL/Canvas renderer)
- **Server**: Colyseus (real-time multiplayer state sync)
- **Physics**: Custom deterministic projectile simulation (shared TypeScript)
- **Build**: Vite (client), TypeScript, pnpm workspaces

## Setup

```bash
pnpm install
```

## Development

Run both client and server in parallel:

```bash
pnpm dev
```

- **Server**: Runs on `ws://localhost:3002`
- **Client**: Opens in browser on `http://localhost:3000`

To run only one:

```bash
pnpm --filter @browserbond/client dev    # Client only (port 3000)
pnpm --filter @browserbond/server dev    # Server only (port 3002)
```

## Build

```bash
pnpm build
```

Compiled outputs:
- `client/dist/` — Static files for serving
- `server/dist/` — Node.js bundle
- `shared/dist/` — Shared types & physics

## Architecture

- `shared/` — Physics simulation, types (imported by both client & server)
- `server/` — Colyseus room, game logic, turn management
- `client/` — PixiJS scenes, UI, player input

## MVP Scope

- Quick-match lobbies (no accounts yet)
- 2-player turn-based matches
- Angle + power aiming
- Wind-affected trajectories
- Deterministic server-verified shots
