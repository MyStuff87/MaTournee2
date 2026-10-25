// Affichage : automatique (suit l'iPhone), clair, sombre (nuit) ou soleil.
export type ThemeChoice = 'auto' | 'light' | 'dark' | 'sun';
const KEY = 'matournee-theme';
const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function getTheme(): ThemeChoice {
  try {
    return (localStorage.getItem(KEY) as ThemeChoice) || 'auto';
  } catch {
    return 'auto';
  }
}

function apply(choice: ThemeChoice) {
  const real = choice === 'auto' ? (mq?.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = real;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color || '#E8ECEF');
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* rien */
  }
  apply(choice);
}

export function initTheme() {
  apply(getTheme());
  mq?.addEventListener('change', () => getTheme() === 'auto' && apply('auto'));
}
