// Sauvegarde / transfert des tournées sous forme de fichier.
import type { Tournee } from './types';
import { listTournees, saveTournee } from './db';
import { uid } from './recorder';
import { dist, simplify } from './geo';

export async function exportTournees(only?: Tournee) {
  const list = only ? [only] : await listTournees();
  const data = JSON.stringify({ app: 'MaTournee', v: 1, tournees: list });
  const name = only ? `${only.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.matournee.json` : `matournee-sauvegarde.json`;
  const file = new File([data], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Trace GPS (fichier .gpx de Komoot, Strava, Garmin…) → tournée à découper ensuite. */
export function tourneeFromGpx(xml: string, fileName: string): Tournee | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const nodes = [...doc.getElementsByTagName('trkpt'), ...doc.getElementsByTagName('rtept')];
  const pts = nodes
    .map((n) => ({ lat: Number(n.getAttribute('lat')), lon: Number(n.getAttribute('lon')), t: Date.parse(n.getElementsByTagName('time')[0]?.textContent ?? '') }))
    .filter((p) => isFinite(p.lat) && isFinite(p.lon));
  if (pts.length < 2) return null;
  const raw = [{ lat: pts[0].lat, lon: pts[0].lon }];
  let length = 0;
  for (const p of pts.slice(1)) {
    const d = dist(raw[raw.length - 1], p);
    if (d >= 3) {
      raw.push({ lat: p.lat, lon: p.lon });
      length += d;
    }
  }
  // mode deviné d'après la vitesse moyenne
  const hours = (pts[pts.length - 1].t - pts[0].t) / 3600000;
  const kmh = hours > 0 ? length / 1000 / hours : 0;
  const mode = kmh > 18 ? 'voiture' : kmh > 6 ? 'velo' : 'pied';
  const name = doc.getElementsByTagName('name')[0]?.textContent?.trim() || fileName.replace(/\.gpx$/i, '');
  const path = simplify(raw, 7);
  const now = Date.now();
  return {
    id: uid(),
    name,
    mode,
    createdAt: now,
    updatedAt: now,
    segments: [{ id: uid(), side: 'both', path, raw, addrIds: [], streetKey: '', street: name, city: '', streets: [], autoSplit: true }],
    addrs: {},
    track: path,
  };
}

/** Importe un fichier ; renvoie les identifiants des tournées ajoutées. */
export async function importFile(f: File): Promise<string[]> {
  const text = await f.text();
  if (/\.gpx$/i.test(f.name) || text.includes('<gpx')) {
    const t = tourneeFromGpx(text, f.name);
    if (!t) return [];
    await saveTournee(t);
    return [t.id];
  }
  const j = JSON.parse(text);
  const list: Tournee[] = j?.tournees ?? (j?.segments ? [j] : []);
  const existing = new Set((await listTournees()).map((t) => t.id));
  const ids: string[] = [];
  for (const t of list) {
    if (!t?.segments || !t?.addrs) continue;
    const copy: Tournee = { ...t, id: existing.has(t.id) ? uid() : t.id, updatedAt: Date.now() };
    if (existing.has(t.id)) copy.name = `${t.name} (importée)`;
    await saveTournee(copy);
    ids.push(copy.id);
  }
  return ids;
}
