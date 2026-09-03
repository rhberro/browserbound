/**
 * PlayerState and TurnState used to live here as hand-written mirrors of the
 * synchronized schema. They are now PlayerView and TurnView in ./schema, DERIVED
 * from the schema classes with Pick, so the client stops compiling when a field
 * it consumes moves. See that file for why.
 */

/**
 * `Projectile` and `ProjectileInput` used to live here, alongside a
 * ProjectileSimulation in ./physics that re-implemented the trajectory maths
 * PhysicsAdapter already owned. Nothing called either of them. The projectile
 * that exists is the synchronized one in ./schema; the integrator that runs it
 * is PhysicsAdapter.
 */

export const GRAVITY = 0.4;
export const POWER_SCALE = 0.3;

/**
 * Scales wind magnitude (0.1 - 0.5) into a per-frame acceleration.
 * At 0.35, full wind pushes at 0.175 px/frame² — ~44% of gravity, enough to
 * visibly bend a long shot; the weakest wind stays a gentle ~9% nudge.
 */
export const WIND_INTEGRATION = 0.35;

// ---------------------------------------------------------------------------
// Character physics & terrain.
// See docs/agents/implementation-plan-movement-physics.md for the rationale
// behind each value. Anything marked TUNE is expected to move during playtest —
// never inline these.
// ---------------------------------------------------------------------------

/**
 * The DRAWN body: the rectangle the character is rendered as and the box a
 * projectile is tested against. `player.y` is the FEET (bottom edge), so it
 * spans [y - PLAYER_HEIGHT, y] centred on x.
 *
 * Since ADR 0004 this is NOT the physics body. Terrain contact is a single
 * point — `player.(x, y)` itself — and nothing in `characterPhysics` reads
 * these two numbers except `pointInBody`. `collapseLips` also uses the height,
 * as a headroom test for whether a space is worth standing in.
 *
 * The consequence is deliberate: the sprite is wider than its collision, so it
 * clips into a steep face it stands beside. GunBound accepts this and it reads
 * fine, because the chassis tilt sells the contact.
 */
export const PLAYER_WIDTH = 24;
export const PLAYER_HEIGHT = 36;

/**
 * The STEP WINDOW: how far above and below its feet a character looks for the
 * surface one pixel ahead.
 *
 * This one pair of numbers is the whole locomotion model, replacing a
 * CLIMB_LIMIT / STEP_LIMIT / MAX_CLIMB_ANGLE_DEG triple that existed only to
 * reconstruct it for a body with width. GunBound's `TankMovementMaxYStepping`
 * and `MinYStepping`, both 6.
 *
 * `STEP_UP_LIMIT` is therefore also the climb angle: the steepest continuous
 * slope is `atan(STEP_UP_LIMIT / 1)` ~= 80.5 degrees, and unlike the old model
 * that is the angle characters actually achieve — there is no half-width
 * lookahead standing between the advertised limit and the observed one. TUNE.
 */
export const STEP_UP_LIMIT = 6;
/**
 * The matching downward reach. A drop deeper than this is a CLIFF: the
 * character still advances and drops by this much, and gravity takes it from
 * there. It is not a refusal. TUNE.
 */
export const STEP_DOWN_LIMIT = 6;

/**
 * Hesitation before a held direction produces its FIRST step, in ms.
 *
 * A wind-up, not a per-step cost. GunBound accumulates `sidewaysDelayTimer`
 * and never resets it after a successful step — only when the key is released
 * — so pressing a direction gives 100ms of nothing followed by a steady
 * 1px/frame crawl. Reading it as a per-step delay instead yields a 10px/s
 * character, which is the trap worth naming here. TUNE.
 */
export const WALK_WINDUP_MS = 100;

/**
 * Steps a character may take per turn, replenished each turn. A step is one
 * pixel by definition — terrain is followed per pixel, so a longer stride would
 * step over the column it reads its surface from — which makes this a distance
 * as well as a count.
 *
 * GunBound gives each mobile 90-100. Ours was 250px at double the pace, which
 * is a large part of why walking read as slidey rather than deliberate. TUNE.
 */
