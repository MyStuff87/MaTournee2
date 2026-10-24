// Guidage pendant la tournée : tout est automatique.
// Un arrêt est « fait » quand on est passé devant puis qu'on s'en éloigne ;
// les arrêts précédents encore en attente sont alors considérés faits aussi.
import type { Addr, Mode, Tournee } from './types';
import { dist, type LL } from './geo';

const ARRIVE: Record<Mode, number> = { pied: 16, velo: 20, voiture: 28 };
const LOOKAHEAD = 6;

/** Liste ordonnée des arrêts du jour (toutes les adresses si rien n'est coché). */
export function stopsFor(t: Tournee, checked: Set<string>): Addr[] {
  const ids = t.segments.flatMap((s) => s.addrIds);
  const seen = new Set<string>();
  const out: Addr[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (checked.size && !checked.has(id)) continue;
    const a = t.addrs[id];
    if (a) out.push(a);
  }
  return out;
}

export class Guide {
  private reached = new Map<string, number>(); // id -> distance mini atteinte

  constructor(private mode: Mode) {}

  /**
   * @param pending arrêts restants, dans l'ordre
   * @returns ids à marquer comme faits
   */
  onFix(p: LL, pending: Addr[]): string[] {
    const r = ARRIVE[this.mode];
    const window = pending.slice(0, LOOKAHEAD);
    let doneUpTo = -1;
    window.forEach((a, i) => {
      const d = dist(p, a);
      const prev = this.reached.get(a.id);
      if (d <= r) this.reached.set(a.id, Math.min(prev ?? Infinity, d));
      else if (prev !== undefined && d > r * 1.6 && d > prev + 8) doneUpTo = i;
    });
    if (doneUpTo < 0) return [];
    const ids = window.slice(0, doneUpTo + 1).map((a) => a.id);
    for (const id of ids) this.reached.delete(id);
    return ids;
  }

  forget(id: string) {
    this.reached.delete(id);
  }
}
