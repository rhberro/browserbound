/**
 * MapLoader — rasterises a PNG map into the terrain mask (ADR 0002).
 *
 * Lives in the server package, not in `shared`, because it needs Node-only
 * dependencies (`node:fs`, `pngjs`). `shared` is bundled into the browser by
 * Vite, so importing `fs` there would break the client build. The client does
 * not need this module at all: it loads the same PNG as a texture through the
 * normal asset pipeline.
 *
 * A pixel is SOLID iff its alpha byte is > 0.
 *
 * Maps live in ONE place — `client/public/maps/` — so the server mask and the
 * client texture are rasterised from the same bytes and cannot drift. Override
 * with `BROWSERBOUND_MAPS_DIR` when the server is deployed without the client
 * tree alongside it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { MAP_WIDTH, MAP_HEIGHT } from '@browserbond/shared';

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface MapManifestEntry {
  id: string;
  file: string;
  spawns: SpawnPoint[];
}

export interface LoadedMap {
  id: string;
  /** `1` = solid, indexed `y * MAP_WIDTH + x`. */
  mask: Uint8Array;
  spawns: SpawnPoint[];
}

const MANIFEST_FILE = 'maps.json';

function candidateDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.BROWSERBOUND_MAPS_DIR) dirs.push(resolve(process.env.BROWSERBOUND_MAPS_DIR));
  // src/adapters -> src -> server -> repo root
  dirs.push(resolve(__dirname, '../../../client/public/maps'));
  // dist/adapters -> dist -> server -> repo root
  dirs.push(resolve(__dirname, '../../../../client/public/maps'));
  dirs.push(resolve(process.cwd(), 'client/public/maps'));
  dirs.push(resolve(process.cwd(), 'maps'));
  return dirs;
}

let cachedDir: string | null = null;

export function resolveMapsDir(): string {
  if (cachedDir) return cachedDir;
  for (const dir of candidateDirs()) {
    if (existsSync(join(dir, MANIFEST_FILE))) {
      cachedDir = dir;
      return dir;
    }
  }
  throw new Error(
    `[MapLoader] No map directory found (looked for ${MANIFEST_FILE} in: ${candidateDirs().join(', ')}). ` +
      `Run "pnpm --filter @browserbond/server run generate-maps" or set BROWSERBOUND_MAPS_DIR.`
  );
}

let cachedManifest: MapManifestEntry[] | null = null;

export function listMaps(): MapManifestEntry[] {
  if (cachedManifest) return cachedManifest;
  const path = join(resolveMapsDir(), MANIFEST_FILE);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { maps?: MapManifestEntry[] };
  if (!parsed.maps || parsed.maps.length === 0) {
    throw new Error(`[MapLoader] ${path} contains no maps`);
  }
  cachedManifest = parsed.maps;
  return cachedManifest;
}

/**
 * Decode a PNG's alpha channel into a fresh terrain mask.
 *
 * Fails loudly on a dimension mismatch: a silently mis-sized mask would produce
 * a world whose collision does not match anything a player can see.
 */
export function rasterizeMask(pngBuffer: Buffer, label = '<buffer>'): Uint8Array {
  const png = PNG.sync.read(pngBuffer);
  if (png.width !== MAP_WIDTH || png.height !== MAP_HEIGHT) {
    throw new Error(
      `[MapLoader] ${label} is ${png.width}x${png.height}, expected ${MAP_WIDTH}x${MAP_HEIGHT}`
    );
  }
  const mask = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  const data = png.data;
  for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
    if (data[p] > 0) mask[i] = 1;
  }
  return mask;
}

export function loadMap(mapId?: string): LoadedMap {
  const maps = listMaps();
  const entry = mapId ? maps.find((m) => m.id === mapId) : maps[0];
  if (!entry) {
    throw new Error(`[MapLoader] Unknown map "${mapId}". Known: ${maps.map((m) => m.id).join(', ')}`);
  }
  const path = join(resolveMapsDir(), entry.file);
  if (!existsSync(path)) throw new Error(`[MapLoader] Map file missing: ${path}`);
  if (!entry.spawns || entry.spawns.length < 2) {
    throw new Error(`[MapLoader] Map "${entry.id}" needs at least 2 spawn points`);
  }
  return {
    id: entry.id,
    mask: rasterizeMask(readFileSync(path), entry.file),
    spawns: entry.spawns,
  };
}

/** Pick a map at random — used on room creation. */
export function loadRandomMap(): LoadedMap {
  const maps = listMaps();
  return loadMap(maps[Math.floor(Math.random() * maps.length)].id);
}
