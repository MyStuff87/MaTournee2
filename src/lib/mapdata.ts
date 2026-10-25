// Fabrique les lignes à dessiner sur la carte à partir des tronçons.
import type { Addr, LL, Segment, Tournee } from './types';
import type { RouteProps, StopPin } from '../components/TourMap.svelte';
import { sideSigns, migrateSegment } from './assign';
import { dist } from './geo';
import { label } from './addressIndex';

type FC = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteProps>;
type Piece = { coords: LL[]; start: number; side: RouteProps['side']; off: number };

/** Découpe chaque tronçon en morceaux de même côté (droite / gauche / milieu). */
type Get = (id: string) => Addr | undefined;
const getter = (addrs: Record<string, Addr> | Get): Get => (typeof addrs === 'function' ? addrs : (id) => addrs[id]);

function pieces(segments: Segment[], addrs: Record<string, Addr> | Get, withStart = true): Piece[] {
  const get = getter(addrs);
  const out: Piece[] = [];
  let acc = 0;
  let last: LL | null = null;
  for (const s0 of segments) {
    const s = migrateSegment(s0, get);
    const path = s.path ?? [];
    if (path.length < 2) continue;
    if (withStart && last) acc += dist(last, path[0]);
    const signs = sideSigns(path, s.side, s.addrIds.map(get).filter(Boolean) as Addr[]);
    let cur: Piece = { coords: [path[0]], start: acc, side: s.side, off: signs[0] ?? 0 };
    for (let i = 0; i < path.length - 1; i++) {
      if (signs[i] !== cur.off) {
        out.push(cur);
        cur = { coords: [path[i]], start: acc, side: s.side, off: signs[i] };
      }
      acc += dist(path[i], path[i + 1]);
      cur.coords.push(path[i + 1]);
    }
    out.push(cur);
    last = path[path.length - 1];
  }
  return out;
}

const toCoords = (pts: LL[]) => pts.map((p) => [p.lon, p.lat]);

/** Coupe un morceau aux abscisses données. */
function cut(p: Piece, from: number, to: number): LL[] | null {
  const res: LL[] = [];
  let acc = p.start;
  for (let i = 0; i < p.coords.length - 1; i++) {
    const a = p.coords[i];
    const b = p.coords[i + 1];
    const len = dist(a, b);
    const s = acc;
    const e = acc + len;
    acc = e;
    if (e <= from || s >= to) continue;
    const t0 = len ? Math.max(0, (from - s) / len) : 0;
    const t1 = len ? Math.min(1, (to - s) / len) : 1;
    const at = (t: number) => ({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    if (!res.length) res.push(at(t0));
    res.push(at(t1));
  }
  return res.length >= 2 ? res : null;
}

/** Lignes pour le guidage : déjà fait / les prochains mètres / la suite. */
export function guideFeatures(t: Tournee, along: number, soon = 350): FC {
  const features: FC['features'] = [];
  for (const p of pieces(t.segments, t.addrs)) {
    for (const [from, to, state] of [
      [-Infinity, along, 'done'],
      [along, along + soon, 'next'],
      [along + soon, Infinity, 'later'],
    ] as const) {
      const c = cut(p, from, to);
      if (c) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: toCoords(c) }, properties: { side: p.side, off: p.off, state } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Lignes d'une liste de tronçons, tous dans le même état. */
export function plainFeatures(segments: Segment[], addrs: Record<string, Addr> | Get, state: RouteProps['state'] = 'later'): FC {
  return {
    type: 'FeatureCollection',
    features: pieces(segments, addrs, false).map((p) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: toCoords(p.coords) },
      properties: { side: p.side, off: p.off, state },
    })),
  };
}

export function mergeFC(...fcs: FC[]): FC {
  return { type: 'FeatureCollection', features: fcs.flatMap((f) => f.features) };
}

export function pinsFor(addrs: Addr[], state: StopPin['state'], notes?: Record<string, string>): StopPin[] {
  return addrs.map((a) => ({ id: a.id, label: label(a), lat: a.lat, lon: a.lon, state, note: !!notes?.[a.id] }));
}
