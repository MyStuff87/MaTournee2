<script lang="ts">
  // Voir une tournée sur la carte, sans la démarrer : vue d'ensemble, et un
  // curseur pour la parcourir comme pendant le guidage.
  import { onMount } from 'svelte';
  import { go } from '../lib/app.svelte';
  import { getTournee } from '../lib/db';
  import { label } from '../lib/addressIndex';
  import { buildRoute, type Route } from '../lib/follow';
  import { guideFeatures, plainFeatures } from '../lib/mapdata';
  import { pointAt } from '../lib/geo';
  import type { Side, Tournee } from '../lib/types';
  import TourMap, { type StopPin } from '../components/TourMap.svelte';
  import SidePill from '../components/SidePill.svelte';
  import ThemeButton from '../components/ThemeButton.svelte';

  let { tourneeId }: { tourneeId: string } = $props();
  let t = $state<Tournee | null>(null);
  let route = $state<Route | null>(null);
  let along = $state<number | null>(null); // null = vue d'ensemble
  let cardH = $state(0);
  let mapRef: TourMap | undefined = $state();

  onMount(async () => {
    t = (await getTournee(tourneeId)) ?? null;
    if (!t) return go({ name: 'home' });
    route = buildRoute(t);
  });

  const total = $derived(route ? route.cum[route.cum.length - 1] ?? 0 : 0);
  const stopCount = $derived(t ? new Set(t.segments.flatMap((s) => s.addrIds)).size : 0);
  const distSegs = $derived(t ? t.segments.filter((s) => s.side !== 'none').length : 0);

  /** Tronçon sous le curseur. */
  const segIdx = $derived.by(() => {
    if (!route || along === null) return -1;
    let i = 0;
    for (let k = 0; k < route.segStart.length; k++) if (route.segStart[k] <= along + 0.5) i = k;
    return i;
  });
  const seg = $derived(t && segIdx >= 0 ? t.segments[segIdx] : null);
  const cursor = $derived(route && along !== null && route.line.length >= 2 ? pointAt(route.line, along) : null);

  const features = $derived(
    t ? (along === null ? plainFeatures(t.segments, t.addrs) : guideFeatures(t, along)) : plainFeatures([], {}),
  );
  const pins = $derived.by<StopPin[]>(() => {
    if (!t || !route) return [];
    const seen = new Set<string>();
    const out: StopPin[] = [];
    let nextId: string | null = null;
    for (const s of t.segments)
      for (const id of s.addrIds) {
        const a = t.addrs[id];
        if (!a || seen.has(id)) continue;
        seen.add(id);
        const sa = route.stopAlong.get(id) ?? 0;
        let state: StopPin['state'] = 'todo';
        if (along !== null) {
          if (sa <= along) state = 'done';
          else if (!nextId) {
            nextId = id;
            state = 'next';
          }
        }
        out.push({ id, label: label(a), lat: a.lat, lon: a.lon, state, note: !!t.notes?.[id] });
      }
    return out;
  });

  function startBrowse() {
    along = 0;
  }
  function overview() {
    along = null;
    mapRef?.overview();
  }
  function jumpSeg(d: number) {
    if (!route) return;
    const i = Math.max(0, Math.min(route.segStart.length - 1, segIdx + d));
    along = route.segStart[i] + 1;
  }

  const SIDE: Record<string, string> = { pair: 'Côté pair', impair: 'Côté impair', both: 'Les deux côtés', none: 'Passage sans distribuer' };
  const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
</script>

{#if t}
  <div class="view">
    <TourMap
      bind:this={mapRef}
      routes={features}
      stops={pins}
      position={cursor?.p ?? null}
      heading={cursor?.heading ?? null}
      followMode={along !== null}
      zoom={18}
      padBottom={cardH}
      padTop={80}
    />

    <div class="top">
      <button class="icon-btn" aria-label="Retour" onclick={() => history.back()}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <ThemeButton />
    </div>

    <section class="card info" bind:clientHeight={cardH}>
      {#if along === null}
        <h1 class="name cond">{t.name}</h1>
        <p class="sub">{stopCount} adresses, {distSegs} tronçon{distSegs > 1 ? 's' : ''}, {km(total)} de parcours.</p>
        <div class="row">
          <button class="btn btn-primary grow" onclick={startBrowse}>Parcourir la tournée</button>
        </div>
      {:else}
        <div class="row head">
          <span class="cond segn">Tronçon {segIdx + 1} / {t.segments.length}</span>
          <span class="spacer"></span>
          {#if seg && seg.side !== 'none'}<SidePill side={seg.side as Side} />{/if}
        </div>
        <p class="street cond">{seg?.side === 'none' ? SIDE.none : seg?.street || '…'}</p>
        {#if seg && seg.side !== 'none'}
          <p class="sub">{seg.addrIds.length} adresse{seg.addrIds.length > 1 ? 's' : ''}{seg.streets && seg.streets.length > 1 ? `, puis ${seg.streets.slice(1).join(', ')}` : ''}</p>
        {/if}
        <input
          class="slider"
          type="range"
          min="0"
          max={Math.max(1, Math.round(total))}
          step="1"
          value={Math.round(along)}
          oninput={(e) => (along = Number((e.target as HTMLInputElement).value))}
          aria-label="Avancer dans la tournée"
        />
        <div class="row">
          <button class="btn btn-ghost nav" onclick={() => jumpSeg(-1)} disabled={segIdx <= 0} aria-label="Tronçon précédent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button class="btn btn-ghost grow" onclick={overview}>Vue d'ensemble</button>
          <button class="btn btn-ghost nav" onclick={() => jumpSeg(1)} disabled={!route || segIdx >= route.segStart.length - 1} aria-label="Tronçon suivant">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  .view {
    position: fixed;
    inset: 0;
    background: var(--map);
  }
  .top {
    position: absolute;
    top: calc(var(--safe-top) + 12px);
    left: 14px;
    display: flex;
    gap: 10px;
    z-index: 30;
  }
  .top .icon-btn {
    box-shadow: 0 2px 10px rgba(21, 35, 63, 0.18);
  }
  .info {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: calc(var(--safe-bottom) + 10px);
    z-index: 30;
    max-width: 560px;
    margin: 0 auto;
    border-radius: 26px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 8px 28px rgba(21, 35, 63, 0.22);
  }
  .name {
    font-weight: 700;
    font-size: 28px;
    line-height: 1.05;
  }
  .grow {
    flex: 1;
  }
  .segn {
    font-weight: 600;
    font-size: 18px;
    color: var(--muted);
  }
  .street {
    font-weight: 700;
    font-size: 26px;
    line-height: 1.05;
  }
  .slider {
    width: 100%;
    height: 44px;
    accent-color: var(--email);
  }
  .nav {
    width: 56px;
    padding: 0;
  }
</style>
