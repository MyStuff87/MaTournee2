<script lang="ts">
  // Plaque émaillée façon plaque de rue / numéro de maison.
  interface Props {
    text: string;
    size?: 'xxl' | 'xl' | 'l' | 'm' | 's' | 'chip';
    sub?: string;
    off?: boolean;
    ring?: boolean;
    upper?: boolean;
  }
  let { text, size = 'm', sub, off = false, ring = false, upper = false }: Props = $props();
</script>

<span class="plaque {size}" class:off class:ring>
  <span class="t">{upper ? text.toLocaleUpperCase('fr-FR') : text}</span>
  {#if sub}<span class="subt">{sub.toLocaleUpperCase('fr-FR')}</span>{/if}
</span>

<style>
  .plaque {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: var(--email);
    color: #fff;
    font-family: var(--cond);
    font-weight: 700;
    line-height: 1;
    text-align: center;
    letter-spacing: 0.03em;
    --b1: 4px;
    --b2: 7px;
    --r: 10px;
    border-radius: var(--r);
    box-shadow:
      inset 0 0 0 var(--b1) var(--email),
      inset 0 0 0 var(--b2) #fff;
  }
  .t {
    overflow-wrap: anywhere;
  }
  .subt {
    font-weight: 500;
    font-size: 0.5em;
    letter-spacing: 0.05em;
  }
  .xxl {
    font-size: clamp(96px, 34vw, 140px);
    min-width: 62%;
    min-height: 172px;
    padding: 18px 24px;
    letter-spacing: -0.01em;
    --b1: 9px;
    --b2: 14px;
    --r: 22px;
  }
  .xl {
    font-size: 70px;
    min-width: 128px;
    min-height: 100px;
    padding: 10px 14px;
    letter-spacing: 0;
    --b1: 6px;
    --b2: 10px;
    --r: 16px;
  }
  .l {
    font-size: 34px;
    padding: 15px 18px;
    width: 100%;
    --b1: 5px;
    --b2: 8px;
    --r: 12px;
  }
  .m {
    font-size: 24px;
    padding: 10px 12px;
    width: 100%;
    --b1: 3px;
    --b2: 5px;
    --r: 8px;
  }
  .plaque.s {
    font-size: 19px;
    padding: 8px 10px;
    width: 100%;
    --b1: 2px;
    --b2: 4px;
    --r: 7px;
  }
  .chip {
    font-size: 22px;
    min-width: 46px;
    height: 40px;
    padding: 0 8px;
    letter-spacing: 0;
    --b1: 2px;
    --b2: 4px;
    --r: 7px;
  }
  .off {
    background: transparent;
    color: var(--faint);
    box-shadow: inset 0 0 0 2px var(--line);
  }
  .ring {
    box-shadow:
      inset 0 0 0 var(--b1) var(--email),
      inset 0 0 0 var(--b2) #fff,
      0 0 0 3px var(--yellow);
  }
</style>
