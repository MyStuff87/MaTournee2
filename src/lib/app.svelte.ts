// Navigation entre écrans et petits états partagés.
import { getKV, setKV } from './db';

export type Screen =
  | { name: 'home' }
  | { name: 'record'; tourneeId?: string }
  | { name: 'review'; tourneeId: string }
  | { name: 'prepare'; tourneeId: string }
  | { name: 'guide'; tourneeId: string }
  | { name: 'libre' };

export const app = $state({
  screen: { name: 'home' } as Screen,
  currentTourneeId: null as string | null,
  toast: null as null | { text: string; action?: { label: string; run: () => void } },
});

export function go(s: Screen) {
  app.screen = s;
  try {
    history.pushState({ s }, '');
  } catch {
    /* rien */
  }
  window.scrollTo(0, 0);
}

export function back() {
  history.back();
}

addEventListener('popstate', (e) => {
  app.screen = (e.state?.s as Screen) ?? { name: 'home' };
});

export async function initApp() {
  history.replaceState({ s: { name: 'home' } }, '');
  app.currentTourneeId = (await getKV<string>('current')) ?? null;
}

export function setCurrent(id: string | null) {
  app.currentTourneeId = id;
  setKV('current', id);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, action?: { label: string; run: () => void }, ms = 4500) {
  app.toast = { text, action };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (app.toast = null), ms);
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
