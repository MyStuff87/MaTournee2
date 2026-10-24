<script lang="ts">
  import type { GpsError } from '../lib/gps';
  let { error }: { error: GpsError } = $props();
</script>

<div class="help">
  {#if error === 'denied'}
    <h2>La localisation est bloquée</h2>
    <p>Sur iPhone : Réglages, puis Confidentialité et sécurité, puis Service de localisation. Ouvre « Sites web Safari » et choisis « Lorsque l'app est active », avec « Position exacte » activée.</p>
    <p>Reviens ensuite ici et relance l'écran.</p>
  {:else}
    <h2>Pas de signal GPS</h2>
    <p>Vérifie que le Service de localisation est activé, puis sors à découvert quelques secondes.</p>
  {/if}
</div>

<style>
  .help {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h2 {
    font: 700 26px/1.1 var(--cond);
  }
  p {
    font-size: 16px;
    line-height: 1.45;
    color: var(--muted);
  }
</style>
