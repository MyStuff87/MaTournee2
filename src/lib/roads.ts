// Réseau des rues (IGN BD TOPO, couche « tronçon de route »).
// Sert à coller les tracés sur l'axe des rues, à rattacher chaque adresse à
// sa rue, et à calculer un itinéraire entre deux points (tracé à la main).
import type { LL } from './types';
import { cellBox, normalize } from './ban';
import { dist, distToSeg } from './geo';
import { get, put } from './db';
import { demoRoadsInBox, isDemo } from './demo';

export interface Edge {
  id: string;
  coords: LL[];
  cum: number[];
  len: number;
  /** noms normalisés (gauche / droite) */
  names: string[];
  label: string;
  a: string; // nœud de départ
  b: string; // nœud d'arrivée
}

export interface EdgePoint {
  edge: Edge;
  along: number;
  d: number;
  p: LL;
}

const nodeKey = (p: LL) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
const B = 0.0005;

export function makeEdge(id: string, coords: LL[], names: string[]): Edge {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const uniq = [...new Set(names.filter(Boolean))];
  return {
    id,
    coords,
    cum,
    len: cum[cum.length - 1],
    names: uniq.map(normalize),
    label: uniq[0] ?? '',
    a: nodeKey(coords[0]),
    b: nodeKey(coords[coords.length - 1]),
  };
}

export class RoadIndex {
  edges = new Map<string, Edge>();
  nodes = new Map<string, string[]>();
  private buckets = new Map<string, Set<string>>();

  get size() {
    return this.edges.size;
  }

  add(list: Iterable<Edge>) {
    for (const e of list) {
      if (this.edges.has(e.id) || e.coords.length < 2) continue;
      this.edges.set(e.id, e);
      for (const k of [e.a, e.b]) (this.nodes.get(k) ?? this.nodes.set(k, []).get(k)!).push(e.id);
      // on range l'arête dans les seaux qu'elle traverse (un point tous les 20 m)
      for (let i = 0; i < e.coords.length - 1; i++) {
        const p = e.coords[i];
        const q = e.coords[i + 1];
        const n = Math.max(1, Math.ceil(dist(p, q) / 20));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const key = `${Math.floor((p.lat + (q.lat - p.lat) * t) / B)}_${Math.floor((p.lon + (q.lon - p.lon) * t) / B)}`;
          (this.buckets.get(key) ?? this.buckets.set(key, new Set()).get(key)!).add(e.id);
        }
      }
    }
  }

  /** Projection d'un point sur une arête. */
  project(p: LL, e: Edge): EdgePoint {
    let best = { d: Infinity, along: 0, p: e.coords[0] };
    for (let i = 0; i < e.coords.length - 1; i++) {
      const a = e.coords[i];
      const b = e.coords[i + 1];
      const { d, t } = distToSeg(p, a, b);
      if (d < best.d) best = { d, along: e.cum[i] + t * (e.cum[i + 1] - e.cum[i]), p: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t } };
    }
    return { edge: e, ...best };
  }

  near(p: LL, r: number): EdgePoint[] {
    const n = Math.ceil(r / 50) + 1;
    const bi = Math.floor(p.lat / B);
    const bj = Math.floor(p.lon / B);
    const seen = new Set<string>();
    const out: EdgePoint[] = [];
    for (let i = bi - n; i <= bi + n; i++)
      for (let j = bj - n - 1; j <= bj + n + 1; j++)
        for (const id of this.buckets.get(`${i}_${j}`) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const ep = this.project(p, this.edges.get(id)!);
          if (ep.d <= r) out.push(ep);
        }
    return out.sort((a, b) => a.d - b.d);
  }

  nearest(p: LL, r = 40): EdgePoint | null {
    return this.near(p, r)[0] ?? null;
  }

  /** Rue d'une adresse : l'arête la plus proche qui porte son nom, sinon la plus proche. */
  homeEdge(p: LL, streetName: string): EdgePoint | null {
    const n = normalize(streetName);
    const cands = this.near(p, 90);
    return cands.find((c) => c.edge.names.includes(n)) ?? cands.find((c) => c.d <= 40) ?? null;
  }

  /** Morceau d'arête entre deux abscisses (dans un sens ou dans l'autre). */
  slice(e: Edge, from: number, to: number): LL[] {
    const at = (s: number) => {
      for (let i = 0; i < e.coords.length - 1; i++)
        if (e.cum[i + 1] >= s || i === e.coords.length - 2) {
          const seg = e.cum[i + 1] - e.cum[i];
          const t = seg ? Math.max(0, Math.min(1, (s - e.cum[i]) / seg)) : 0;
          const a = e.coords[i];
          const b = e.coords[i + 1];
          return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
        }
      return e.coords[0];
    };
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const pts = [at(lo), ...e.coords.filter((_, i) => e.cum[i] > lo && e.cum[i] < hi), at(hi)];
    return from <= to ? pts : pts.reverse();
  }

  /** Itinéraire le long des rues entre deux points d'arêtes (plus court chemin). */
  route(from: EdgePoint, to: EdgePoint, maxLen = 3000, collect?: Set<string>): LL[] | null {
    collect?.add(from.edge.id);
    collect?.add(to.edge.id);
    if (from.edge.id === to.edge.id) return this.slice(from.edge, from.along, to.along);
    // Dijkstra sur les nœuds, en partant des deux bouts de l'arête de départ.
    const distTo = new Map<string, number>();
    const prev = new Map<string, { node: string; edge: Edge } | null>();
    const queue: [number, string][] = [];
    const push = (k: string, d: number, p: { node: string; edge: Edge } | null) => {
      if (d >= (distTo.get(k) ?? Infinity) || d > maxLen) return;
      distTo.set(k, d);
      prev.set(k, p);
      queue.push([d, k]);
    };
    push(from.edge.a, from.along, null);
    push(from.edge.b, from.edge.len - from.along, null);
    const goal = new Map([
      [to.edge.a, to.along],
      [to.edge.b, to.edge.len - to.along],
    ]);
    let bestEnd: string | null = null;
    let bestCost = Infinity;
    while (queue.length) {
      queue.sort((x, y) => x[0] - y[0]);
      const [d, k] = queue.shift()!;
      if (d > (distTo.get(k) ?? Infinity)) continue;
      if (d >= bestCost) break;
      if (goal.has(k) && d + goal.get(k)! < bestCost) {
        bestCost = d + goal.get(k)!;
        bestEnd = k;
      }
      for (const id of this.nodes.get(k) ?? []) {
        const e = this.edges.get(id)!;
        const other = e.a === k ? e.b : e.a;
        push(other, d + e.len, { node: k, edge: e });
      }
    }
    if (!bestEnd) return null;
    // Reconstruction : début partiel, arêtes complètes, fin partielle.
    const chain: { node: string; edge: Edge }[] = [];
    let k: string = bestEnd;
    while (prev.get(k)) {
      const p = prev.get(k)!;
      chain.unshift({ node: k, edge: p.edge });
      k = p.node;
    }
    const startNode = k;
    const out: LL[] = this.slice(from.edge, from.along, startNode === from.edge.a ? 0 : from.edge.len);
    for (const c of chain) {
      collect?.add(c.edge.id);
      const forward = c.edge.b === c.node;
      out.push(...this.slice(c.edge, forward ? 0 : c.edge.len, forward ? c.edge.len : 0).slice(1));
    }
    out.push(...this.slice(to.edge, bestEnd === to.edge.a ? 0 : to.edge.len, to.along).slice(1));
    return out;
  }
}

