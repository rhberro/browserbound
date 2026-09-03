# What Else to Take From OpenBound

A survey of `rodrigobmg/OpenBound` (GPL, C#/MonoGame) beyond the movement rework, which is covered
in `implementation-plan-point-contact-movement.md` and ADR 0004. Everything here is ranked by
payoff against cost, and each item names the file it came from so the claim can be checked.

Two other sources were re-evaluated and remain unusable: the `jeffreyim.wordpress.com` post is a
hobbyist regression of ballistics only, and `jglim/gunbound-server` is protocol and lobby with no
physics.

**Already done** (see the commit that added this file): the projectile ceiling, sky craters, and the
oriented hitbox. They are written up in "Landed" at the bottom rather than as proposals.

---

## Tier 1 — take these

### 1. The Delay system (turn order as a priority queue)

**Source:** `Openbound Network Object Library/Entity/MatchManager.cs`, `MobileMetadata.cs`.

GunBound's signature mechanic, and we have nothing like it. Turn order is not round-robin — every
mobile carries a cumulative `Delay`, and the turn owner is the lowest-delay survivor:

```csharp
CurrentTurnOwner => SyncMobileList.First(x => x.IsAlive);   // list kept sorted by Delay
sMob.Delay += MobileMetadata.GetDelay(owner, shotType);      // acting costs delay
SyncMobileList = SyncMobileList.OrderBy(x => x.Delay).ToList();
```

Real costs from `DelayPresets` (per mobile, ~20 of them):

| Action | Cost |
|---|---|
| Shot 1 | 730–770 |
| Shot 2 | 800–960 |
| SS | 1280–1320 |
| Skip turn | 200 (`TurnSkipDelayCost`) |

So a cheap shot can buy you two turns in a row, an SS hands the opponent two, and passing is
dramatically cheap. Items cost delay too, and an `SSCooldownTimer` of 3 turns gates the big shot on
top of its price.

**Why it matters for us:** our weapon table currently varies only in damage, splash and crater — all
of which are "how much does it hurt". Delay adds "what does it cost you", which is the axis that
makes weapon choice a decision rather than a preference. It is roughly 30 lines and generalises past
two players for free.

**Cost:** medium. `currentPlayerId` stops being an index into a rotation and becomes a query over a
delay-sorted list; `advanceTurn` changes shape; the HUD wants a delay board (OpenBound has
`Interface/Delayboard.cs`). Worth doing as its own change.

### 2. Wind should drift, not teleport

**Source:** `MatchMetadata.DisturbWind()`, `NetworkObjectParameters.cs`.

Ours holds wind constant for 5–10 rounds and then jumps to a fresh random magnitude and angle.
GunBound perturbs it *every turn*, and only occasionally re-rolls:

```csharp
if (Random.NextDouble() <= 0.5) return;            // WeatherWindAngleDisturbanceChance
WindForce  = max(0, WindForce + Random(0, 4) - 2); // WeatherWindForceDisturbance, of a 0–35 range
WindAngle += Random(0, 6) - 3;                     // WeatherWindAngleDisturbance
```

That is roughly ±6% of full force and ±3° per turn. The difference in feel is large: drifting wind
is something you read once and then adjust against, while a teleporting wind has to be relearned
from scratch and makes the previous shot's information worthless. Ours currently punishes the exact
skill the mechanic is supposed to reward.

**Cost:** small, contained in `WindManager`. The duration concept can stay as the re-roll cadence.

### 3. Splash distance should measure to the body, not the feet

**Source:** `Collision/CollisionBox.GetSquaredDistance` — closest point on the box to the blast.

`GameRoom` measures splash as `hypot(player.x - collision.x, player.y - collision.y)`, and
`player.y` is the **contact point**. So a blast level with a character's head is measured as ~36px
further away than it looks, and the result disagrees with `pointInBody`, which already knows the
body is 36px tall. Closest-point-on-box is the same transform `pointInBody` now does, clamped
instead of tested.

**Cost:** small, and it shares code with the oriented hitbox that just landed.

---

## Tier 2 — real design gains, more thought than code

### 4. Per-projectile `mass` and `windInfluence`

**Source:** `Projectile.InitializeMovement`, and the `Projectile*Mass` / `Projectile*WindInfluence`
blocks in `Parameter.cs`.

```csharp
yMovement.Preset(ySpeed * force * ForceFactor / mass, Gravity + yWind * wForce * windInfluence);
xMovement.Preset(xSpeed * force * ForceFactor / mass,          xWind * wForce * windInfluence);
```

Two knobs we do not have. **Mass divides launch speed**, so a heavy shell needs more power for the
same range. **`windInfluence`** scales wind per weapon (values run 1.2–1.4, and a teleport beacon is
0.0 — completely wind-immune).

Ours has one global `WIND_INTEGRATION`, so every weapon flies identically in wind. These are the
main axis GunBound weapons differ on, and we already have `WeaponSpec` to hang both fields on.

**Cost:** small in code, real in balancing — every existing weapon needs values chosen.

### 5. Inverse-distance damage falloff

**Source:** `Projectile.CalculateDamage`.

```csharp
if (surfaceDistance < ExplosionRadius) {
    distance = EuclideanDistance(Position, target.CollisionBox.Center);
    damage = BaseDamage * ExplosionRadius / distance;
}
```

Gate on distance to the box surface, then compute damage from distance to the box *centre*, as an
inverse ratio rather than our linear ramp. At `distance == radius` it pays `BaseDamage`; at half
that, double. Precision is rewarded far more steeply than ours rewards it.

**Adopt with a fix:** their version has no floor on `distance`, so a dead-centre hit divides by
something near zero and the damage is unbounded. We would need the clamp they lack.

### 6. Player stats as multipliers

**Source:** `Projectile.Explode` (`Dig`), `CalculateDamage` (`Attack`/`Defense`),
`MobileMetadata.GetDelay` (`AttackDelay`), `MatchManager.ComputePlayerItem` (`ItemDelay`).

```csharp
CreateErosion(pos, ExplosionRadius * (1 + Dig / 100f));
damage * (1 + (attacker.Attack - target.Defense) / 100f);
delay  * (1 - player.AttackDelay / 100f);
```

Clean, uniform percentage modifiers hanging off avatar items. Noted for the shape, not proposed:
we have no progression system for them to attach to yet. Worth remembering that if we ever add one,
crater size, damage and delay are the three things GunBound chose to let players buy.

---

## Tier 3 — cheap polish

### 7. Aim acceleration

**Source:** `Parameter.HUDCrosshair*Sensibility`.

Ours (`useHoldRepeat`) is a flat 350ms delay then a fixed 60ms repeat. Theirs ramps: start at 0.15s
per step, subtract 0.008 each step, floor at 0.03s — so a tap is a fine adjustment and a hold
accelerates into fast travel. Small change, and aiming is the thing players do most.

### 8. Blast scorch ring

**Source:** `Topography.CreateErosion`, `Parameter.BlastBlackmask*`.

A ring `BlastBlackmaskRadius = 3` px beyond the crater is not removed but darkened to 40%
(`BlastBlackmaskExplosionRadiusColorFactor`). Pure decoration, and it is what makes an impact read
as a burn rather than a bite. Would need a client-side decal or a new terrain op kind.

### 9. Debris proportional to what was destroyed

**Source:** `Projectile.Explode` → `AsyncCreateGroundCollapseParticleEffect(removedPixels / 32, …)`.

`CreateErosion` returns the number of pixels it actually removed, and the particle count is that
over 32. A shot into open ground throws up dirt; the same shot into an existing crater throws up
almost none. We already compute the count in `destroyTerrain` — it is currently discarded.

---

## Tier 4 — big, and not yet

### 10. Weather and map hazards

**Source:** `GameComponents/WeatherEffect/`, `NetworkObjectParameters.ActiveWeatherEffectList`.

Seven of them — Force, Tornado, Electricity, Weakness, Mirror, Random, Thor — each hooking the
projectile mid-flight through `Projectile.OnBegin*Interaction`. Mirror inverts horizontal velocity
(`xMovement.InverseMovement()`), Thor attaches the shot to a satellite, Force and Weakness scale
damage. `Projectile.InteractedWeatherSet` exists so one shot cannot be affected twice by the same
band.

Easily the most *fun* thing in the repository, and the right thing to build once weapons and turn
order are interesting enough to be worth disrupting. After the Delay system, not before.

### 11. Multiple shot types per mobile

Every mobile has S1, S2 and SS with distinct damage, radius, mass, wind influence and delay. Our
`weaponType` field is already the seam this would slot into, and it is what makes the Delay system
worth having. Realistically these two land together.

---

## Do not copy

### `AcceleratedMovement` is missing a factor of ½

**Source:** `Physics/AcceleratedMovement.RefreshCurrentPosition`.

```csharp
CurrentSpeed    = InitialSpeed + Acceleration * CurrentTime;
CurrentPosition = CurrentSpeed * CurrentTime;   // = v0·t + a·t²
```

The kinematic is `v0·t + ½a·t²`. Their `ProjectileMovementGravity = 9.8 * 20` therefore behaves like
twice that. Copy the trajectory *shape* and tune against it; never port their gravity, force or mass
numbers directly, because every one of them is compensating for this.

### Their terrain indexing is only correct on square maps

**Source:** `Topography.CreateErosion`, `Movement.MoveSideways`.

```csharp
int i = h * CollidableForegroundMatrix.Length + w;   // .Length is the ROW COUNT — the height
if (relPos[0] > 0 && relPos[0] < Topography.MapHeight && …)   // an X bound checked against height
```

Both use height where width belongs. Our terrain code is right; do not "fix" it toward theirs.

### Their projectile sub-stepping is not an upgrade

**Source:** `Projectile.UpdatePosition`, `Parameter.ProjectileMovement*`.

Thirty iterations of `0.0005s` inside each `0.015s` frame, as continuous collision detection. Our
ray-march at `ceil(distance)` steps (capped at 200) is equivalent or finer, and it is already
integrated with the terrain mask. No change needed.

---

## Landed

Fixed on the point-contact branch. The three original items came with the
commit that introduced this document; the rest are later tickets.

**The projectile ceiling.** Ours was `proj.y < -50`, against GunBound's deliberate
`ProjectilePlayableMapAreaYLimit = -300`. At `POWER_SCALE 0.3` and `GRAVITY 0.4` a shot's apex is
`v² / 2g` above the muzzle — 405px at power 60, 720px at 80, **1125px at full power**, more than the
map is tall. Every high-angle shot above roughly 87 power was deleted in mid-flight. Now
`PROJECTILE_CEILING`, separate from the tight side and floor margins.

**Craters in the sky.** Out-of-bounds produced a `'miss'` collision, and every collision fell
through to `destroyTerrain` plus a `collision` broadcast — so a shot leaving the field dug a hole at
the boundary and, going out over the top, drew an explosion in open air. A miss no longer craters.

**The oriented hitbox.** `pointInBody` now leans with the chassis. See the amendment to ADR 0004 for
why the original axis-aligned decision did not survive the move to point contact, and for the
numbers: at 20° of tilt the drawn head sat 11.6px outside the level box.

**Wind drifts each turn (#29).** Wind is no longer held for several rounds and
then teleported; it is nudged every turn (magnitude clamped, angle wrapped) and
re-rolled on its own cadence, so the shot you just took informs the next one.
`WindManager` counts turns, never rounds.

**Splash measures to the drawn body (#30).** `distanceToBody` shares the
oriented-box transform with `pointInBody`, so a blast at head height and one at
foot height score identically and a blast inside the body is distance zero.

**Per-weapon mass and wind influence (#31).** Each weapon declares a `mass`
(launch-speed divisor) and a `windInfluence` (wind-drift scale) beside its other
fields; both reach `PhysicsAdapter` as parameters, so it never learns what a
weapon is.

**Blast scorch ring (#34).** Craters darken a thin band just outside the erased
radius. Client-side only, derived from the op log, so a late joiner's battlefield
matches and solidity is untouched.

**Impact debris (#33).** Explosions throw debris scaled to the terrain pixels
they actually removed, drawn by a minimal pooled particle system.

**Aim acceleration (#32).** Held aim controls ramp up to a floor instead of
repeating at a fixed rate.
