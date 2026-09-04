# BrowserBound Domain Model

## Overview

BrowserBound is a turn-based multiplayer artillery game. Players aim projectiles at each other across destructible terrain, with wind as a strategic element that changes each round.

## Core Concepts

### Projectile

A **Projectile** is a physical object fired by a player with an initial velocity. It is affected by gravity and wind each frame, moves in a parabolic arc, and collides with terrain or players.

- **Position**: `(x, y)` — current location in world space
- **Velocity**: `(vx, vy)` — horizontal and vertical speed. Server-side only: the client
  interpolates positions rather than predicting motion, so velocity is never synchronized.
- **Lifetime**: From fire until it hits terrain, goes out of bounds, hits an opponent, or reaches
  the Projectile Lifetime backstop

Projectiles travel as **synchronized state**, like every other moving thing. Appearing in that state
is the shot being fired and leaving it is the shot being over. The impact itself stays a message,
because it is an event rather than continuous state.

### Shot Clock

The **Shot Clock** is the single timeline every part of a shot is shown on: its flight, its
explosion, the crater it leaves, any death it causes, and its own disappearance.

It exists because those two halves arrive differently. A position is state, delivered at the patch
rate, so it is played back slightly behind live in order to have a sample on each side to interpolate
between. An impact is a message, true the moment it arrives. Shown on their own clocks, both are
correct and neither agrees with the other: the drawn projectile is a delay's worth of flight short of
the ground when its explosion goes off ahead of it. The fix is not better positions — it is one
clock, with the delay paid once by the whole shot.

The client cannot simply drop the delay and draw shots live, because terrain lives only on the server
(ADR 0002): a client predicting the flight itself has nothing to stop the projectile and would sail
it through the ground. What it can do is close the gap at the end — the impact message carries the
exact point of contact, which becomes the flight's final position, so the projectile arrives rather
than stopping wherever the last patch left it.

### Wind

**Wind** is an environmental force that affects all active projectiles. It has:
- **Magnitude**: How strong the wind is (force applied each frame)
- **Direction**: Angle in radians (0 to 2π); wind pushes in this direction
- **Duration**: How many rounds the current wind persists (random: 5–10 rounds, where 1 round = all players take one turn)

When wind duration expires (after the specified number of complete rounds), a new wind spawns immediately with random magnitude and direction.

Wind is applied as a **force**: each frame, wind velocity is added to projectile velocity:
```
vx += wind.magnitude * cos(wind.angle)
vy += wind.magnitude * sin(wind.angle)
```

### PhysicsAdapter

**PhysicsAdapter** is the single module responsible for advancing projectile positions each frame. It is **stateless**—it owns only the velocity math, not the state of wind or projectiles.

**Interface**:
- `createProjectile(angle, power) → {vx, vy}` — Convert player aim (angle in radians, power 0–100) to initial velocity
- `updateAllProjectiles(projectiles[], wind) → void` — Advance all projectiles one frame given current wind (modifies in-place)

**What PhysicsAdapter owns** (behind the seam):
- Gravity calculation: `vy += GRAVITY` each frame
- Wind force application: `vx += wx, vy += wy`
- Velocity-to-position integration: `x += vx, y += vy`

**What PhysicsAdapter does NOT own**:
- Terrain collision detection
- Projectile lifecycle (when to remove a dead projectile)
- Wind state or persistence
- Message broadcasting to clients

### WindManager

**WindManager** tracks the current wind state and persists across rounds. It owns:
- Current wind magnitude and direction
- Rounds remaining in current wind cycle (not affected by frame rate)
- Generates new random wind when duration expires

**Interface**:
- `getCurrentWind() → {magnitude, direction, framesRemaining}` — Returns current wind (framesRemaining represents rounds, not frames)
- `generateNewWind() → WindState` — Creates a new wind (called by GameRoom when round duration expires)

### Game Loop Sequence

Each server frame:

1. **PhysicsAdapter.updateAllProjectiles(projectiles, wind)** — Advance each projectile position and velocity given current wind
2. **GameRoom checks collisions** — For each projectile, test if it hit terrain, went out of bounds, or hit a player
3. **GameRoom removes dead projectiles** — Removes projectiles that collided or left bounds
4. **Publish state** — Positions, wind and turn state reach clients as synchronized state, not as
   per-frame broadcasts. Messages are reserved for events: impacts, terrain ops, match end.

**At round boundaries** (after all players have taken one turn):

5. **Check wind expiration** — Increment round counter
6. **If wind duration expired** — Generate new wind and reset counter

### Seam Boundaries

**Physics seam**: PhysicsAdapter is the boundary between "pure math" and "game logic". It encapsulates velocity calculations; everything else (terrain, collisions, lifecycle) is GameRoom's job.

This separation enables:
- Testing PhysicsAdapter in isolation (inject gravity and wind, verify trajectories)
- Reusing PhysicsAdapter on client for UI hints (e.g., aiming preview) without duplicating collision logic
- Swapping wind models without changing GameRoom

### Constants

- **GRAVITY**: Downward acceleration (pixels/frame²)
- **WIND_INTEGRATION**: Scaling factor for how strongly wind affects projectiles
- **MAP_WIDTH, MAP_HEIGHT**: World bounds (pixels)
- **WIND_DURATION_MIN, WIND_DURATION_MAX**: Rounds (5–10)
- **RECONNECT_WINDOW_SECONDS**: How long a dropped player keeps their character and turn
- **PROJECTILE_MAX_LIFETIME_FRAMES**: Backstop after which an unresolved projectile is retired
- **STEP_UP_LIMIT, STEP_DOWN_LIMIT**: The Step Window — how far a character reaches for the surface
  one pixel ahead, and therefore its climb angle
- **WALK_WINDUP_MS**: Hesitation before a held direction produces its first step
- **MOVE_STEPS**: Steps a character may take per turn
- **FALL_DELAY_MS, FALL_INITIAL_SPEED, FALL_ACCEL**: The Hang, and the fall that follows it
- **WIND_DRIFT_DIVISOR**: Scales wind into the sideways Drift of a falling character

## Why This Design

**Stateless PhysicsAdapter** means GameRoom owns all state (projectiles, wind, turn state). PhysicsAdapter is a pure function receiver—same inputs always produce same outputs. This makes it:
- Deterministic (testable, predictable)
- Reusable (client and server use same logic)
- Shallow to understand (read one module, understand all velocity math)

**Separate WindManager** keeps wind logic out of GameRoom's already-complex turn and collision handling. Wind is a self-contained concept: "spawn, persist for N frames, die and spawn new."

## Related Decisions

- [[ADR-0001-physics-adapter]] — Why PhysicsAdapter is stateless and where it sits in the game loop
- [[ADR-0004-point-contact-terrain]] — Why a character touches the terrain at one pixel, and why the
  Drawn Body is a different size doing a different job
- [[server/CONTEXT.md]] — Server-specific: GameRoom's role in managing turn state, collision detection
- [[client/CONTEXT.md]] — Client-specific: rendering projectiles, UI wind display

## Character Physics & Terrain

### Terrain Mask

The **Terrain Mask** is the authoritative record of which pixels of the world are solid. It is
authored as an image: a pixel is solid unless it is transparent. The server holds the mask and
answers every solidity question from it; the client holds a visual copy so what a player sees and
what the server collides against come from the same source.

The mask changes only by **Terrain Ops** — a rectangle added, or a circle erased. Ops are the only
thing sent over the wire, so a client that joins late can replay them to reach the current mask.

### Detached Terrain

**Detached Terrain** is any part of the mask no longer connected to the rest of it, produced when
explosions cut a bridge. Detached terrain **hangs in place**. It does not fall, collapse, or settle.

Distinct from **speckle**: single pixels and hairline filaments left along a crater's edge, which
are removed because they are visual noise, not because they are detached.

### Collapsed Lip