export const MOVE_STEPS = 300;

/**
 * How long a character hangs before gravity engages, in ms. What makes ground
 * collapsing underfoot read as a beat rather than a snap.
 * GunBound's `TankMovementGravityDelay`. TUNE.
 */
export const FALL_DELAY_MS = 50;
/** Speed a fall starts at, px/tick. GunBound's `TankMovementInitialGravity`. */
export const FALL_INITIAL_SPEED = 3;
/** Fall acceleration, px/tick^2. GunBound's `TankMovementGravityFactor`. */
export const FALL_ACCEL = 0.15;

/**
 * Scales the wind acceleration into a per-tick sideways drift for a FALLING
 * character. The accumulator is clamped to +/-1 and spent as whole pixels, so
 * weak wind nudges a long fall by a pixel now and then rather than sliding it.
 *
 * Sized against a fall, not copied from GunBound: OpenBound divides its wind
 * force by 45, but its force is in different units than ours, and porting the
 * divisor made the drift unreachable — at our maximum wind acceleration
 * (WIND_INTEGRATION * 0.5 = 0.175/tick) it needed ~4s of continuous falling to
 * emit a single pixel, and the longest fall on the map is about 2s. At 0.5 the
 * strongest wind moves a falling character a pixel every ~11 ticks, so a long
 * drop lands roughly 10px downwind and a short one is untouched. TUNE.
 */
export const WIND_DRIFT_SCALE = 0.5;

/**
 * Bound on the lift that frees a contact point with terrain drawn over it (a
 * `rect` op, or a map that loads a character inside a hill).
 */
export const EJECT_UP_LIMIT = 32;

/** Per-frame speed clamp, both axes, for falling characters. TUNE. */
export const TERMINAL_VELOCITY = 12;

/** A turn with no shot passes after this long. */
export const TURN_TIME_MS = 30000;

/**
 * The Delay cost of passing a turn (firing nothing, or letting the clock run
 * out). Substantially cheaper than any weapon's cost, which is what makes
 * skipping a real move: give up this turn to act again sooner. GunBound's
 * `TurnSkipDelayCost`. TUNE.
 */
export const TURN_SKIP_DELAY = 200;

/**
 * How long a dropped player keeps their character, turn and Movement Budget
 * before the match gives up on them, in seconds.
 *
 * Sized against the disconnects worth surviving — a phone changing networks, a
 * laptop waking from sleep — not against a player who has walked away. It is
 * deliberately the same length as a turn: a reconnect that costs its owner
 * their whole turn is already the worst case anyone should have to sit through,
 * and the opponent is waiting the entire time.
 */
export const RECONNECT_WINDOW_SECONDS = 30;

/**
 * How far ABOVE the map a projectile may fly before it counts as gone.
 *
 * Deliberately huge, and deliberately not the same as the side and bottom
 * bounds. A high lob is a core artillery shot, and its apex is `v^2 / 2g` above
 * the muzzle — at full power that is 1125px, more than the map is tall. A tight
 * ceiling does not merely clip those shots, it deletes them mid-flight: every
 * high-angle shot above roughly 87 power used to die in the air. GunBound
 * allows 300px for the same reason (`ProjectilePlayableMapAreaYLimit`); ours is
 * larger because our shots are faster relative to the map.
 *
 * The sides and floor stay tight: leaving them really is leaving the field.
 */
export const PROJECTILE_CEILING = 2000;

/** Margin outside the map's sides and floor before a projectile is gone. */
export const PROJECTILE_BOUNDS_MARGIN = 50;

