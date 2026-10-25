// « Rejoindre ma tournée » : itinéraire de la position actuelle jusqu'au point
// de départ (ou de reprise) de la tournée.
// 1. calcul d'itinéraire de l'IGN (Géoplateforme), 2. à défaut les rues déjà
// chargées sur le téléphone, 3. en dernier recours une ligne droite.
import type { LL, Mode } from './types';
import { dist } from './geo';
import { isDemo } from './demo';
import type { RoadIndex } from './roads';

export interface JoinRoute {
  line: LL[];
  meters: number;
  source: 'ign' | 'local' | 'direct';
}

async function ign(from: LL, to: LL, mode: Mode): Promise<LL[] | null> {
  if (isDemo()) return null;
  const profile = mode === 'pied' ? 'pedestrian' : 'car';
  const url =
    'https://data.geopf.fr/navigation/itineraire?resource=bdtopo-osrm' +
    `&start=${from.lon},${from.lat}&end=${to.lon},${to.lat}` +
    `&profile=${profile}&optimization=fastest&geometryFormat=geojson&getSteps=false`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const coords: number[][] | undefined = j?.geometry?.coordinates;
    if (!coords?.length) return null;
    return coords.map(([lon, lat]) => ({ lat, lon }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function joinRoute(from: LL, to: LL, mode: Mode, roads?: RoadIndex): Promise<JoinRoute> {
  const len = (l: LL[]) => l.reduce((s, p, i) => (i ? s + dist(l[i - 1], p) : 0), 0);
  const a = await ign(from, to, mode);
  if (a && a.length >= 2) return { line: [from, ...a, to], meters: len(a), source: 'ign' };
  if (roads) {
    const s = roads.nearest(from, 60);
    const e = roads.nearest(to, 60);
    const r = s && e ? roads.route(s, e, 8000) : null;
    if (r && r.length >= 2) return { line: [from, ...r, to], meters: len(r), source: 'local' };
  }
  return { line: [from, to], meters: dist(from, to), source: 'direct' };
}
