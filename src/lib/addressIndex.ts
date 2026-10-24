// Index en mémoire des adresses connues : recherche des plus proches et
// détection de la rue où l'on se trouve.
import type { Addr, Side } from './types';
import { dist, projectOnLine, type LL } from './geo';

const B = 0.0005; // seau ≈ 50 m

export interface StreetInfo {
  streetKey: string;
  street: string;
  city: string;
  addrs: Addr[];
  minNum: number;
  maxNum: number;
}

export interface StreetCandidate {
  streetKey: string;
  street: string;
  city: string;
  d: number;
}

export const isEven = (a: Addr) => a.num % 2 === 0;
export const matchesSide = (a: Addr, side: Side) =>
  side === 'both' || (side === 'pair' ? isEven(a) : !isEven(a));

export const label = (a: Addr) => (a.rep ? `${a.num} ${a.rep}` : `${a.num}`);

export function sortByNum(a: Addr, b: Addr) {
  return a.num - b.num || a.rep.localeCompare(b.rep);
}

export class AddressIndex {
  byId = new Map<string, Addr>();
  buckets = new Map<string, Addr[]>();
  streets = new Map<string, StreetInfo>();
  private lines = new Map<string, LL[][]>();

  get size() {
    return this.byId.size;
  }

  add(addrs: Iterable<Addr>) {
    const touched = new Set<string>();
    for (const a of addrs) {
      if (this.byId.has(a.id)) continue;
      this.byId.set(a.id, a);
      const k = `${Math.floor(a.lat / B)}_${Math.floor(a.lon / B)}`;
      (this.buckets.get(k) ?? this.buckets.set(k, []).get(k)!).push(a);
      let s = this.streets.get(a.streetKey);
      if (!s) {
        s = { streetKey: a.streetKey, street: a.street, city: a.city, addrs: [], minNum: a.num, maxNum: a.num };
        this.streets.set(a.streetKey, s);
      }
      s.addrs.push(a);
      s.minNum = Math.min(s.minNum, a.num);
      s.maxNum = Math.max(s.maxNum, a.num);
      touched.add(a.streetKey);
    }
    for (const k of touched) {
      this.streets.get(k)!.addrs.sort(sortByNum);
      this.lines.delete(k);
    }
  }

  near(p: LL, radius: number): Addr[] {
    const r = Math.ceil(radius / 50) + 0;
    const bi = Math.floor(p.lat / B);
    const bj = Math.floor(p.lon / B);
    const out: Addr[] = [];
    for (let i = bi - r; i <= bi + r; i++)
      for (let j = bj - r - 1; j <= bj + r + 1; j++) {
        const arr = this.buckets.get(`${i}_${j}`);
        if (!arr) continue;
        for (const a of arr) if (dist(p, a) <= radius) out.push(a);
      }
    return out;
  }

  nearest(p: LL, radius = 60, filter?: (a: Addr) => boolean): Addr | null {
    let best: Addr | null = null;
    let bd = Infinity;
    for (const a of this.near(p, radius)) {
      if (filter && !filter(a)) continue;
      const d = dist(p, a);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /** La rue vue comme deux lignes : les pairs dans l'ordre, les impairs dans l'ordre. */
  private streetLines(key: string): LL[][] {
    let l = this.lines.get(key);
    if (!l) {
      const s = this.streets.get(key);
      const addrs = s?.addrs ?? [];
      l = [addrs.filter(isEven), addrs.filter((a) => !isEven(a))].filter((x) => x.length > 0);
      this.lines.set(key, l);
    }
    return l;
  }

  distToStreet(p: LL, key: string): number {
    let d = Infinity;
    for (const line of this.streetLines(key)) d = Math.min(d, projectOnLine(p, line).d);
    return d;
  }

  /** Rues proches, de la plus proche à la plus éloignée. */
  candidates(p: LL, radius = 80): StreetCandidate[] {
    const keys = new Set(this.near(p, radius).map((a) => a.streetKey));
    const out: StreetCandidate[] = [];
    for (const k of keys) {
      const s = this.streets.get(k)!;
      out.push({ streetKey: k, street: s.street, city: s.city, d: this.distToStreet(p, k) });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  street(key: string) {
    return this.streets.get(key);
  }
}

/**
 * Décide de la rue courante avec un peu d'inertie : il faut que la même rue
 * arrive en tête plusieurs fois de suite pour qu'on change d'avis
 * (sinon les carrefours font clignoter le résultat).
 */
export class StreetTracker {
  current: StreetCandidate | null = null;
  private pending: string | null = null;
  private count = 0;

  constructor(private need = 3, private maxDist = 30) {}

  update(cands: StreetCandidate[]): StreetCandidate | null {
    const top = cands[0];
    if (!top || top.d > this.maxDist) {
      this.pending = null;
      this.count = 0;
      // On garde la rue tant qu'on n'en est pas trop loin.
      if (this.current) {
        const still = cands.find((c) => c.streetKey === this.current!.streetKey);
        if (!still || still.d > this.maxDist * 2) this.current = null;
        else this.current = still;
      }
      return this.current;
    }
    if (this.current && top.streetKey === this.current.streetKey) {
      this.current = top;
      this.pending = null;
      this.count = 0;
      return this.current;
    }
    // Rue actuelle encore presque aussi proche : on ne bouge pas.
    const cur = this.current && cands.find((c) => c.streetKey === this.current!.streetKey);
    if (cur && cur.d < top.d + 6) {
      this.current = cur;
      return this.current;
    }
    if (this.pending === top.streetKey) this.count++;
    else {
      this.pending = top.streetKey;
      this.count = 1;
    }
    if (!this.current || this.count >= this.need) {
      this.current = top;
      this.pending = null;
      this.count = 0;
    }
    return this.current;
  }

  reset() {
    this.current = null;
    this.pending = null;
    this.count = 0;
  }
}
