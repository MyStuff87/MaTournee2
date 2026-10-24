<script lang="ts">
  import type { Side } from '../lib/types';
  let { side, long = false }: { side: Side; long?: boolean } = $props();
  const labels = { pair: 'Pair', impair: 'Impair', both: 'Les deux' };
</script>

<span class="pill {side}">{long && side !== 'both' ? `Côté ${labels[side].toLowerCase()}` : labels[side]}</span>

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    height: 38px;
    padding: 0 13px;
    border-radius: 11px;
    font-family: var(--cond);
    font-weight: 700;
    font-size: 19px;
    white-space: nowrap;
    flex: none;
  }
  .pair {
    background: var(--pair-tint);
    color: var(--email);
  }
  .impair {
    background: var(--impair-tint);
    color: var(--impair-ink);
  }
  .both {
    background: var(--both-tint);
    color: var(--ink);
  }
</style>
