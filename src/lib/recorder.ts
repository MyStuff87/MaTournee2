// Enregistrement d'une tournée « à vide ».
//
// Le facteur appuie sur Pair, Impair, Les deux ou Rien : un nouveau tronçon
// commence à cet endroit. La position est lissée ; à la fin d'un tronçon on
// redresse le trajet en lignes droites et on retrouve les adresses longées.
import type { Addr, Fix, LL, Mode, Segment, SegSide } from './types';
import { AddressIndex, StreetTracker, type StreetCandidate } from './addressIndex';
import { PositionFilter } from './smooth';
import { assignAll, assignSegment, straighten, type Assigned } from './assign';
import { dist } from './geo';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export interface ActiveSegment {
  id: string;
  side: SegSide;
  raw: LL[];
}

export class Recorder {
  segments: Segment[] = [];
  addrs: Record<string, Addr> = {};
  active: ActiveSegment | null = null;
  track: LL[] = [];
  pos: LL | null = null;
  heading: number | null = null;
  street: StreetCandidate | null = null;
  private filter: PositionFilter;
  private tracker = new StreetTracker(3, 35);

  constructor(public index: AddressIndex, public mode: Mode) {
    this.filter = new PositionFilter(mode);
  }

  onFix(f: Fix) {
    const p = this.filter.update(f);
    this.pos = p;
    this.heading = this.filter.heading ?? this.heading;
    const last = this.track[this.track.length - 1];
    if (!last || dist(last, p) >= 1.5) {
      this.track.push(p);
      this.active?.raw.push(p);
    }
    this.street = this.tracker.update(this.index.candidates(p));
  }

  taken(): Set<string> {
    return new Set(this.segments.flatMap((s) => s.addrIds));
  }

  /** Nouveau tronçon à partir d'ici. */
  start(side: SegSide) {
    this.finish();
    this.active = { id: uid(), side, raw: this.pos ? [this.pos] : [] };
  }

  /** Termine le tronçon en cours et l'ajoute à la tournée. */
  finish(): Segment | null {
    const a = this.active;
    this.active = null;
    if (!a || a.raw.length < 2) return null;
    const r = assignSegment(a.side, a.raw, this.index, this.taken());
    const seg: Segment = { id: a.id, side: a.side, raw: a.raw, ...r };
    this.segments.push(seg);
    this.keepStreets(seg);
    return seg;
  }

  /** Garde toutes les adresses des rues concernées (pour corriger plus tard, hors-ligne). */
  private keepStreets(seg: Segment) {
    const keys = new Set(seg.addrIds.map((id) => this.index.byId.get(id)?.streetKey).filter(Boolean) as string[]);
    for (const k of keys) for (const a of this.index.street(k)?.addrs ?? []) this.addrs[a.id] = a;
  }

  /** Aperçu du tronçon en cours (lignes droites + adresses trouvées jusqu'ici). */
  preview(): (Assigned & { side: SegSide }) | null {
    const a = this.active;
    if (!a || a.raw.length < 2) return a ? { side: a.side, path: a.raw.slice(), addrIds: [], streetKey: '', street: '', city: '', streets: [] } : null;
    return { side: a.side, ...assignSegment(a.side, a.raw, this.index, this.taken()) };
  }

  livePath(): LL[] {
    return this.active ? straighten(this.active.raw) : [];
  }

  /** À la fin : recalcul complet, toutes les adresses du quartier étant chargées. */
  finalize(): Segment[] {
    this.finish();
    this.segments = assignAll(this.segments, this.index);
    for (const s of this.segments) this.keepStreets(s);
    return this.segments;
  }
}
