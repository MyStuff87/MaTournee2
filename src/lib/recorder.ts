// Logique d'enregistrement d'une tournée « à vide ».
//
// Le facteur choisit un côté (pair / impair / les deux) en entrant dans une
// rue ; on capte alors les adresses de ce côté devant lesquelles il passe.
// À la fin du tronçon, on complète les trous (numéros manqués à cause du
// GPS) entre le plus petit et le plus grand numéro vu, et on range les
// adresses dans l'ordre réel de passage.
import type { Addr, Mode, Segment, Side } from './types';
import { AddressIndex, StreetTracker, matchesSide, isEven, sortByNum, type StreetCandidate } from './addressIndex';
import { dist, distToSeg, projectOnLine, type LL } from './geo';

/** Distance maximale entre le trajet et une adresse pour la considérer « passée ». */
export const CAPTURE_RADIUS: Record<Mode, number> = { pied: 25, velo: 28, voiture: 35 };
const TRACKER_NEED: Record<Mode, number> = { pied: 6, velo: 4, voiture: 3 };

export interface ActiveSegment {
  id: string;
  streetKey: string;
  street: string;
  city: string;
  side: Side;
  track: LL[];
  captured: Map<string, number>; // id -> ordre de capture
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export class Recorder {
  track: LL[] = [];
  segments: Segment[] = [];
  /** toutes les adresses utiles à la tournée */
  addrs: Record<string, Addr> = {};
  active: ActiveSegment | null = null;
  tracker: StreetTracker;
  detected: StreetCandidate | null = null;
  /** rue pour laquelle le facteur a répondu « pas ici » / « je reste » */
  dismissed: string | null = null;
  last: LL | null = null;

  constructor(public index: AddressIndex, public mode: Mode) {
    this.tracker = new StreetTracker(TRACKER_NEED[mode], 30);
  }

  /** La question « quel côté ? » doit-elle être posée ? */
  get prompt(): StreetCandidate | null {
    const d = this.detected;
    if (!d) return null;
    if (this.active && d.streetKey === this.active.streetKey) return null;
    if (d.streetKey === this.dismissed) return null;
    return d;
  }

  onFix(p: LL) {
    if (!this.last || dist(this.last, p) >= 2) {
      this.track.push(p);
      this.last = p;
    }
    const prev = this.detected?.streetKey;
    this.detected = this.tracker.update(this.index.candidates(p));
    if (this.detected?.streetKey !== prev && this.detected?.streetKey !== this.dismissed) {
      // nouvelle rue : on oublie l'ancien « pas ici »
      if (this.dismissed && this.detected?.streetKey !== this.dismissed) this.dismissed = null;
    }
    if (this.active) {
      const prev = this.active.track[this.active.track.length - 1];
      this.active.track.push(p);
      if (prev) this.capture(this.active, prev, p);
    }
  }

  /** Adresses déjà prises par un autre tronçon de la tournée. */
  taken(): Set<string> {
    return new Set(this.segments.flatMap((s) => s.addrIds));
  }

  /**
   * Une adresse est « passée » quand on longe sa position : son projeté sur
   * le dernier pas de trajet tombe dans ce pas (ou on est tout près).
   * Ainsi une maison au bout de la rue n'est pas captée si on fait demi-tour avant.
   */
  private capture(seg: ActiveSegment, a0: LL, b0: LL) {
    const r = CAPTURE_RADIUS[this.mode];
    const taken = this.taken();
    for (const a of this.index.near(b0, r + dist(a0, b0))) {
      if (a.streetKey !== seg.streetKey || !matchesSide(a, seg.side)) continue;
      if (seg.captured.has(a.id) || taken.has(a.id)) continue;
      const { d, t } = distToSeg(a, a0, b0);
      const inside = t > 0 && t < 1;
      if ((inside && d <= r) || dist(a, b0) <= 10) seg.captured.set(a.id, seg.captured.size);
    }
  }

  start(streetKey: string, side: Side) {
    this.finish();
    const s = this.index.street(streetKey);
    if (!s) return;
    this.active = {
      id: uid(),
      streetKey,
      street: s.street,
      city: s.city,
      side,
      track: this.recentOn(streetKey),
      captured: new Map(),
    };
    // On rattrape les quelques mètres faits dans la rue avant d'avoir répondu.
    const tr = this.active.track;
    if (tr.length === 1) this.capture(this.active, tr[0], tr[0]);
    for (let i = 1; i < tr.length; i++) this.capture(this.active, tr[i - 1], tr[i]);
    this.dismissed = null;
    // on force la rue courante sur celle choisie (utile après « Autre rue »)
    this.detected = { streetKey, street: s.street, city: s.city, d: 0 };
  }

  /** Derniers points du trajet (≤ 50 m) déjà dans cette rue. */
  private recentOn(streetKey: string): LL[] {
    const out: LL[] = [];
    let acc = 0;
    for (let i = this.track.length - 1; i >= 0; i--) {
      const p = this.track[i];
      if (this.index.distToStreet(p, streetKey) > 30) break;
      if (out.length) acc += dist(p, out[0]);
      if (acc > 50) break;
      out.unshift(p);
    }
    if (!out.length && this.last) out.push(this.last);
    return out;
  }

  /** Change de côté sans perdre le chemin déjà fait dans la rue. */
  changeSide(side: Side) {
    const seg = this.active;
    if (!seg) return;
    seg.side = side;
    seg.captured = new Map();
    for (let i = 1; i < seg.track.length; i++) this.capture(seg, seg.track[i - 1], seg.track[i]);
  }

  dismiss() {
    if (this.detected) this.dismissed = this.detected.streetKey;
  }

  /** Termine le tronçon en cours et l'ajoute à la tournée. */
  finish(): Segment | null {
    const seg = this.active;
    this.active = null;
    if (!seg) return null;
    const built = buildSegment(seg, this.index, this.taken());
    if (!built) return null;
    for (const a of this.index.street(seg.streetKey)?.addrs ?? []) this.addrs[a.id] = a;
    this.segments.push(built);
    // Si le facteur reste dans la rue, on ne repose pas la question tout de suite.
    if (this.detected?.streetKey === seg.streetKey) this.dismissed = seg.streetKey;
    return built;
  }

  /** Vue d'ensemble du tronçon en cours, pour l'affichage. */
  activeSummary() {
    const seg = this.active;
    if (!seg) return null;
    const list = [...seg.captured.keys()].map((id) => this.index.byId.get(id)!).filter(Boolean);
    const preview = buildSegment(seg, this.index, this.taken());
    const ids = preview?.addrIds ?? [];
    const addrs = ids.map((id) => this.index.byId.get(id)!).filter(Boolean);
    const nums = addrs.map((a) => a.num);
    return {
      count: addrs.length,
      min: nums.length ? Math.min(...nums) : null,
      max: nums.length ? Math.max(...nums) : null,
      addrs,
      lastId: list.length ? list[list.length - 1].id : null,
    };
  }
}

/** Construit le tronçon final : bouche les trous et ordonne par passage. */
export function buildSegment(seg: ActiveSegment, index: AddressIndex, taken: Set<string> = new Set()): Segment | null {
  const street = index.street(seg.streetKey);
  if (!street) return null;
  const captured = [...seg.captured.keys()].map((id) => index.byId.get(id)!).filter(Boolean);
  if (captured.length === 0) return null;

  const chosen = new Map<string, Addr>();
  const parities: boolean[] = seg.side === 'both' ? [true, false] : [seg.side === 'pair'];
  for (const even of parities) {
    const c = captured.filter((a) => isEven(a) === even);
    if (!c.length) continue;
    const lo = Math.min(...c.map((a) => a.num));
    const hi = Math.max(...c.map((a) => a.num));
    for (const a of street.addrs)
      if (isEven(a) === even && a.num >= lo && a.num <= hi && !taken.has(a.id)) chosen.set(a.id, a);
  }
  return {
    id: seg.id,
    streetKey: seg.streetKey,
    street: seg.street,
    city: seg.city,
    side: seg.side,
    addrIds: orderAlong([...chosen.values()], seg.track).map((a) => a.id),
  };
}

/** Range des adresses dans l'ordre où l'on passe devant en suivant le tracé. */
export function orderAlong(addrs: Addr[], track: LL[]): Addr[] {
  if (track.length < 2) return [...addrs].sort(sortByNum);
  const pos = new Map(addrs.map((a) => [a.id, projectOnLine(a, track).along]));
  return [...addrs].sort((a, b) => pos.get(a.id)! - pos.get(b.id)! || sortByNum(a, b));
}