A **Collapsed Lip** is a thin roof an explosion left over a space too short to stand in. Because a
character can neither climb it nor pass beneath it, such a roof is removed and the space opened to
the sky.

A roof is only collapsed when it is *both* thin *and* over an unusable space. A thick roof, or a
thin roof with room to walk under it, is a cave and survives — caves are the reason terrain is
recorded per pixel at all.

### Contact Point

A character touches the terrain at a **single pixel** — the Contact Point. Its position *is* that
pixel: the topmost solid row of the ground beneath it. "Standing on the ground" and "the pixel at
my position is solid" are the same statement.

This is the whole of the character's relationship with the terrain. Nothing sweeps a shape against
the mask, nothing probes several columns and picks a winner, and nothing has to be freed from
terrain it has sunk into except by lifting it straight up. See `docs/adr/0004-point-contact-terrain.md`
for why a rectangle was tried first and what it cost.

### Drawn Body

The **Drawn Body** is the rectangle a character is *rendered* as and the box a projectile is tested
against: a fixed width and height, centred horizontally on the Contact Point and standing on it, so
the position is the feet rather than the centre.

It is deliberately **not** what the simulation moves. The two are different sizes doing different
jobs, and the consequence is accepted: a character standing beside a steep face clips into it,
because nothing stops the drawing from overlapping terrain the Contact Point is clear of. Chassis
Tilt is what makes this read as correct — the eye takes the angle of the body as the statement
about where the ground is.

Projectiles are tested against the Drawn Body directly. A shot at head height therefore registers,
and a shot passing below the feet, inside the ground, does not. It was previously a circle centred
on the feet, which got both of those backwards.

The Drawn Body **leans with Chassis Tilt**, rotating about the Contact Point exactly as the sprite
does. It is the thing players aim at, so it has to be the shape they see: a box that stayed level
while the sprite leaned put the character's head most of a half-width away from where shots hit it.

### Step Window

The **Step Window** is how far above and below its feet a character looks for the surface one pixel
ahead. It is the entire locomotion model: scan that column, and take the first solid pixel that
follows an empty one.

Its upward reach is also the **climb angle** — the steepest continuous slope that can be walked is
one rise per pixel travelled — and unlike the three separate limits it replaced, it is the angle
characters actually achieve rather than one that has to be inferred.

Its downward reach is how far a character follows the ground down before the ground has left it.

### Walking Off, and Being Refused

The column ahead gives one of three answers, and the last two are **not** the same thing.

A **Wall** is a column that is solid all the way up through the Step Window: there is no surface to
step onto. The character does not advance, does not rise, and **spends no Movement Budget** —
walking into a wall is free — and is told it cannot move.

A **Cliff** is a column whose ground has fallen away past the bottom of the window. The character
**does** advance, drops by the window, and falls. Walking off an edge is movement, not a refusal;
treating it as one would pin characters to the tops of hills.

### The Hang

A character whose ground disappears does not drop immediately. It hangs briefly first, and only
then begins to fall — which is what makes ground collapsing underfoot read as a beat rather than a
snap. The hang is per fall: landing clears it, and so does a fresh blast, so a character shot off a
ledge gets the same beat as one whose ground vanished.

A fall **starts** at speed rather than accelerating up from zero, so the drop is legible
immediately instead of creeping into motion.

### Drift and Knockback

Two different things move a falling character sideways.

**Drift** is the wind, accumulated as a fraction of a pixel per moment and spent a whole pixel at a
time. Weak wind nudges a long fall now and then rather than sliding it continuously.

**Knockback** is a blast shoving a character sideways. A character standing on the ground is
shoved *along* it — following slopes, stopping against walls, and going over a ledge into a fall
exactly as if it had walked there. A character already falling carries the shove as velocity
instead, since there is nothing to walk on.

Knockback is horizontal only: nothing in the game moves a character upward, so a blast shoves and
drops rather than launching. A character that meets a wall **stops** against it — it does not
bounce off, and it does not climb it. Both Drift and Knockback die at the wall.