/**
 * Hard cap on how long a single projectile may stay in the air, in simulation
 * frames. At the 16ms tick that is 10 seconds.
 *
 * This is a BACKSTOP, not a game rule. Nothing legitimate reaches it: the map
 * is 2000px wide and a full-power shot crosses it in well under a second, so a
 * projectile still alive at 10 seconds is a projectile that cannot resolve —
 * historically a NaN one, whose ray-march never ran and whose out-of-bounds
 * comparisons were all false.
 *
 * The turn clock only advances once the active projectile list is empty, so
 * without this cap a single unresolvable projectile freezes the room for every
 * player in it, permanently. Keep the cap even once the specific NaN route is
 * closed: the failure mode is far too severe to leave guarded in only one
 * place.
 */
export const PROJECTILE_MAX_LIFETIME_FRAMES = 625;

/**
 * How far a blast pushes a character, in pixels per point of `knockbackScale`
 * times damage. A one-time positional shove along the ground rather than stored
 * velocity: a grounded character has no way to spend velocity, and a shove that
 * walks the terrain follows slopes and stops at walls for free. TUNE.
 */
export const KNOCKBACK_SHOVE_SCALE = 1;

/** Half the track length used for the chassis tilt secant. */
export const TILT_OFFSET_X = 12;
/**
 * Vertical search window for the tilt secant. Deliberately far larger than
 * STEP_UP_LIMIT: tilt and locomotion answer different questions, so a character
 * tilts smoothly across terrain it could never walk over.
 */
export const TILT_WINDOW_Y = 25;

/** Aim limits, in degrees, measured from the horizontal (world-absolute). See ADR 0003. */
export const AIM_MIN_DEG = -20;
export const AIM_MAX_DEG = 90;

// ---------------------------------------------------------------------------
// Wind.
// Wind DRIFTS: it is nudged a little at the end of every turn and only
// occasionally re-rolled outright. A wind that teleports to a fresh random pair
// makes the shot you just took worthless as information, which punishes the
// exact skill the mechanic exists to reward. Numbers are OpenBound's
// `MatchMetadata.DisturbWind` translated into our units — see
// docs/agents/opportunities-from-openbound.md, Tier 1 item 2.
// ---------------------------------------------------------------------------

/** Weakest wind the game will roll. Also the floor drift is clamped against. */
export const WIND_MAGNITUDE_MIN = 0.1;
/** Strongest wind the game will roll. Also the ceiling drift is clamped against. */
export const WIND_MAGNITUDE_MAX = 0.5;

/**
 * Probability that a turn ending disturbs the wind at all. At 0.5 the dial
 * moves about every other turn, which reads as weather rather than as a slider
 * being dragged. OpenBound's `WeatherWindAngleDisturbanceChance`. TUNE.
 */
export const WIND_DRIFT_CHANCE = 0.5;

/**
 * Largest magnitude change a single turn may make, in wind units. 0.024 is 6%
 * of the 0.1-0.5 range, matching OpenBound's +/-2 out of its 0-35 force scale.
 *
 * Sized to be readable, not decisive: at WIND_INTEGRATION the whole range only
 * spans 0.035-0.175 px/frame^2 of acceleration, so one turn's worst case moves
 * a full-map shot by a few pixels — an adjustment, not a re-aim. TUNE.
 */
export const WIND_DRIFT_MAGNITUDE = 0.024;

/**
 * Largest direction change a single turn may make, in radians (3 degrees).
 * OpenBound's `WeatherWindAngleDisturbance`. Small enough that the wind dial
 * stays where the player last read it, large enough that a few unattended
 * turns visibly move it. TUNE.
 */
export const WIND_DRIFT_ANGLE = Math.PI / 60;

/**
 * How many turns a wind survives before it is re-rolled outright, drawn
 * uniformly from this range.
 *
 * Drift alone is a random walk, and a random walk clamped at a bound will sit
 * against it: without the re-roll a match can spend its second half in one
 * corner of the wind space. 10-20 turns is the old 5-10 ROUNDS at two players,
 * kept deliberately — the pacing was never the complaint — but counted in the
 * unit that survives ticket #35 removing rounds entirely. TUNE.
 */
export const WIND_REROLL_TURNS_MIN = 10;
export const WIND_REROLL_TURNS_MAX = 20;
