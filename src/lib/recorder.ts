// Enregistrement d'une tournée « à vide ».
//
// Le facteur appuie sur Pair, Impair, Les deux ou Rien : un nouveau tronçon
// commence à cet endroit. La position est lissée ; à la fin d'un tronçon on
// redresse le trajet en lignes droites et on retrouve les adresses longées.
import type { Addr, Fix, LL, Mode, Segment, SegSide } from './types';
import { AddressIndex, StreetTracker, type StreetCandidate } from './addressIndex';
import { PositionFilter } from './smooth';
import { assignAll, assignSegment, straighten } from './assign';
import { RoadIndex } from './roads';
import { matchToRoads } from './match';
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

  constructor(public index: AddressIndex, public mode: Mode, public roads?: RoadIndex) {
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

  /** Le facteur pose sa position à la main (GPS imprécis). */
  setManual(p: LL) {
    this.filter.reset(p);
    this.pos = p;
    this.track.push(p);
    this.active?.raw.push(p);
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
    const r = assignSegment(a.side, a.raw, this.index, this.taken(), this.roads);
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

  /** Tracé du tronçon en cours, collé aux rues si on les connaît (affichage seulement). */
  livePath(): LL[] {
    if (!this.active) return [];
    const m = this.roads ? matchToRoads(this.active.raw, this.roads) : null;
    return m ? m.path : straighten(this.active.raw);
  }

  /** À la fin : recalcul complet, toutes les adresses du quartier étant chargées. */
  finalize(): Segment[] {
    this.finish();
    this.segments = assignAll(this.segments, this.index, this.roads);
    for (const s of this.segments) this.keepStreets(s);
    return this.segments;
  }
}
