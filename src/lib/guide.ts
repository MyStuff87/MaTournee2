// Arrêts du jour, dans l'ordre de la tournée.
import type { Addr, Tournee } from './types';

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
