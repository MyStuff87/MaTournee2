// Sauvegarde / transfert des tournées sous forme de fichier.
import type { Tournee } from './types';
import { listTournees, saveTournee } from './db';
import { uid } from './recorder';

export async function exportTournees(only?: Tournee) {
  const list = only ? [only] : await listTournees();
  const data = JSON.stringify({ app: 'MaTournee', v: 1, tournees: list });
  const name = only ? `${only.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.matournee.json` : `matournee-sauvegarde.json`;
  const file = new File([data], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Importe un fichier ; renvoie le nombre de tournées ajoutées. */
export async function importFile(f: File): Promise<number> {
  const j = JSON.parse(await f.text());
  const list: Tournee[] = j?.tournees ?? (j?.segments ? [j] : []);
  const existing = new Set((await listTournees()).map((t) => t.id));
  let n = 0;
  for (const t of list) {
    if (!t?.segments || !t?.addrs) continue;
    const copy: Tournee = { ...t, id: existing.has(t.id) ? uid() : t.id, updatedAt: Date.now() };
    if (existing.has(t.id)) copy.name = `${t.name} (importée)`;
    await saveTournee(copy);
    n++;
  }
  return n;
}
