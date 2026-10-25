// Affichage jour / nuit. Par défaut automatique, comme un GPS de voiture :
// sombre entre le coucher et le lever du soleil, calculés là où tu es.
import { isNight } from './sun';

export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'matournee-theme';
const POS_KEY = 'matournee-lastpos';
const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function lastPos(): { lat: number; lon: number } | null {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Le thème réellement affiché en mode auto. */
function autoTheme(): 'light' | 'dark' {
  const p = lastPos();
  if (p) return isNight(p.lat, p.lon) ? 'dark' : 'light';
  return mq?.matches ? 'dark' : 'light';
}

function apply() {
  const choice = getTheme();
  const real = choice === 'auto' ? autoTheme() : choice;
  if (document.documentElement.dataset.theme !== real) document.documentElement.dataset.theme = real;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#E8ECEF');
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* rien */
  }
  apply();
}

let lastSaved = 0;
/** Appelé à chaque position GPS : sert au calcul du lever / coucher du soleil. */
export function notePosition(lat: number, lon: number) {
  if (Date.now() - lastSaved < 5 * 60000) return;
  lastSaved = Date.now();
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ lat: +lat.toFixed(2), lon: +lon.toFixed(2) }));
  } catch {
    /* rien */
  }
  apply();
}

export function initTheme() {
  apply();
  mq?.addEventListener('change', apply);
  setInterval(apply, 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && apply());
}
