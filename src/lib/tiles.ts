// Pré-charge les fonds de carte IGN autour de la tournée pour l'avoir hors-ligne.
// Les tuiles passent par le service worker, qui les garde en cache.
import type { Tournee } from './types';
import { getKV, setKV } from './db';
import { isDemo } from './demo';

export const TILE_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

const MAX_TILES = 4000;

function tileXY(lat: number, lon: number, z: number) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

export function tilesFor(t: Tournee): string[] {
  const pts = [...t.track, ...t.segments.flatMap((s) => s.path ?? []), ...t.segments.flatMap((s) => s.addrIds.map((id) => t.addrs[id]).filter(Boolean))];
  if (!pts.length) return [];
  const keys = new Set<string>();
  const add = (z: number, x: number, y: number) => keys.add(`${z}/${x}/${y}`);
  for (const z of [15, 16]) {
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const a = tileXY(Math.max(...lats), Math.min(...lons), z);
    const b = tileXY(Math.min(...lats), Math.max(...lons), z);
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) add(z, x, y);
  }
  for (const z of [17, 18]) {
    const pad = 1; // une tuile autour : la carte tourne, il faut de la marge
    for (const p of pts) {
      const { x, y } = tileXY(p.lat, p.lon, z);
      for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) add(z, x + dx, y + dy);
    }
  }
  return [...keys].slice(0, MAX_TILES).map((k) => {
    const [z, x, y] = k.split('/');
    return TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  });
}

/** Lance le pré-chargement si besoin. `onProgress(fait, total)`. */
export async function prefetchTiles(t: Tournee, onProgress: (done: number, total: number) => void): Promise<boolean> {
  if (isDemo() || !navigator.onLine || !('serviceWorker' in navigator)) return false;
  const key = `tiles-${t.id}`;
  const last = await getKV<number>(key);
  if (last && last > t.updatedAt && Date.now() - last < 30 * 86400 * 1000) {
    onProgress(1, 1);
    return true;
  }
  const urls = tilesFor(t);
  let done = 0;
  let failed = 0;
  onProgress(0, urls.length);
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift()!;
      try {
        await fetch(u, { mode: 'no-cors' });
      } catch {
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === urls.length) onProgress(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (failed < urls.length * 0.1) await setKV(key, Date.now());
  return failed === 0;
}
