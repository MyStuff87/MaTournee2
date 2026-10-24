// Suit la position du facteur le long du tracé enregistré de sa tournée,
// pour séparer le chemin déjà fait du chemin à faire.
import { dist, type LL } from './geo';

export class TrackFollower {
  idx = 0;
  private started = false;

  constructor(public track: LL[]) {}

  update(p: LL): number {
    const t = this.track;
    if (t.length === 0) return 0;
    // Au début : recherche partout. Ensuite : seulement un peu en arrière et
    // devant, pour ne pas sauter quand le tracé repasse au même endroit.
    const from = this.started ? Math.max(0, this.idx - 40) : 0;
    const to = this.started ? Math.min(t.length - 1, this.idx + 400) : t.length - 1;
    let best = this.idx;
    let bd = Infinity;
    for (let i = from; i <= to; i++) {
      const d = dist(p, t[i]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (bd < 45) {
      this.idx = best;
      this.started = true;
    }
    return this.idx;
  }

  /** Index du point situé à `meters` devant la position. */
  ahead(meters: number): number {
    const t = this.track;
    let acc = 0;
    let i = this.idx;
    while (i < t.length - 1 && acc < meters) {
      acc += dist(t[i], t[i + 1]);
      i++;
    }
    return i;
  }
}
