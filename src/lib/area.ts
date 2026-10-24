// Charge automatiquement les adresses autour de la position.
import { AddressIndex } from './addressIndex';
import { cellsAround, loadCell } from './ban';

export type AreaStatus = 'idle' | 'loading' | 'ready' | 'offline';

export class AreaLoader {
  index = new AddressIndex();
  private done = new Set<string>();
  private failed = new Map<string, number>();
  private pending = 0;
  status: AreaStatus = 'idle';

  constructor(private onChange: () => void) {}

  ensure(lat: number, lon: number) {
    const ids = cellsAround(lat, lon);
    for (const id of ids) {
      if (this.done.has(id)) continue;
      const lastFail = this.failed.get(id);
      if (lastFail && Date.now() - lastFail < 30000) continue;
      this.done.add(id);
      this.pending++;
      this.setStatus('loading');
      loadCell(id)
        .then((addrs) => {
          if (addrs) {
            this.index.add(addrs);
            this.failed.delete(id);
          }
          else {
            this.done.delete(id);
            this.failed.set(id, Date.now());
          }
        })
        .catch(() => {
          this.done.delete(id);
          this.failed.set(id, Date.now());
        })
        .finally(() => {
          this.pending--;
          if (this.pending === 0) this.setStatus(this.failed.size && this.index.size === 0 ? 'offline' : 'ready');
          this.onChange();
        });
    }
  }

  private setStatus(s: AreaStatus) {
    if (this.status !== s) {
      this.status = s;
      this.onChange();
    }
  }
}
