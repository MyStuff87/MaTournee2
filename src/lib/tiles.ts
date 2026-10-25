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

function tileXYZ(lat: number, lon: number, z: number) {
  return tileXY(lat, lon, z);
}

/** Tuiles vectorielles (OpenFreeMap) couvrant la tournée, zooms 10 à 14 (au-delà, la carte agrandit). */
async function vectorTilesFor(t: Tournee): Promise<string[]> {
  const r = await fetch('https://tiles.openfreemap.org/planet');
  const tpl: string | undefined = (await r.json())?.tiles?.[0];
  if (!tpl) return [];
  const pts = [...t.track, ...t.segments.flatMap((s) => s.path ?? []), ...Object.values(t.addrs)];
  if (!pts.length) return [];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const m = 0.01; // ~1 km de marge
  const out: string[] = [];
  for (let z = 10; z <= 14; z++) {
    const a = tileXYZ(Math.max(...lats) + m, Math.min(...lons) - m, z);
    const b = tileXYZ(Math.min(...lats) - m, Math.max(...lons) + m, z);
    for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) out.push(tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
  }
  return out.slice(0, 1500);
}

/** Lance le pré-chargement si besoin. `onProgress(fait, total)`. */
export async function prefetchTiles(t: Tournee, onProgress: (done: number, total: number) => void): Promise<boolean> {
  if (isDemo() || !navigator.onLine || !('serviceWorker' in navigator)) return false;
  const key = `tiles2-${t.id}`;
  const last = await getKV<number>(key);
  if (last && last > t.updatedAt && Date.now() - last < 30 * 86400 * 1000) {
    onProgress(1, 1);
    return true;
  }
  let urls: string[];
  try {
    urls = await vectorTilesFor(t);
    // le style et ses polices / icônes, pour afficher la carte hors-ligne
    urls.push('https://tiles.openfreemap.org/styles/liberty', 'https://tiles.openfreemap.org/styles/dark');
  } catch {
    urls = tilesFor(t); // service vectoriel injoignable : images IGN
  }
  let done = 0;
  let failed = 0;
  onProgress(0, urls.length);
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift()!;
      try {
        await fetch(u, u.includes('openfreemap') ? {} : { mode: 'no-cors' });
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