### Movement Budget

The **Movement Budget** is the number of **steps** a character may take during its turn,
replenished each turn. A step is one pixel, taken once per simulation tick after a brief wind-up on
the first one, so the budget is also the distance and the pace is deliberate rather than a glide.

It is spent per step actually taken, so a Wall costs nothing. Firing ends the turn, and with it any
unspent budget.

**Turning is not movement** and is never charged to the budget. A character with nothing left to
spend can still face either way, and so can always shoot in either direction.

### Chassis Tilt

**Chassis Tilt** is the character's orientation, taken from the slope of the ground beneath it: the
line between the ground found under its left edge and under its right edge. A character in the air
has no tilt. Tilt reads the ground far more generously than walking does, so a character tilts to
terrain it could never climb.

### Chassis-Relative Aim

Aim is measured **against the Chassis**, not against the world. The ground a character stands on
therefore changes where its shot goes. When Chassis Tilt changes, the aim measurement is preserved
and the real-world direction moves with the chassis.

Aim is confined to a fixed range relative to the chassis. Terrain that tilts a character far enough
can press its aim against that limit, denying shots that would be available on level ground.

The **HUD displays the world angle** — the chassis-relative dial offset by the tilt — so the number
a player reads is measured from the horizontal even though the value behind it is not.

### Reconnection Window

A dropped connection is not a departure. A character whose player has disconnected stays on the
field for the **Reconnection Window**, keeping its health, its position, its turn and its unspent
Movement Budget, and rejoining restores all of it because none of it was ever torn down. The turn
clock is *frozen* for the duration rather than extended, so a player who returns gets back the time
they had left and no more.

A **deliberate leave is not a drop** and does not wait out the window — the opponent should not sit
through a timer for someone who has already gone. Only expiry of the window removes the character
and passes the turn.

While the window is open the character is marked as disconnected to everyone else, because a
character standing still because its player is thinking and one standing still because its player
fell off the network are otherwise indistinguishable.

### Projectile Lifetime

A projectile that has neither collided nor left the world after a bounded number of frames is
retired, and the turn proceeds. This is a **backstop, not a game rule**: nothing legitimate reaches
it, since a full-power shot crosses the map in well under a second.

It exists because the turn only passes once no projectile is in flight, which makes a single
projectile that can never resolve a permanent freeze for *every* player in the room. Retirement is
deliberately not an impact — it destroys no terrain and damages nobody, and it reports no position,
because the position of a projectile that failed to resolve is precisely the value that cannot be
trusted.

### Match Phase

A match has three phases: **lobby**, **playing**, and **ended**.

**Lobby** is the pre-game phase where players join and prepare. A room remains in lobby until the
host triggers `startGame()`. All player actions here are seat claims, ready toggles, and game start —
nothing hits the terrain or the turn clock. The match becomes unresponsive to new joins once it starts:
the room is **locked** at first play, and no backfill of dropped players happens.

**Playing** is the active match. It begins when the first player takes a turn. Turn passing, the turn
clock, wind changes, and projectiles all run. It ends when fewer than two characters remain, at which
point turn passing, the turn clock and wind changes all stop.

**Ended** signals match completion. When a match reaches this phase, the game transitions back to
lobby after a brief delay so players can see the result and prepare for the next match. The room
becomes available for joining again.

The **winning team** is the last team with living characters. Two teams eliminating each other in the
same exchange results in a **draw**, with `winningTeamId = -1`. A team is only reported as winner
when there is genuinely one team with characters left, never inferred from whoever happens to remain.
Because deaths can land in the same frame, the outcome is decided once at the end of a frame rather
than on each removal.

A match only becomes endable once it has had two or more characters at the same time; before enough
players arrive, a single character is in a room waiting to fill.

### Turn Clock

The time left in the current turn, published as a **remaining duration** rather than a deadline.
A deadline would require the client's clock to agree with the server's, and a countdown computed
from a skewed clock is wrong by the skew for as long as the skew lasts.

### Team

