// Quartier fictif pour essayer l'appli sans sortir (ajouter ?demo à l'adresse).
import type { Addr, Fix } from './types';
import type { LL } from './geo';

export const DEMO_CENTER: LL = { lat: 45.83, lon: 1.26 };
const M_LAT = 1 / 111320;
const M_LON = 1 / (111320 * Math.cos((DEMO_CENTER.lat * Math.PI) / 180));
const toLL = (x: number, y: number): LL => ({ lat: DEMO_CENTER.lat + y * M_LAT, lon: DEMO_CENTER.lon + x * M_LON });

export function isDemo(): boolean {
  try {
    return new URLSearchParams(location.search).has('demo');
  } catch {
    return false;
  }
}

const STREETS: { name: string; a: [number, number]; b: [number, number] }[] = [
  { name: 'Rue des Tilleuls', a: [0, 0], b: [300, 0] },
  { name: 'Rue Pasteur', a: [300, 0], b: [300, 240] },
  { name: 'Avenue du Parc', a: [300, 240], b: [0, 240] },
  { name: 'Rue Jean Jaurès', a: [0, 0], b: [0, 240] },
  { name: 'Impasse des Lilas', a: [150, 0], b: [150, -130] },
];

let cache: Addr[] | null = null;
function allDemo(): Addr[] {
  if (cache) return cache;
  const out: Addr[] = [];
  for (const s of STREETS) {
    const [ax, ay] = s.a;
    const [bx, by] = s.b;
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    // gauche = impair, droite = pair (dans le sens de la numérotation)
    const lx = -uy, ly = ux;
    let odd = 1, even = 2;
    for (let d = 14; d <= len - 12; d += 20) {
      for (const side of [1, -1]) {
        const num = side === 1 ? odd : even;
        const x = ax + ux * d + lx * 10 * side;
        const y = ay + uy * d + ly * 10 * side;
        const p = toLL(x, y);
        const mk = (rep: string, shift: number): Addr => ({
          id: `demo-${s.name}-${num}${rep}`,
          num, rep, street: s.name,
          streetKey: `99999|${s.name.toLowerCase()}`,
          insee: '99999', city: 'Démoville',
          lat: p.lat + uy * shift * M_LAT, lon: p.lon + ux * shift * M_LON,
        });
        out.push(mk('', 0));
        if (num === 7) out.push(mk('bis', 6));
      }
      odd += 2;
      even += 2;
    }
  }
  return (cache = out);
}

export function demoAddressesInBox(b: { minLat: number; maxLat: number; minLon: number; maxLon: number }): Addr[] {
  return allDemo().filter((a) => a.lat >= b.minLat && a.lat < b.maxLat && a.lon >= b.minLon && a.lon < b.maxLon);
}

/** Parcours du facteur fictif, en mètres. */
const ROUTE: [number, number][] = [
  [-40, -5], [300, -5], // Tilleuls côté pair
  [305, 0], [305, 236], // Pasteur côté pair (droite en montant)
  [300, 245], [0, 245], // Parc côté pair
  [-5, 240], [-5, 0], // Jaurès … côté pair à droite en descendant ? (sens inverse)
  [0, 5], [150, 5], // retour Tilleuls côté impair, première moitié
  [145, 0], [145, -125], [155, -125], [155, 0], // impasse, les deux côtés
  [150, 5], [300, 5], // fin des Tilleuls côté impair
];

export function demoTrack(step = 1.4): LL[] {
  const pts: LL[] = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const [ax, ay] = ROUTE[i];
    const [bx, by] = ROUTE[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const jx = Math.sin((i * 31 + k) * 1.7) * 2;
      const jy = Math.cos((i * 17 + k) * 1.3) * 2;
      pts.push(toLL(ax + (bx - ax) * t + jx, ay + (by - ay) * t + jy));
    }
  }
  return pts;
}

/** Simule un GPS qui suit le parcours démo. */
export function startDemoGPS(onFix: (f: Fix) => void, speed = 1): () => void {
  const pts = demoTrack();
  let i = 0;
  const h = setInterval(() => {
    const p = pts[Math.min(i, pts.length - 1)];
    onFix({ lat: p.lat, lon: p.lon, acc: 5, t: Date.now(), speed: 1.4 });
    i++;
  }, 1000 / speed);
  return () => clearInterval(h);
}
