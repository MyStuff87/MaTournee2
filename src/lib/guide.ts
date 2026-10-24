// Guidage pendant la tournée : prochain arrêt, avance automatique.
import type { Addr, Mode, Tournee } from './types';
import { dist, type LL } from './geo';

const ARRIVE: Record<Mode, number> = { pied: 15, velo: 20, voiture: 28 };

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
  /** distance minimale atteinte pour l'arrêt courant */
  private minD = Infinity;
  private arrived = false;
  private currentId: string | null = null;

  constructor(private mode: Mode) {}

  /**
   * Renvoie l'id de l'arrêt à marquer comme livré automatiquement,
   * quand on est passé devant puis qu'on s'en éloigne.
   */
  onFix(p: LL, current: Addr | null, next: Addr | null): string | null {
    if (!current) return null;
    if (current.id !== this.currentId) {
      this.currentId = current.id;
      this.minD = Infinity;
      this.arrived = false;
    }
    const r = ARRIVE[this.mode];
    const d = dist(p, current);
    this.minD = Math.min(this.minD, d);
    if (d <= r) this.arrived = true;
    // Passé devant et reparti.
    if (this.arrived && d > r * 1.6 && d > this.minD + 8) return current.id;
    // Déjà devant le suivant (cas des boîtes très proches).
    if (this.arrived && next && dist(p, next) < Math.min(d, r * 0.6)) return current.id;
    return null;
  }

  reset() {
    this.currentId = null;
  }
}