// --- Chargement (WFS Géoplateforme), par carrés comme les adresses ---

type Props = Record<string, unknown>;
const pick = (p: Props, ...keys: string[]) => keys.map((k) => p[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;

function parseRoads(j: any, box: ReturnType<typeof cellBox>): Edge[] {
  const out: Edge[] = [];
  const inBox = (la: number, lo: number) => la >= box.minLat - 0.05 && la <= box.maxLat + 0.05 && lo >= box.minLon - 0.05 && lo <= box.maxLon + 0.05;
  for (const f of j?.features ?? []) {
    const p: Props = f.properties ?? {};
    const nature = String(p.nature ?? '');
    if (/bac|liaison maritime/i.test(nature)) continue;
    const g = f.geometry;
    const parts: number[][][] = g?.type === 'MultiLineString' ? g.coordinates : g?.type === 'LineString' ? [g.coordinates] : [];
    if (!parts.length || !parts[0].length) continue;
    const [x, y] = parts[0][0];
    const swap = !inBox(y, x) && inBox(x, y); // [lat, lon] au lieu de [lon, lat]
    const names = [
      pick(p, 'nom_voie_ban_gauche', 'nom_collaboratif_gauche', 'nom_1_gauche'),
      pick(p, 'nom_voie_ban_droite', 'nom_collaboratif_droite', 'nom_1_droite'),
    ].filter(Boolean) as string[];
    const id = String(p.cleabs ?? f.id ?? Math.random());
    parts.forEach((part, k) => {
      const coords = part.map((c) => (swap ? { lat: c[0], lon: c[1] } : { lat: c[1], lon: c[0] }));
      if (coords.length >= 2) out.push(makeEdge(parts.length > 1 ? `${id}#${k}` : id, coords, names));
    });
  }
  return out;
}

async function fetchRoads(id: string): Promise<Edge[]> {
  const b = cellBox(id);
  const out: Edge[] = [];
  const COUNT = 2000;
  for (let start = 0; start < 20000; start += COUNT) {
    const url =
      'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
      '&TYPENAMES=BDTOPO_V3:troncon_de_route&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326' +
      `&BBOX=${b.minLat},${b.minLon},${b.maxLat},${b.maxLon},urn:ogc:def:crs:EPSG::4326` +
      `&COUNT=${COUNT}&STARTINDEX=${start}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      out.push(...parseRoads(j, b));
      if ((j?.features?.length ?? 0) < COUNT) break;
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

interface RoadCell {
  t: number;
  edges: { id: string; coords: LL[]; names: string[] }[];
}

const inflight = new Map<string, Promise<Edge[] | null>>();

/** Rues d'un carré : depuis le téléphone si déjà chargées, sinon depuis internet. */
export function loadRoadCell(id: string): Promise<Edge[] | null> {
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    if (isDemo()) return demoRoadsInBox(cellBox(id)).map((e) => makeEdge(e.id, e.coords, e.names));
    const key = `r:${id}`;
    const cached = await get<RoadCell>('cells', key).catch(() => undefined);
    const revive = (c: RoadCell) => c.edges.map((e) => makeEdge(e.id, e.coords, e.names));
    if (cached && (Date.now() - cached.t < 60 * 86400 * 1000 || !navigator.onLine)) return revive(cached);
    try {
      const edges = await fetchRoads(id);
      await put('cells', key, { t: Date.now(), edges: edges.map((e) => ({ id: e.id, coords: e.coords, names: [e.label, ...e.names] })) }).catch(() => {});
      return edges;
    } catch {
      return cached ? revive(cached) : null;
    }
  })();
  inflight.set(id, p);
  p.finally(() => inflight.delete(id));
  return p;
}
