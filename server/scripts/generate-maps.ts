/**
 * Map generator — the ONLY source of the game's maps.
 *
 * Emits one PNG per map into `client/public/maps/`, plus a `maps.json` manifest
 * carrying the spawn points. That directory is the single canonical location
 * (ADR 0002: server mask and client texture must come from one file) — the
 * client serves it statically, and the server reads the very same file through
 * `server/src/adapters/MapLoader.ts`. There is no copy step and therefore
 * nothing that can drift.
 *
 * A pixel is SOLID iff its alpha is > 0. RGB is purely cosmetic (client texture).
 *
 * Run:  pnpm --filter @browserbond/server run generate-maps
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const MAP_WIDTH = 2000;
const MAP_HEIGHT = 1200;

const OUT_DIR = resolve(__dirname, '../../client/public/maps');

type SolidFn = (x: number, y: number) => boolean;

interface MapSpec {
  id: string;
  /** Human note about what physics feature this map exercises. */
  notes: string;
  solid: SolidFn;
  spawns: Array<{ x: number; y: number }>;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Linear interpolation of a piecewise surface defined by (x, y) knots. */
function piecewise(knots: Array<[number, number]>): (x: number) => number {
  return (x: number) => {
    if (x <= knots[0][0]) return knots[0][1];
    for (let i = 1; i < knots.length; i++) {
      const [x0, y0] = knots[i - 1];
      const [x1, y1] = knots[i];
      if (x <= x1) {
        const t = x1 === x0 ? 1 : (x - x0) / (x1 - x0);
        return y0 + (y1 - y0) * t;
      }
    }
    return knots[knots.length - 1][1];
  };
}

function ellipse(cx: number, cy: number, rx: number, ry: number) {
  return (x: number, y: number) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
}