A **Team** is a group of players who win or lose together. The team a **Seat** belongs to is derived
from its index: `teamId = floor(seatIndex / teamSize)`. Teams are never stored explicitly — they are
computed from seat geometry and game mode.

Example: in a 2v2 game (2 teams, 2 players per team):
- Seats 0–1 belong to Team 0
- Seats 2–3 belong to Team 1

A match ends when only one team has characters remaining. Team-based win conditions replace individual
winner tracking from earlier versions.

### Seat

A **Seat** is a pre-match identity and slot in the lobby. It differs from a **Player**, which exists
only during the active match ('playing' phase) and holds game state like position, health, and aim.

A Seat holds:
- **seatIndex**: Position in the room (determines team via `floor(seatIndex / teamSize)`)
- **sessionId**: Colyseus client session (persists across reconnect)
- **userId**: Supabase auth user (who the person is)
- **displayName**: User's chosen name
- **ready**: Boolean toggle set in lobby, reset to false on return from match
- **connected**: Connection status (dropped players stay in lobby until reconnect window expires)

When `startGame()` is called, each claimed seat spawns a Player with inherited identity. When the
match ends and returns to lobby, players are destroyed but seats remain, allowing the next match to
start without re-claiming.

### Ready State

The **Ready State** is a boolean toggle each player sets in the lobby to signal they are prepared to
start. All seats must be claimed and all players must be ready before the host can trigger `startGame()`.

Ready state is reset to `false` when returning to lobby after a match ends, so a new match requires
re-readying even if the same players remain in the room.

### Player Identity

Two separate identities track a player across session boundaries:

- **sessionId** (Colyseus-assigned): Unique per client connection. A disconnected player who reconnects
  within the Reconnection Window keeps their session ID and their character.
- **userId** (Supabase-assigned): The authenticated user. Used for persistence and accounts, but
  reconnection is session-based, not user-based, so a user can abandon a match and rejoin via a new
  client session without restoring their character.

A player is identified by **sessionId** in-match and at the seat level in-lobby. The user account
(userId) is metadata: the server verifies it via JWT, stores it in the Seat, but routing turns and
messages always keys off sessionId.

### Room Lock

A game room is **locked** immediately when it transitions from 'lobby' to 'playing'. Once locked:
- No new players may join
- No backfill of dropped players happens — if a player disconnects and their reconnection window
  expires, no one takes their seat

A locked room becomes unlocked when it returns to 'lobby' phase, allowing new players to join for the
next match.

### Lobby Scene vs LobbyRoom

These are two separate concepts and easy to conflate:

**LobbyRoom** (`server/rooms/LobbyRoom.ts`) is a Colyseus matchmaking room type. It holds no game
state; it exists solely to list all currently running game rooms so clients can discover and join them.
It is a Colyseus pattern.

**Lobby Scene** (client `Lobby.tsx` screen, server `matchPhase: 'lobby'` state) is the pre-game state
within a game room where players claim seats and ready up. The Lobby Scene uses the room's synchronized
state to render the seat grid and ready buttons. It is part of the match lifecycle, not a separate
matchmaking mechanism.

A client discovers a game room via LobbyRoom, then joins that room and enters the Lobby Scene to
prepare. The two are separate layers: matchmaking discovery vs. pre-match preparation.

### Terrain Op Log

The record of every terrain change since the map loaded, replayed in full to each joining client.

It is **compacted, not bounded**: consecutive operations of the same type covering adjacent columns
merge into one rectangle, which is what lip collapse produces in bulk. Only that rewrite is
performed, and only against the immediately preceding operation. Terrain operations both remove and
*add* terrain — sliver fills restore it — so their **order is their meaning**, and an operation that
looks redundant next to its neighbour may be doing the opposite job. A match that keeps digging new
ground still grows the log.

### Kill Boundary

The **Kill Boundary** is the edge of the world. A character that passes it dies at once, whatever
its health. It is the only lethal consequence of falling: characters take no damage from impact,
however far they fall.
