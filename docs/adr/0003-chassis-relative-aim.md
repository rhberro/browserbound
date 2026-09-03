# ADR 0003: Aim is measured relative to the chassis, and clamped

## Status

Accepted — 2026-09-02

## Context

Characters sit on destructible ground and tilt to match its slope. Given tilt exists, aim can be
measured two ways, and the choice is a gameplay rule rather than a rendering detail:

- **World-absolute aim.** The angle a player dials in is the angle the projectile leaves at. Tilt
  is decoration. A shot is reproducible from anywhere: 60° is 60° whether you stand on a plateau
  or on a crater rim.
- **Chassis-relative aim.** The angle is measured against the tilted body, so the ground under a
  character's feet changes where its shot goes.

Until now aim was world-absolute with a left/right flip, and tilt did not exist at all.

The wider question behind this is what destructible terrain is *for*. If terrain only decides where
a projectile stops, then digging is purely about removing cover and dropping people into holes. If
terrain also decides what shots are available, then where you choose to stand becomes a decision
with the same weight as angle and power.

## Decision

Aim is **measured relative to the chassis**, and confined to a fixed range relative to the chassis.

When tilt changes — because the character walked onto different ground — the **chassis-relative
measurement is preserved** and the real-world firing direction moves with the chassis. If the new
tilt would push aim outside the permitted range, aim is clamped silently; firing is never blocked.

The HUD displays the **chassis-relative** angle, because that is the value that stays put when the
player is not touching the controls.

## Consequences

**What we gain.** Terrain acquires a second kind of consequence. Standing in a crater you dug
yourself does not merely lower you — it tilts you, and the low end of the aim range stops you
firing at the ground below you. "Where do I stand" becomes a real decision rather than a matter of
range, which is precisely the payoff we wanted from destructible terrain.

**What we give up, and this is the sharp edge.** No world-frame number appears anywhere in the
HUD. A player who learns "62° reaches the far ridge" is learning something only true on the ground
they learned it on, and the displayed number will not warn them. The aim line therefore stops
being a convenience and becomes the sole world-frame feedback in the game — if it is missing,
imprecise, or hidden during any part of the aiming flow, the player is flying blind. Treat it as
part of this decision, not as UI polish.

**Second-order effects.** Aim is no longer meaningful without knowing the character's tilt, so it
cannot be validated or replayed in isolation. Walking now mutates aim as a side effect. And every
place that previously flipped an angle for facing has to be reworked, because a facing flip and a
chassis rotation are different transforms that happen to agree on level ground — they will
disagree everywhere else, quietly.

**Reversibility.** Better than it looks. Falling back to cosmetic tilt means pinning the aim frame
to world and dropping the clamp; the tilt computation itself is unaffected. The expensive part to
undo is player muscle memory, not code.

## Alternatives rejected

**Cosmetic tilt, world-absolute aim.** Simpler, keeps a truthful HUD number, keeps aim
independently testable. Rejected because it makes tilt a lie: the body visibly leans and the shot
does not care.

**Chassis-relative aim that blocks firing when out of range.** Rejected outright — a fire button
that silently does nothing, for a reason expressed only as a barrel angle, is the worst available
failure mode. Clamping explains itself: the barrel stops moving.

**Preserving the world angle across tilt changes** (barrel counter-rotates as you walk, shot stays
on target). Rejected because it is cosmetic tilt wearing a costume — if the world angle survives
every tilt change, the ground never affects the shot.
