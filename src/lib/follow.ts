// Le parcours d'une tournée mis bout à bout, et le suivi de la position
// du facteur le long de ce parcours (collage au tracé façon GPS).
import type { Addr, LL, Tournee } from './types';
import { bearing, dist, distToSeg, projectDetailed } from './geo';
import { migrateSegment } from './assign';

export interface Route {
  line: LL[];
  /** abscisse cumulée de chaque sommet */
  cum: number[];
  /** abscisse de début de chaque tronçon */
  segStart: number[];
  /** abscisse de chaque adresse sur le parcours */
  stopAlong: Map<string, number>;
}

export function buildRoute(t: Tournee): Route {
  const line: LL[] = [];
  const segStart: number[] = [];
  const stopAlong = new Map<string, number>();
  let acc = 0;
  for (const s0 of t.segments) {
    const s = migrateSegment(s0, t.addrs);
    const path = s.path && s.path.length >= 2 ? s.path : [];
    if (line.length && path.length) acc += dist(line[line.length - 1], path[0]);
    segStart.push(acc);
    for (const id of s.addrIds) {
      const a = t.addrs[id];
      if (a) stopAlong.set(id, acc + (path.length ? projectDetailed(a, path).along : 0));
    }
    for (let i = 0; i < path.length; i++) {
      if (i > 0) acc += dist(path[i - 1], path[i]);
      line.push(path[i]);
    }
  }
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
  return { line, cum, segStart, stopAlong };
}

export interface FollowResult {
  along: number;
  /** position collée au parcours (null si on en est loin) */
  snapped: LL | null;
  /** direction du parcours à cet endroit */
  heading: number | null;
  offRoute: boolean;
}

export class RouteFollower {
  along: number;
  private started = false;
  private lost = 0;

  /** @param startAlong où reprendre (ex. après une pause) */
  constructor(public route: Route, startAlong = 0, private snapDist = 28) {
    this.along = startAlong;
  }

  /**
   * On cherche, en avançant dans l'ordre du parcours, le premier passage
   * proche de la position : on ne saute jamais à un passage ultérieur
   * (impasse aller / retour, rue faite en deux fois…).
   */
  update(p: LL): FollowResult {
    const { line, cum } = this.route;
    if (line.length < 2) return { along: 0, snapped: null, heading: null, offRoute: true };
    // Au départ on cherche près du point de reprise ; si on reste longtemps
    // sans retrouver le parcours, on accepte de le rejoindre plus loin.
    const lost = this.lost > 40;
    const lo = this.along - (this.started ? 30 : 60);
    const hi = lost ? Infinity : this.along + (this.started ? 400 : 150);
    let best: { d: number; along: number; i: number; t: number } | null = null;
    for (let i = 0; i < line.length - 1; i++) {
      if (cum[i + 1] < lo) continue;
      if (cum[i] > hi) break;
      const { d, t } = distToSeg(p, line[i], line[i + 1]);
      if (d <= this.snapDist) {
        if (!best || d < best.d) best = { d, along: cum[i] + t * (cum[i + 1] - cum[i]), i, t };
      } else if (best) break; // fin du premier passage proche
    }
    if (!best) {
      this.lost++;
      return { along: this.along, snapped: null, heading: null, offRoute: true };
    }
    this.lost = 0;
    this.started = true;
    this.along = Math.max(best.along, this.along - 30);
    const a = line[best.i];
    const b = line[best.i + 1];
    return {
      along: best.along,
      snapped: { lat: a.lat + (b.lat - a.lat) * best.t, lon: a.lon + (b.lon - a.lon) * best.t },
      heading: bearing(a, b),
      offRoute: false,
    };
  }
}

/** Arrêts déjà dépassés sur le parcours. */
export function passedStops(stops: Addr[], route: Route, along: number): string[] {
  return stops.filter((a) => (route.stopAlong.get(a.id) ?? Infinity) <= along + 2).map((a) => a.id);
}