function box(x0: number, y0: number, x1: number, y1: number) {
  return (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
}

// ---------------------------------------------------------------------------
// Maps
//
// Deliberately SIMPLE: broad slopes and small mountains, no pre-carved caves,
// pits or cliffs. Craters are the game's job — every hole in the ground should
// be one a player made.
//
// Every surface here is built from sine components, and the gradient of
// `A * sin(x / L)` is `A / L`. Keeping each component's A/L low bounds the
// steepest slope on the map, which matters for two reasons: a slope steeper
// than the body can climb is an invisible wall, and an axis-aligned body hovers
// past a crest by roughly `half its width * the gradient there`. Gentle terrain
// keeps both artifacts small. The sum of the A/L values below stays under ~0.5,
// i.e. about 27 degrees at the very steepest.
// ---------------------------------------------------------------------------

/** Smooth bump — a small mountain. Peak gradient is `height / (width * 1.65)`. */
function bump(cx: number, height: number, width: number) {
  return (x: number) => {
    const d = (x - cx) / width;
    return height * Math.exp(-d * d);
  };
}

/** Place a spawn on the surface, dropped in from a little above it. */
function spawnOn(surface: (x: number) => number, x: number) {
  return { x, y: Math.round(surface(x)) - 70 };
}

// Map 1 — gentle-hills: broad rolling ground, nothing steep anywhere.
const gentleHillsSurface = (x: number): number =>
  780 +
  60 * Math.sin(x / 300) +      // A/L = 0.20
  25 * Math.sin(x / 150 + 1.1) + // A/L = 0.17
  10 * Math.sin(x / 80 + 0.5);   // A/L = 0.13

const gentleHills: MapSpec = {
  id: 'gentle-hills',
  notes: 'broad rolling ground, max gradient ~0.5',
  solid: (x, y) => y >= gentleHillsSurface(x),
  spawns: [spawnOn(gentleHillsSurface, 400), spawnOn(gentleHillsSurface, 1500)],
};

// Map 2 — twin-peaks: two small mountains with a valley between them, so
// arcing over high ground is the shot rather than a flat duel.
const twinPeaksSurface = (x: number): number => {
  const left = bump(520, 190, 300);   // peak gradient ~0.38
  const right = bump(1480, 165, 290); // peak gradient ~0.34
  return 880 - left(x) - right(x) + 14 * Math.sin(x / 110 + 0.9); // A/L = 0.13
};

const twinPeaks: MapSpec = {
  id: 'twin-peaks',
  notes: 'two small mountains either side of a shallow valley',
  solid: (x, y) => y >= twinPeaksSurface(x),
  spawns: [spawnOn(twinPeaksSurface, 300), spawnOn(twinPeaksSurface, 1700)],
};

// Map 3 — open-field: almost flat. The control map — if something feels wrong
// here, it is not the terrain's fault.
const openFieldSurface = (x: number): number =>
  860 +
  28 * Math.sin(x / 420) +      // A/L = 0.07
  12 * Math.sin(x / 170 + 2.0) + // A/L = 0.07
  bump(1000, 70, 380)(x) * -1;   // one broad, low central rise

const openField: MapSpec = {
  id: 'open-field',
  notes: 'near-flat ground with one low central rise',
  solid: (x, y) => y >= openFieldSurface(x),
  spawns: [spawnOn(openFieldSurface, 350), spawnOn(openFieldSurface, 1650)],
};

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

/**
 * Cheap deterministic mottling so the texture is not a flat colour.
 *
 * Quantised to 4px blocks and 5 levels on purpose: per-pixel noise defeats PNG
 * row filtering and inflates the file the client has to download by ~5x.
 */
function noise(x: number, y: number): number {
  const bx = Math.floor(x / 4);
  const by = Math.floor(y / 4);
  const n = Math.sin(bx * 12.9898 + by * 78.233) * 43758.5453;
  return Math.floor((n - Math.floor(n)) * 5) / 4;
}

function render(spec: MapSpec): PNG {
  const png = new PNG({ width: MAP_WIDTH, height: MAP_HEIGHT, deflateLevel: 9 });
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const i = (y * MAP_WIDTH + x) << 2;
      if (!spec.solid(x, y)) {
        png.data[i] = 0;
        png.data[i + 1] = 0;
        png.data[i + 2] = 0;
        png.data[i + 3] = 0; // transparent === free space
        continue;
      }
      // Depth below the local surface drives the shading.
      let depth = 0;
      while (depth < 14 && spec.solid(x, y - depth - 1)) depth++;
      const n = noise(x, y) * 18 - 9;
      let r: number, g: number, b: number;
      if (depth < 5) {
        r = 96;
        g = 150;
        b = 62; // grass / moss cap
      } else if (depth < 14) {
        r = 122;
        g = 88;
        b = 52; // topsoil
      } else {
        const t = Math.min(1, (y - 400) / 800);
        r = 92 - 26 * t;
        g = 66 - 20 * t;
        b = 48 - 16 * t; // rock, darkening with depth
      }
      png.data[i] = Math.max(0, Math.min(255, Math.round(r + n)));
      png.data[i + 1] = Math.max(0, Math.min(255, Math.round(g + n)));
      png.data[i + 2] = Math.max(0, Math.min(255, Math.round(b + n)));
      png.data[i + 3] = 255;
    }
  }
  return png;
}

const specs: MapSpec[] = [gentleHills, twinPeaks, openField];

mkdirSync(OUT_DIR, { recursive: true });

for (const spec of specs) {
  const png = render(spec);
  const file = join(OUT_DIR, `${spec.id}.png`);
  writeFileSync(file, PNG.sync.write(png, { deflateLevel: 9 }));
  console.log(`wrote ${file}  (${spec.notes})`);
}

const manifest = {
  $comment: 'Generated by server/scripts/generate-maps.ts — do not edit by hand.',
  maps: specs.map((s) => ({ id: s.id, file: `${s.id}.png`, spawns: s.spawns })),
};
const manifestPath = join(OUT_DIR, 'maps.json');
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${manifestPath}`);
