// Colle un trajet GPS (déjà lissé) sur l'axe des rues : le résultat suit
// exactement les rues, coins compris, sans le zigzag du GPS.
import type { LL } from './types';
import { RoadIndex, type EdgePoint, type Edge } from './roads';
import { dist, simplify } from './geo';

export interface Matched {
  path: LL[];
  /** arêtes (tronçons de rue) parcourues */
  edges: Set<string>;
}

const connected = (a: Edge, b: Edge) => a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;

export function matchToRoads(raw: LL[], roads: RoadIndex, snap = 30): Matched | null {
  if (roads.size === 0 || raw.length < 2) return null;
  let cur: EdgePoint | null = null;
  let dir = 0;
  let matched = 0;
  const out: LL[] = [];
  const edges = new Set<string>();
  for (const p of raw) {
    const cands = roads.near(p, snap);
    if (!cands.length) continue;
    // On préfère rester sur la même rue, puis passer à une rue qui la touche.
    let best = cands[0];
    let bestScore = Infinity;
    for (const c of cands) {
      let s = c.d;
      if (cur) {
        if (c.edge.id === cur.edge.id) s -= 6;
        else if (connected(cur.edge, c.edge)) s += 2;
        else s += 12;
      }
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    matched++;
    if (!cur) {
      out.push(best.p);
      edges.add(best.edge.id);
      cur = best;
      continue;
    }
    if (best.edge.id === cur.edge.id) {
      const delta = best.along - cur.along;
      if (Math.abs(delta) < 3) continue;
      const nd = Math.sign(delta);
      if (dir && nd !== dir && Math.abs(delta) < 12) continue; // petit recul : bruit GPS
      dir = nd;
      out.push(...roads.slice(cur.edge, cur.along, best.along).slice(1));
      cur = best;
    } else {
      const r = roads.route(cur, best, 500, edges);
      if (r) out.push(...r.slice(1));
      else out.push(best.p);
      dir = 0;
      cur = best;
    }
  }
  if (matched < raw.length * 0.5 || out.length < 2) return null;
  // nettoyage : points en double et sommets alignés
  const clean = out.filter((q, i) => i === 0 || dist(out[i - 1], q) > 0.3);
  return { path: simplify(clean, 0.8), edges };
}
