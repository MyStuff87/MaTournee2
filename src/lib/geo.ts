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
