// Stockage local (IndexedDB). Tout reste sur le téléphone.
import type { Addr, DaySession, Tournee } from './types';

const DB_NAME = 'matournee';
const VERSION = 1;
const STORES = ['tournees', 'sessions', 'cells', 'kv'] as const;
type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const get = <T>(store: Store, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key));
export const put = <T>(store: Store, key: string, val: T) => tx(store, 'readwrite', (s) => s.put(val, key));
export const del = (store: Store, key: string) => tx(store, 'readwrite', (s) => s.delete(key));
export const all = <T>(store: Store) => tx<T[]>(store, 'readonly', (s) => s.getAll());

// --- Raccourcis métier ---
export const listTournees = async () =>
  (await all<Tournee>('tournees')).sort((a, b) => b.updatedAt - a.updatedAt);
export const getTournee = (id: string) => get<Tournee>('tournees', id);
export const saveTournee = (t: Tournee) => put('tournees', t.id, $state_snapshot_safe(t));
export const deleteTournee = (id: string) => del('tournees', id);

export const getSession = (key: string) => get<DaySession>('sessions', key);
export const saveSession = (s: DaySession) => put('sessions', s.key, $state_snapshot_safe(s));

export interface Cell {
  id: string;
  t: number;
  addrs: Addr[];
}
export const getCell = (id: string) => get<Cell>('cells', id);
export const saveCell = (c: Cell) => put('cells', c.id, c);

export const getKV = <T>(k: string) => get<T>('kv', k);
export const setKV = <T>(k: string, v: T) => put('kv', k, $state_snapshot_safe(v));

/** IndexedDB ne sait pas cloner les proxys Svelte : on passe par JSON. */
function $state_snapshot_safe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Demande au navigateur de ne pas effacer nos données. */
export async function persist() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* rien */
  }
}
