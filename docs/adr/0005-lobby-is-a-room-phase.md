# ADR-0005: Lobby is a Room Phase, Not a Separate Matchmaking Room

**Status**: Accepted

**Date**: 2026-09-04

## Context

A turn-based multiplayer game needs players to assemble, agree they're ready, and start a match together. Two architectural approaches exist:

1. **Lobby as a separate room type** (Colyseus pattern): A dedicated matchmaking room lists open games; players join it, select a game or create one, then are invited into a game room that starts immediately upon joining.
2. **Lobby as a phase within the game room**: A game room has three phases (`'lobby'`, `'playing'`, `'ended'`). Players join the room in lobby, claim seats, toggle ready, and the host triggers match start from the same room's state.

Early implementation used Colyseus's built-in `LobbyRoom` for discovery. The game room had no pre-game state: joining immediately spawned a player and started the match. This created friction:
- No seat selection or team management before the match
- No explicit "ready" signal; players had to leave and rejoin to decline a match
- Multiple players arriving near-simultaneously could race to default seats with no control
- No mechanism to prevent new players from joining mid-match

## Decision

Implement **lobby as a `'lobby'` phase within the game room**, not as a separate Colyseus room type.

### Room State Structure

The room state includes:
```typescript
// Exists only in 'lobby' phase
matchPhase: 'lobby'
seats: MapSchema<Seat>         // [seatIndex] → {sessionId, userId, displayName, ready, connected}
hostSessionId: string           // Session that can call startGame()
teamCount: number              // 2 or more
teamSize: number               // Seats per team
roomName: string               // Human-readable room name

// Exists in all phases
players: MapSchema<Player>     // Active characters (only in 'playing'/'ended')
currentPlayerId: string        // Whose turn is it
matchPhase: 'lobby' | 'playing' | 'ended'
```

### Messages

New messages:
- `claimSeat({ seatIndex })` — Reserve a seat in lobby
- `setReady({ ready })` — Toggle ready state
- `startGame()` — Transition from 'lobby' to 'playing' (host only)

### Transition Logic

- Room created in `'lobby'` phase
- `startGame()` transitions to `'playing'`, spawns players from seats, locks the room
- Match end (fewer than two characters) transitions to `'ended'`
- Auto-return (2s delay) transitions `'ended'` → `'lobby'`, clears players, resets seat ready flags

## Rationale

1. **Unified room identity**: A match is one room from join to finish. No URL hopping, no state reconstruction.

2. **Explicit control**: Seats and ready state are synchronized state, not separate concerns. Players see who is ready in real-time and can revise their own readiness before committing.

3. **Team composition**: Seats are assigned to teams at creation time via `teamCount` and `teamSize`. Game mode (duel, 2v2, FFA) is determined at creation, not negotiated in a separate UI.

4. **No race conditions**: All pre-game actions happen within a single room's state. A player joining sees the current seat configuration and ready state; there is no window for misalignment.

5. **Match continuity**: Returning to lobby after a match uses the same room state, so players can immediately see who is still present and ready for a rematch without leaving and rejoining.

6. **Room discovery remains separate**: `LobbyRoom` still serves its purpose: listing available game rooms so clients can find and join them. Conflating discovery (which games exist?) with preparation (is everyone ready?) would couple concerns.

## Consequences

**Benefits**:
- Seat and ready state are first-class synchronized data, not secondary UI state
- No state transfer between rooms; lobby and gameplay live in the same room
- Team configuration is set at room creation and enforced throughout
- Clear sequence: create/join → claim seat → ready → start → play → end → lobby (repeat)

**Costs**:
- Room must handle two fundamentally different phases: seat selection (lobby) vs. turn-based gameplay (playing)
- Room logic becomes more complex: different message handlers, different state visibility, phase-dependent behavior
- Cannot reuse Colyseus's built-in `LobbyRoom` for the pre-game phase — we define our own
- Harder to reverse: changing this to separate rooms requires migrating every seat, ready flag, and team assignment to a new room before players can play

**Open Questions**:
- Should a player be able to change teams or seats after being ready? Currently they cannot; toggling ready is required. This is intentional to prevent chaos, but could be reconsidered.
