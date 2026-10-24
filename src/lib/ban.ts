// Récupération des adresses officielles (Base Adresse Nationale, via la
// Géoplateforme IGN). Les adresses sont chargées par carrés d'environ
// 450 m et gardées sur le téléphone pour fonctionner hors-ligne.
import type { Addr } from './types';
import { getCell, saveCell } from './db';
import { demoAddressesInBox, isDemo } from './demo';

export const CELL_LAT = 0.004;
export const CELL_LON = 0.006;
const MAX_AGE = 30 * 24 * 3600 * 1000; // on rafraîchit après 30 jours

export function cellOf(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_LAT)}_${Math.floor(lon / CELL_LON)}`;
}

export function cellBox(id: string) {
  const [i, j] = id.split('_').map(Number);
  return { minLat: i * CELL_LAT, maxLat: (i + 1) * CELL_LAT, minLon: j * CELL_LON, maxLon: (j + 1) * CELL_LON };
}

/** Le carré du point et ses 8 voisins. */
export function cellsAround(lat: number, lon: number): string[] {
  const i = Math.floor(lat / CELL_LAT);
  const j = Math.floor(lon / CELL_LON);
  const out: string[] = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) out.push(`${i + di}_${j + dj}`);
  return out;
}

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function streetKeyOf(insee: string, street: string) {
  return `${insee}|${normalize(street)}`;
}

type Props = Record<string, unknown>;
const pick = (p: Props, ...keys: string[]) => {
  for (const k of keys) {
    const v = p[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

/** Transforme un objet GeoJSON (format WFS ou géocodeur) en adresse. */
export function parseFeature(f: any, box?: ReturnType<typeof cellBox>): Addr | null {
  const p: Props = f?.properties ?? {};
  const num = Number(pick(p, 'numero', 'housenumber', 'num', 'numero_voie'));
  if (!isFinite(num) || num <= 0 || num >= 9999) return null; // pas de numéro : lieu-dit seul
  const street = String(pick(p, 'nom_voie', 'street', 'nomvoie', 'voie_nom', 'nom_afnor', 'nom_ld', 'lieudit_complement_nom') ?? '').trim();
  if (!street) return null;
  const insee = String(pick(p, 'code_insee', 'citycode', 'insee', 'commune_insee') ?? '');
  const city = String(pick(p, 'nom_commune', 'city', 'commune', 'commune_nom') ?? '');
  const rep = String(pick(p, 'rep', 'suffixe', 'indice_de_repetition') ?? '').trim();

  let lat = Number(pick(p, 'lat', 'latitude'));
  let lon = Number(pick(p, 'lon', 'long', 'longitude'));
  if (!isFinite(lat) || !isFinite(lon)) {
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c)) return null;
    const [a, b] = c as number[];
    // Selon le serveur, l'ordre est [lon, lat] ou [lat, lon] : on vérifie avec le carré demandé.
    const inBox = (la: number, lo: number) =>
      !box || (la >= box.minLat - 0.01 && la <= box.maxLat + 0.01 && lo >= box.minLon - 0.01 && lo <= box.maxLon + 0.01);
    if (inBox(b, a)) [lat, lon] = [b, a];
    else if (inBox(a, b)) [lat, lon] = [a, b];
    else return null;
  }
  const id = String(pick(p, 'id', 'cle_interop', 'id_ban_adresse', 'banId') ?? `${insee}_${normalize(street)}_${num}${rep}`);
  return { id, num, rep, street, streetKey: streetKeyOf(insee, street), insee, city, lat, lon };
}

async function fetchJSON(url: string, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchWFS(id: string): Promise<Addr[]> {
  const b = cellBox(id);
  const out: Addr[] = [];
  const COUNT = 5000;
  for (let start = 0; start < 50000; start += COUNT) {
    const url =
      'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
      '&TYPENAMES=BAN.DATA.GOUV:ban&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326' +
      `&BBOX=${b.minLat},${b.minLon},${b.maxLat},${b.maxLon},urn:ogc:def:crs:EPSG::4326` +
      `&COUNT=${COUNT}&STARTINDEX=${start}`;
    const j = await fetchJSON(url);
    const feats: any[] = j?.features ?? [];
    for (const f of feats) {
      const a = parseFeature(f, b);
      if (a) out.push(a);
    }
    if (feats.length < COUNT) break;
  }
  return out;
}

/** Secours : géocodage inverse sur une grille de points du carré. */
async function fetchReverse(id: string): Promise<Addr[]> {
  const b = cellBox(id);
  const seen = new Map<string, Addr>();
  const N = 4;
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < N; i++)
    for (let k = 0; k < N; k++) {
      const lat = b.minLat + ((i + 0.5) / N) * (b.maxLat - b.minLat);
      const lon = b.minLon + ((k + 0.5) / N) * (b.maxLon - b.minLon);
      const url = `https://data.geopf.fr/geocodage/reverse?lon=${lon}&lat=${lat}&index=address&limit=50`;
      jobs.push(
        fetchJSON(url).then((j) => {
          for (const f of j?.features ?? []) {
            const a = parseFeature(f, b);
            if (a && !seen.has(a.id)) seen.set(a.id, a);
          }
        }),
      );
    }
  const res = await Promise.allSettled(jobs);
  if (res.every((r) => r.status === 'rejected')) throw new Error('hors-ligne');
  return [...seen.values()];
}

const inflight = new Map<string, Promise<Addr[] | null>>();

/**
 * Adresses d'un carré : depuis le téléphone si déjà chargées, sinon depuis
 * internet. Renvoie null si le carré est inconnu et qu'on est hors-ligne.
 */
export function loadCell(id: string): Promise<Addr[] | null> {
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    if (isDemo()) return demoAddressesInBox(cellBox(id));
    const cached = await getCell(id).catch(() => undefined);
    const fresh = cached && Date.now() - cached.t < MAX_AGE;
    if (fresh || (cached && !navigator.onLine)) return cached!.addrs;
    try {
      let addrs: Addr[];
      try {
        addrs = await fetchWFS(id);
      } catch {
        addrs = await fetchReverse(id);
      }
      await saveCell({ id, t: Date.now(), addrs }).catch(() => {});
      return addrs;
    } catch {
      return cached ? cached.addrs : null;
    }
  })();
  inflight.set(id, p);
  p.finally(() => inflight.delete(id));
  return p;
}
