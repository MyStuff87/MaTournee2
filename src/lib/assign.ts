// À partir du tracé d'un tronçon, retrouve les adresses devant lesquelles
// le facteur est passé, et prépare les lignes à dessiner.
import type { Addr, LL, Segment, SegSide } from './types';
import { AddressIndex, isEven, sortByNum } from './addressIndex';
import { bearing, dist, projectDetailed, sideOf, simplify } from './geo';

/** Distance max entre le trajet et une adresse « devant laquelle on passe ». */
export const PASS_RADIUS = 35;
/** Tolérance du lissage en lignes droites (m). */
export const STRAIGHTEN = 7;

const parityOk = (a: Addr, side: SegSide) =>
  side === 'both' || (side === 'pair' ? isEven(a) : side === 'impair' ? !isEven(a) : false);

export interface Assigned {
  path: LL[];
  addrIds: string[];
  streetKey: string;
  street: string;
  city: string;
  streets: string[];
}

export function straighten(raw: LL[]): LL[] {
  return raw.length < 2 ? raw.slice() : simplify(raw, STRAIGHTEN);
}

export function assignSegment(side: SegSide, raw: LL[], index: AddressIndex, taken: Set<string>): Assigned {
  const path = straighten(raw);
  const empty = (): Assigned => {
    const mid = raw[Math.floor(raw.length / 2)];
    const c = mid ? index.candidates(mid, 60)[0] : undefined;
    return { path, addrIds: [], streetKey: c?.streetKey ?? '', street: c?.street ?? '', city: c?.city ?? '', streets: c ? [c.street] : [] };
  };
  if (side === 'none' || path.length < 2) return empty();

  // 1. Adresses proches du trajet, du bon côté (pair / impair), longées.
  const cands = new Map<string, Addr>();
  let lastProbe: LL | null = null;
  for (const p of raw) {
    if (lastProbe && dist(lastProbe, p) < 10) continue;
    lastProbe = p;
    for (const a of index.near(p, PASS_RADIUS + 10)) if (parityOk(a, side)) cands.set(a.id, a);
  }
  const along = new Map<string, number>();
  const accepted: Addr[] = [];
  const dirCache = new Map<string, number | null>();
  for (const a of cands.values()) {
    if (taken.has(a.id)) continue;
    const pr = projectDetailed(a, path);
    if (!pr.inside || pr.d > PASS_RADIUS) continue;
    // La rue de l'adresse doit aller dans le même sens que le trajet :
    // on écarte les maisons des rues qui croisent (angles de rue).
    if (!dirCache.has(a.streetKey)) dirCache.set(a.streetKey, streetBearing(index, a.streetKey));
    const sb = dirCache.get(a.streetKey);
    if (sb !== null && sb !== undefined && axisAngle(sb, bearing(path[pr.seg], path[pr.seg + 1])) > 45) continue;
    {
      accepted.push(a);
      along.set(a.id, pr.along);
    }
  }

  // 2. Une seule adresse d'une rue (souvent la maison d'angle d'une rue croisée) : on l'écarte.
  const byStreet = new Map<string, Addr[]>();
  for (const a of accepted) (byStreet.get(a.streetKey) ?? byStreet.set(a.streetKey, []).get(a.streetKey)!).push(a);
  for (const [k, list] of byStreet) {
    const total = (index.street(k)?.addrs ?? []).filter((a) => parityOk(a, side)).length;
    if (list.length < 2 && total > 2) byStreet.delete(k);
  }

  // 3. On bouche les trous : numéros manqués entre le plus petit et le plus grand vus.
  const chosen = new Map<string, Addr>();
  for (const [k, list] of byStreet) {
    const all = index.street(k)?.addrs ?? [];
    for (const even of [true, false]) {
      const nums = list.filter((a) => isEven(a) === even).map((a) => a.num);
      if (!nums.length) continue;
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      for (const a of all) {
        if (isEven(a) !== even || a.num < lo || a.num > hi || taken.has(a.id) || !parityOk(a, side)) continue;
        chosen.set(a.id, a);
        if (!along.has(a.id)) along.set(a.id, projectDetailed(a, path).along);
      }
    }
  }
  if (!chosen.size) return empty();

  // 4. Ordre de passage.
  const ordered = [...chosen.values()].sort((a, b) => along.get(a.id)! - along.get(b.id)! || sortByNum(a, b));
  const counts = new Map<string, number>();
  const streets: string[] = [];
  for (const a of ordered) {
    counts.set(a.streetKey, (counts.get(a.streetKey) ?? 0) + 1);
    if (!streets.includes(a.street)) streets.push(a.street);
  }
  const mainKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const main = ordered.find((a) => a.streetKey === mainKey)!;
  return { path, addrIds: ordered.map((a) => a.id), streetKey: mainKey, street: main.street, city: main.city, streets };
}

/** Orientation générale d'une rue (du plus petit au plus grand numéro), ou null si inconnue. */
function streetBearing(index: AddressIndex, key: string): number | null {
  const addrs = index.street(key)?.addrs ?? [];
  let best: number | null = null;
  let bestLen = 0;
  for (const even of [true, false]) {
    const l = addrs.filter((a) => isEven(a) === even);
    if (l.length < 2) continue;
    const d = dist(l[0], l[l.length - 1]);
    if (d > bestLen && d > 15) {
      bestLen = d;
      best = bearing(l[0], l[l.length - 1]);
    }
  }
  return best;
}

/** Angle entre deux directions, sans tenir compte du sens (0 à 90°). */
function axisAngle(a: number, b: number): number {
  const d = Math.abs(((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
}

/** Recalcule toutes les adresses d'une tournée, tronçon par tronçon, dans l'ordre. */
export function assignAll(segments: Segment[], index: AddressIndex): Segment[] {
  const taken = new Set<string>();
  return segments.map((s) => {
    if (!s.raw || s.raw.length < 2) {
      s.addrIds.forEach((id) => taken.add(id));
      return s;
    }
    const r = assignSegment(s.side, s.raw, index, taken);
    r.addrIds.forEach((id) => taken.add(id));
    return { ...s, ...r };
  });
}

/**
 * Côté du trajet où se trouvent les adresses servies, arête par arête :
 * +1 à droite, -1 à gauche, 0 au milieu (les deux côtés ou rien).
 */
export function sideSigns(path: LL[], side: SegSide, addrs: Addr[]): number[] {
  const n = Math.max(0, path.length - 1);
  if (side === 'both' || side === 'none' || n === 0) return new Array(n).fill(0);
  const sum = new Array(n).fill(0);
  for (const a of addrs) {
    const pr = projectDetailed(a, path);
    sum[pr.seg] += sideOf(a, path[pr.seg], path[pr.seg + 1]);
  }
  const signs = sum.map((v) => Math.sign(v));
  // arêtes sans adresse : on reprend le côté voisin
  for (let i = 1; i < n; i++) if (!signs[i]) signs[i] = signs[i - 1];
  for (let i = n - 2; i >= 0; i--) if (!signs[i]) signs[i] = signs[i + 1];
  return signs;
}

/** Ancienne tournée (sans tracé par tronçon) : on fabrique un tracé à partir des adresses. */
export function migrateSegment(s: Segment, addrs: Record<string, Addr> | ((id: string) => Addr | undefined)): Segment {
  if (s.path && s.path.length) return s;
  const get = typeof addrs === 'function' ? addrs : (id: string) => addrs[id];
  const pts = s.addrIds.map(get).filter((a): a is Addr => !!a).map((a) => ({ lat: a.lat, lon: a.lon }));
  return { ...s, path: simplify(pts, STRAIGHTEN) };
}
