// Petits outils géométriques en mètres, sur une projection locale
// (largement suffisant à l'échelle d'une rue).

const R = 6371000;
const RAD = Math.PI / 180;

export interface LL {
  lat: number;
  lon: number;
}

export function dist(a: LL, b: LL): number {
  const x = (b.lon - a.lon) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  const y = (b.lat - a.lat) * RAD;
  return Math.sqrt(x * x + y * y) * R;
}

/** Coordonnées planes (m) relatives à une origine. */
export function xy(p: LL, o: LL): [number, number] {
  return [(p.lon - o.lon) * RAD * Math.cos(o.lat * RAD) * R, (p.lat - o.lat) * RAD * R];
}

/** Distance d'un point à un segment [a,b], et position t ∈ [0,1] du projeté. */
export function distToSeg(p: LL, a: LL, b: LL): { d: number; t: number } {
  const [px, py] = xy(p, a);
  const [bx, by] = xy(b, a);
  const l2 = bx * bx + by * by;
  let t = l2 === 0 ? 0 : (px * bx + py * by) / l2;
  t = Math.max(0, Math.min(1, t));
  const dx = px - t * bx;
  const dy = py - t * by;
  return { d: Math.sqrt(dx * dx + dy * dy), t };
}

/** Distance d'un point à une polyligne + abscisse curviligne (m) du projeté. */
export function projectOnLine(p: LL, line: LL[]): { d: number; along: number } {
  if (line.length === 0) return { d: Infinity, along: 0 };
  if (line.length === 1) return { d: dist(p, line[0]), along: 0 };
  let best = { d: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = dist(line[i], line[i + 1]);
    const { d, t } = distToSeg(p, line[i], line[i + 1]);
    if (d < best.d) best = { d, along: acc + t * segLen };
    acc += segLen;
  }
  return best;
}

/** Cap (degrés, 0 = nord, sens horaire) de a vers b. */
export function bearing(a: LL, b: LL): number {
  const [x, y] = xy(b, a);
  return (Math.atan2(x, y) / RAD + 360) % 360;
}

export function formatDist(m: number): string {
  if (!isFinite(m)) return '';
  if (m < 10) return 'tu y es';
  if (m < 1000) return `à ${Math.round(m / 5) * 5} m`;
  return `à ${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Point situé à `m` mètres vers l'est et `n` vers le nord de o. */
export function offsetLL(o: LL, east: number, north: number): LL {
  return { lat: o.lat + north / R / RAD, lon: o.lon + east / (R * Math.cos(o.lat * RAD)) / RAD };
}

/** Simplification de Douglas-Peucker : garde les coins, efface le zigzag. */
export function simplify(pts: LL[], eps: number): LL[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1;
    let bd = eps;
    for (let i = a + 1; i < b; i++) {
      const { d } = distToSeg(pts[i], pts[a], pts[b]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function lineLength(line: LL[]): number {
  let s = 0;
  for (let i = 1; i < line.length; i++) s += dist(line[i - 1], line[i]);
  return s;
}

/**
 * Projection détaillée sur une polyligne : distance, abscisse, segment,
 * et si le projeté tombe « à l'intérieur » (pas au-delà des extrémités).
 */
export function projectDetailed(p: LL, line: LL[]) {
  let best = { d: Infinity, along: 0, seg: 0, t: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const len = dist(line[i], line[i + 1]);
    const { d, t } = distToSeg(p, line[i], line[i + 1]);
    if (d < best.d) best = { d, along: acc + t * len, seg: i, t };
    acc += len;
  }
  const total = acc;
  return { ...best, total, inside: best.along > 0.5 && best.along < total - 0.5 };
}

/** Côté d'un point par rapport au sens a→b : +1 à droite, -1 à gauche. */
export function sideOf(p: LL, a: LL, b: LL): number {
  const [bx, by] = xy(b, a);
  const [px, py] = xy(p, a);
  return bx * py - by * px < 0 ? 1 : -1;
}

/** Point à l'abscisse `along` sur la ligne, et cap à cet endroit. */
export function pointAt(line: LL[], along: number): { p: LL; heading: number } {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const len = dist(line[i], line[i + 1]);
    if (acc + len >= along || i === line.length - 2) {
      const t = len ? Math.max(0, Math.min(1, (along - acc) / len)) : 0;
      const a = line[i];
      const b = line[i + 1];
      return { p: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }, heading: bearing(a, b) };
    }
    acc += len;
  }
  return { p: line[0], heading: 0 };
}

/** Morceau d'une polyligne entre deux abscisses (en mètres). */
export function subLine(line: LL[], from: number, to: number): LL[] {
  const out: LL[] = [];
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = dist(a, b);
    const s = acc;
    const e = acc + len;
    acc = e;
    if (e < from || s > to) continue;
    const at = (t: number) => ({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    if (!out.length) out.push(len ? at(Math.max(0, (from - s) / len)) : a);
    out.push(len ? at(Math.min(1, (to - s) / len)) : b);
  }
  return out;
}
