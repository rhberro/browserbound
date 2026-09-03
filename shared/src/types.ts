/**
 * PlayerState and TurnState used to live here as hand-written mirrors of the
 * synchronized schema. They are now PlayerView and TurnView in ./schema, DERIVED
 * from the schema classes with Pick, so the client stops compiling when a field
 * it consumes moves. See that file for why.
 */

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ProjectileInput {
  angle: number; // radians
  power: number; // 0-100
  weaponType: 'cannon' | 'missile';
}

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
 * Character AABB. `player.y` is the FEET (bottom edge).
 *
 * Width is the load-bearing number here, and it was originally 40 (derived from
 * PLAYER_RADIUS) which proved far too wide. An axis-aligned box probes half its
 * width ahead, so on a slope of gradient g it must lift `HALF_WIDTH * g` to
 * advance one pixel — meaning the widest climbable slope is
 * `atan(STEP_LIMIT / HALF_WIDTH)`, NOT the `atan(STEP_LIMIT / 1)` the per-pixel
 * framing suggests. The same half-width is how far the body hovers past a crest
 * before it falls. Both artifacts scale with width, which is why Hedgewars'
 * body is 18px.
 *
 * The two artifacts pull in opposite directions and cannot both be tuned away:
 * grounding on the highest terrain under the foot line is what lets a wide box
 * climb at all (it pre-lifts the body onto the slope), and it is also exactly
 * what makes the box hover past a crest. Narrowing the foot line relative to
 * the body was tried and rejected — it merely trades the hover for a lag
 * between the leading edge clearing a lip and the body mounting it. Narrowing
 * the BODY fixes both at once, and Phase 6's chassis tilt is what finally makes
 * the residual hover read as correct rather than broken. TUNE.
 */
export const PLAYER_WIDTH = 24;
export const PLAYER_HEIGHT = 36;

/**
 * Steepest slope a character can walk up, in degrees.
 *
 * This is the number to tune when climbing feels wrong — everything else is
 * derived from it. An axis-aligned body probes HALF_WIDTH ahead, so to advance
 * one pixel up a slope of gradient `g` it must lift `HALF_WIDTH * g`. Inverting
 * that gives the climb limit below. TUNE.
 */
export const MAX_CLIMB_ANGLE_DEG = 75;

/**
 * Greatest rise a character may climb per 1px of horizontal travel.
 *
 * DERIVED from MAX_CLIMB_ANGLE_DEG — do not tune this directly. At a 24px body
 * and 75 degrees that is 45px, which is larger than it looks: it is the
 * transient lift needed to get the leading edge over the slope, not the height
 * gained per step (that is just the gradient).
 */
export const CLIMB_LIMIT = Math.round(
  (PLAYER_WIDTH / 2) * Math.tan((MAX_CLIMB_ANGLE_DEG * Math.PI) / 180)
);

/**
 * Greatest drop a character will follow rather than walk off into a fall, and
 * the furthest a landing body snaps down to the surface.
 *
 * Deliberately NOT the same as CLIMB_LIMIT. Climbing is limited by the body's
 * geometry against a slope; stepping down is a gameplay choice about when a
 * ledge becomes a fall. Sharing one constant meant a steeper climb also glided
 * the body down large drops instead of dropping it. TUNE.
 */
export const STEP_LIMIT = 20;

/** Ground probes spread across the foot line; highest ground wins. */
export const FOOT_SAMPLES = 5;


/** Pixels a character may walk per turn, replenished each turn. TUNE. */
export const MOVE_BUDGET = 250;
/** Walking pace in px/sec. TUNE. */
export const WALK_SPEED = 120;

/** Per-frame speed clamp, both axes, for falling characters. TUNE. */
export const TERMINAL_VELOCITY = 12;

/** A turn with no shot passes after this long. */
export const TURN_TIME_MS = 30000;

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

/** Half the track length used for the chassis tilt secant. */
export const TILT_OFFSET_X = 12;
/**
 * Vertical search window for the tilt secant. Deliberately double STEP_LIMIT:
 * tilt and locomotion use different budgets, so a character tilts smoothly
 * across terrain it could never walk over.
 */
export const TILT_WINDOW_Y = 25;

/** Aim limits, in degrees, measured RELATIVE TO THE CHASSIS. See ADR 0003. */
export const AIM_MIN_DEG = -20;
export const AIM_MAX_DEG = 90;

/** Airborne graduated climb: try lifting 1..N px before bouncing off a wall. */
export const AIRBORNE_CLIMB_MAX = 5;
/** Speed multiplier applied per pixel climbed while airborne. */
export const AIRBORNE_CLIMB_DAMP = [0.96, 0.93, 0.9, 0.87, 0.84];
/** Horizontal restitution when an airborne character hits a true wall. TUNE. */
export const WALL_ELASTICITY = 0.4;
