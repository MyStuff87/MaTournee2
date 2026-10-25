// Charge automatiquement les adresses et les rues autour d'un point.
import { AddressIndex } from './addressIndex';
import { cellsAround, loadCell } from './ban';
import { loadRoadCell, RoadIndex } from './roads';

export type AreaStatus = 'idle' | 'loading' | 'ready' | 'offline';

export class AreaLoader {
  index = new AddressIndex();
  roads = new RoadIndex();
  private done = new Set<string>();
  private failed = new Map<string, number>();
  private pending = 0;
  private waiters: (() => void)[] = [];
  status: AreaStatus = 'idle';

  constructor(private onChange: () => void) {}

  ensure(lat: number, lon: number) {
    for (const id of cellsAround(lat, lon)) {
      this.load(`a:${id}`, () => loadCell(id), (r) => this.index.add(r));
      this.load(`r:${id}`, () => loadRoadCell(id), (r) => this.roads.add(r));
    }
  }

  private load<T>(key: string, fetcher: () => Promise<T[] | null>, use: (r: T[]) => void) {
    if (this.done.has(key)) return;
    const lastFail = this.failed.get(key);
    if (lastFail && Date.now() - lastFail < 30000) return;
    this.done.add(key);
    this.pending++;
    this.setStatus('loading');
    fetcher()
      .then((r) => {
        if (r) {
          use(r);
          this.failed.delete(key);
        } else throw new Error('hors-ligne');
      })
      .catch(() => {
        this.done.delete(key);
        this.failed.set(key, Date.now());
      })
      .finally(() => {
        this.pending--;
        if (this.pending === 0) {
          this.setStatus(this.failed.size && this.index.size === 0 ? 'offline' : 'ready');
          this.waiters.splice(0).forEach((w) => w());
        }
        this.onChange();
      });
  }

  /** Attend la fin des chargements en cours (au plus `ms`). */
  idle(ms = 15000): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((res) => {
      this.waiters.push(res);
      setTimeout(res, ms);
    });
  }

  private setStatus(s: AreaStatus) {
    if (this.status !== s) {
      this.status = s;
      this.onChange();
    }
  }
}
