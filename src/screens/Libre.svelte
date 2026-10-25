<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { AreaLoader } from '../lib/area';
  import { StreetTracker, isEven, label } from '../lib/addressIndex';
  import { keepAwake, watchGPS, type GpsError } from '../lib/gps';
  import { bearing, dist, type LL } from '../lib/geo';
  import type { Addr, Fix } from '../lib/types';
  import Plaque from '../components/Plaque.svelte';
  import GpsHelp from '../components/GpsHelp.svelte';

  let tick = $state(0);
  const area = new AreaLoader(() => tick++);
  const tracker = new StreetTracker(3, 35);
  let fix = $state<Fix | null>(null);
  let gpsError = $state<GpsError>(null);
  let heading: number | null = null;
  let lastMove: LL | null = null;
  let stop: (() => void) | null = null;

  onMount(() => {
    keepAwake(true);
    stop = watchGPS(
      (f) => {
        if (f.acc > 80) return;
        const p = { lat: f.lat, lon: f.lon };
        if (lastMove && dist(lastMove, p) > 8) {
          heading = bearing(lastMove, p);
          lastMove = p;
        } else if (!lastMove) lastMove = p;
        fix = f;
        area.ensure(f.lat, f.lon);
        tracker.update(area.index.candidates(p));
        tick++;
      },
      (e) => (gpsError = e),
    );
  });
  onDestroy(() => {
    stop?.();
    keepAwake(false);
  });

  const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  const view = $derived.by(() => {
    tick;
    if (!fix) return null;
    const p = { lat: fix.lat, lon: fix.lon };
    const st = tracker.current;
    if (!st) return { p, street: null };
    const info = area.index.street(st.streetKey);
    if (!info) return { p, street: null };
    const sides = [true, false].map((even) => {
      const list = info.addrs.filter((a) => isEven(a) === even);
      if (!list.length) return null;
      let i = 0;
      let bd = Infinity;
      list.forEach((a, k) => {
        const d = dist(p, a);
        if (d < bd) {
          bd = d;
          i = k;
        }
      });
      return { list, i, d: bd };
    });
    // Sens de marche : les numéros croissants sont-ils devant ?
    let up = true;
    if (heading !== null) {
      for (const s of sides) {
        if (!s) continue;
        const n = s.list[s.i + 1] ?? s.list[s.i - 1];
        if (!n) continue;
        const ahead = angle(heading, bearing(p, n)) < 90;
        up = s.list[s.i + 1] ? ahead : !ahead;
        break;
      }
    }
    const col = (s: (typeof sides)[number]) => {
      if (!s) return null;
      const at = (k: number) => s.list[s.i + (up ? k : -k)] ?? null;
      return { far: at(2), near: at(1), cur: s.list[s.i], back: at(-1), d: s.d };
    };
    return { p, street: info, even: col(sides[0]), odd: col(sides[1]) };
  });

  const acc = $derived(fix ? Math.round(fix.acc) : null);
  const lab = (a: Addr | null) => (a ? label(a) : '');
</script>

<main class="screen libre">
  <div class="row">
    <button class="icon-btn" aria-label="Retour" onclick={() => history.back()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <span class="spacer"></span>
    {#if acc !== null}
      <span class="gps"><span class="g-dot" class:bad={acc > 25}></span>GPS précis à {acc} m</span>
    {/if}
  </div>

  {#if gpsError}
    <div class="card"><GpsHelp error={gpsError} /></div>
  {:else if !view}
    <p class="state">Recherche de ta position GPS…</p>
  {:else if !view.street}
    <p class="state">
      {#if area.status === 'loading' || (area.index.size === 0 && area.status !== 'offline')}
        Chargement des adresses du quartier…
      {:else if area.index.size === 0}
        Pas de réseau : les adresses de ce quartier ne sont pas encore sur ton téléphone.
      {:else}
        Aucune adresse à moins de 35 m.
      {/if}
    </p>
  {:else}
    <div class="where">
      <p class="sub">Tu es dans</p>
      <Plaque text={view.street.street} size="l" upper />
      {#if view.street.city}<p class="sub center">{view.street.city}</p>{/if}
    </div>

    <section class="street" aria-label="Numéros autour de toi">
      {#each [{ c: view.odd, name: 'Côté impair', cls: 'odd' }, { c: view.even, name: 'Côté pair', cls: 'even' }] as side, k (side.cls)}
        <div class="col {side.cls}" style="order: {k === 0 ? 0 : 2}">
          <span class="col-h cond">{side.name}</span>
          {#if side.c}
            <span class="n far">{lab(side.c.far)}</span>
            <span class="n near">{lab(side.c.near)}</span>
            <Plaque text={lab(side.c.cur)} size="xl" />
            <span class="n near">{lab(side.c.back)}</span>
          {:else}
            <span class="sub none">Aucun numéro</span>
          {/if}
        </div>
      {/each}
      <div class="road" aria-hidden="true" style="order: 1">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="#7a8699"><path d="M12 3l9 16H3z" /></svg>
        <span class="dash"></span>
        <span class="me"></span>
      </div>
    </section>
    <p class="sub center small">Les numéros devant toi sont en haut, ceux que tu viens de passer en bas.</p>
  {/if}
</main>

<style>
  .libre {
    min-height: 100dvh;
  }
  .gps {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--card);
    font-size: 14px;
    color: var(--muted);
  }
  .g-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ok);
  }
  .g-dot.bad {
    background: var(--impair);
  }
  .state {
    font-size: 18px;
    line-height: 1.4;
    margin-top: 20px;
  }
  .where {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .center {
    text-align: center;
  }
  .small {
    font-size: 15px;
  }
  .street {
    flex: 1;
    min-height: 380px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr);
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
  }
  .col-h {
    font-weight: 700;
    font-size: 18px;
  }
  .odd .col-h {
    color: var(--impair-ink);
  }
  .even .col-h {
    color: var(--pair-ink);
  }
  .n {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    border: 2px solid var(--line);
    color: var(--faint);
    font: 700 30px/1 var(--cond);
    min-width: 80px;
    height: 56px;
    padding: 0 6px;
  }
  .n:empty {
    visibility: hidden;
  }
  .n.far {
    min-width: 70px;
    height: 50px;
    font-size: 26px;
  }
  .none {
    margin: auto 0;
  }
  .road {
    background: var(--road);
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px 0;
  }
  .dash {
    width: 4px;
    flex: 1;
    margin: 10px 0;
    background-image: linear-gradient(#fff 50%, transparent 50%);
    background-size: 4px 22px;
  }
  .me {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--email);
    box-shadow:
      0 0 0 5px #fff,
      0 0 0 16px rgba(27, 76, 156, 0.2);
    margin: 4px 0 64px;
  }
</style>
