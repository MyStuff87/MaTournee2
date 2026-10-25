<script lang="ts">
  // Petit bouton jour / nuit / auto, pour la tournée.
  import { getTheme, setTheme, type ThemeChoice } from '../lib/theme';
  import { toast } from '../lib/app.svelte';

  let choice = $state<ThemeChoice>(getTheme());
  const NEXT: Record<ThemeChoice, ThemeChoice> = { auto: 'dark', dark: 'light', light: 'auto' };
  const SAY: Record<ThemeChoice, string> = {
    auto: 'Affichage automatique : sombre la nuit, clair le jour',
    dark: 'Affichage nuit',
    light: 'Affichage jour',
  };

  function cycle() {
    choice = NEXT[choice];
    setTheme(choice);
    toast(SAY[choice], undefined, 2500);
  }
</script>

<button class="icon-btn theme" onclick={cycle} aria-label="{SAY[choice]}. Toucher pour changer.">
  {#if choice === 'auto'}
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </svg>
    <span class="a">A</span>
  {:else if choice === 'dark'}
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
    </svg>
  {:else}
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </svg>
  {/if}
</button>

<style>
  .theme {
    position: relative;
    color: var(--ink);
    box-shadow: 0 2px 10px rgba(21, 35, 63, 0.18);
  }
  .a {
    position: absolute;
    right: 3px;
    bottom: 3px;
    font: 700 11px/1 var(--cond);
    background: var(--solid);
    color: #fff;
    border-radius: 4px;
    padding: 1px 3px;
  }
</style>
