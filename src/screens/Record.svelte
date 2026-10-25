<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { go, setCurrent, toast } from '../lib/app.svelte';
  import { getTournee, listTournees, saveTournee } from '../lib/db';
  import { AreaLoader } from '../lib/area';
  import { Recorder, uid } from '../lib/recorder';
  import { keepAwake, watchGPS, type GpsError } from '../lib/gps';
  import { mergeFC, plainFeatures } from '../lib/mapdata';
  import type { Fix, LL, Mode, SegSide, Tournee } from '../lib/types';
  import TourMap from '../components/TourMap.svelte';
  import Plaque from '../components/Plaque.svelte';
  import GpsHelp from '../components/GpsHelp.svelte';
  import ThemeButton from '../components/ThemeButton.svelte';

  let { tourneeId }: { tourneeId?: string } = $props();

  // svelte-ignore state_referenced_locally
  let phase = $state<'setup' | 'running'>(tourneeId ? 'running' : 'setup');
  let name = $state('');
  let mode = $state<Mode>('velo');
  let tournee: Tournee | null = null;

  let tick = $state(0);
  const bump = () => tick++;
  const area = new AreaLoader(bump);
  let rec: Recorder | null = null;
  let fix = $state<Fix | null>(null);
  let gpsError = $state<GpsError>(null);
  let paused = $state(false);
  let startedAt = Date.now();
  let now = $state(Date.now());
  let panelH = $state(0);
  let saving = $state(false);
  let stopGps: (() => void) | null = null;
  let clock: ReturnType<typeof setInterval>;
  let fixCount = 0;
  let live = $state<LL[]>([]);
  let pinMode = $state(false);
  let pin = $state<LL | null>(null);

  onMount(async () => {
    if (tourneeId) {
      tournee = (await getTournee(tourneeId)) ?? null;
      if (!tournee) return go({ name: 'home' });
      mode = tournee.mode;
      begin();
    } else {
      const n = (await listTournees()).length;
      name = `Tournée ${n + 1}`;
    }
  });

  function begin() {
    if (!tournee) {
      tournee = {
        id: uid(),
        name: name.trim() || 'Ma tournée',
        mode,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        segments: [],
        addrs: {},
        track: [],
      };
    }
    rec = new Recorder(area.index, mode, area.roads);
    rec.segments = [...tournee.segments];
    rec.addrs = { ...tournee.addrs };
    area.index.add(Object.values(tournee.addrs));
    phase = 'running';
    startedAt = Date.now();
    keepAwake(true);
    clock = setInterval(() => (now = Date.now()), 1000);
    stopGps = watchGPS(onFix, (e) => (gpsError = e));
  }

  function onFix(f: Fix) {
    if (f.acc > 60) return;
    fix = f;
    area.ensure(f.lat, f.lon);
    if (paused || !rec) return bump();
    rec.onFix(f);
    // le tracé collé aux rues est recalculé toutes les 3 positions
    if (++fixCount % 3 === 0) live = rec.livePath();
    bump();
  }

  onDestroy(() => {
    stopGps?.();
    keepAwake(false);
    clearInterval(clock);
  });

  async function persistDraft() {
    if (!rec || !tournee) return;
    tournee.segments = rec.segments;
    tournee.addrs = rec.addrs;
    tournee.track = [...tournee.track, ...rec.track.splice(0)];
    tournee.updatedAt = Date.now();
    await saveTournee(tournee);
  }

  const SIDE_LABEL: Record<SegSide, string> = { pair: 'côté pair', impair: 'côté impair', both: 'les deux côtés', none: 'sans distribuer' };

  function choose(side: SegSide) {
    if (!rec) return;
    if (!rec.pos) return toast("Attends d'avoir la position GPS");
    const prev = rec.active ? rec.finish() : null;
    rec.start(side);
    live = [];
    pin = null;
    toast(`À partir d'ici : ${SIDE_LABEL[side]}`, undefined, 2500);
    if (prev) persistDraft();
    bump();
  }

  // Corriger sa position en touchant la carte
  function onMapTap(p: LL) {
    if (!pinMode || !rec) return;
    rec.setManual(p);
    pin = p;
    pinMode = false;
    live = rec.livePath();
    toast('Position corrigée', undefined, 2000);
    bump();
  }

  async function terminate() {
    if (!rec || !tournee) return;
    saving = true;
    // on attend la fin du chargement des rues et adresses du quartier
    await area.idle(12000);
    rec.finalize();
    if (!rec.segments.some((s) => s.side !== 'none')) {
      saving = false;
      if (!confirm("Aucun tronçon de distribution n'a été enregistré. Quitter quand même ?")) return;
      go({ name: 'home' });
      return;
    }
    await persistDraft();
    setCurrent(tournee.id);
    go({ name: 'review', tourneeId: tournee.id });
  }

  // --- Vues ---
  const v = $derived.by(() => {
    tick;
    const r = rec;
    const get = (id: string) => r?.addrs[id] ?? r?.index.byId.get(id);
    const done = r ? plainFeatures(r.segments, get, 'done') : plainFeatures([], {});
    const liveFC =
      r?.active && live.length >= 2
        ? plainFeatures([{ id: 'live', side: r.active.side, path: live, addrIds: [], streetKey: '', street: '', city: '' }], get, 'next')
        : plainFeatures([], {});
    return {
      routes: mergeFC(done, liveFC),
      pos: r?.pos ?? (fix ? { lat: fix.lat, lon: fix.lon } : null),
      heading: r?.heading ?? null,
      street: r?.street ?? null,
      active: r?.active ?? null,
      segCount: r?.segments.filter((s) => s.side !== 'none').length ?? 0,
      indexSize: area.index.size,
      areaStatus: area.status,
    };
  });

  const elapsed = $derived.by(() => {
    const s = Math.max(0, Math.floor((now - startedAt) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(ss).padStart(2, '0')}`;
  });

  const BUTTONS: { side: SegSide; title: string; hint: string }[] = [
    { side: 'pair', title: 'Pair', hint: '2 4 6' },
    { side: 'impair', title: 'Impair', hint: '1 3 5' },
    { side: 'both', title: 'Les deux', hint: '1 2 3' },
    { side: 'none', title: 'Rien', hint: 'je passe' },
  ];
</script>

{#if phase === 'setup'}
  <main class="screen setup">
    <div class="row">
      <button class="icon-btn" aria-label="Retour" onclick={() => history.back()}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
    </div>
    <h1 class="title">Enregistrer une tournée</h1>
    <p class="sub">
      Fais ta tournée à vide, appli ouverte. À chaque changement, touche ce que tu fais à partir de cet
      endroit : pair, impair, les deux côtés, ou rien. Les adresses devant lesquelles tu passes sont
      retrouvées toutes seules.
    </p>

    <label class="field">
      <span class="sub">Nom de la tournée</span>
      <input bind:value={name} autocomplete="off" />
    </label>

    <fieldset class="field">
      <legend class="sub">Tu la fais</legend>
      <div class="seg">
        {#each [['pied', 'À pied'], ['velo', 'À vélo'], ['voiture', 'En voiture']] as [val, lab] (val)}
          <button class:on={mode === val} aria-pressed={mode === val} onclick={() => (mode = val as Mode)}>{lab}</button>
        {/each}
      </div>
    </fieldset>

    <div class="spacer"></div>
    <button class="btn btn-primary" onclick={begin}>Démarrer l'enregistrement</button>
  </main>
{:else}
  <div class="rec">
    <TourMap
      routes={v.routes}
      {pin}
      {onMapTap}
      position={v.pos}
      heading={v.heading}
      zoom={mode === 'voiture' ? 17 : 18}
      padBottom={panelH}
    />

    <div class="top">
      <div class="pill-rec" class:paused>
        <span class="dot"></span>
        <span class="lab">{paused ? 'En pause' : 'Enregistrement'}</span>
        <span class="time cond">{elapsed}</span>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" aria-label={paused ? 'Reprendre' : 'Mettre en pause'} onclick={() => (paused = !paused)}>
        {#if paused}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--ink)" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--ink)" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
        {/if}
      </button>
      <button class="end" onclick={terminate} disabled={saving}>{saving ? 'Calcul…' : 'Terminer'}</button>
    </div>
    <div class="theme-slot"><ThemeButton /></div>

    <section class="panel" bind:clientHeight={panelH}>
      {#if gpsError}
        <GpsHelp error={gpsError} />
      {:else if !fix}
        <p class="state">Recherche de ta position GPS…</p>
      {:else}
        <div class="where">
          {#if v.street}
            <div class="grow"><Plaque text={v.street.street} size="s" upper /></div>
          {:else}
            <p class="sub grow">{v.indexSize === 0 ? (v.areaStatus === 'offline' ? 'Pas de réseau : adresses non chargées' : 'Chargement des adresses…') : 'Aucune rue à proximité'}</p>
          {/if}
        </div>

        <p class="status">
          {#if pinMode}
            <strong>Touche la carte à l'endroit où tu es.</strong>
          {:else if paused}
            En pause : le trajet n'est pas enregistré.
          {:else if !v.active}
            Touche ce que tu fais à partir d'ici.
          {:else}
            <strong class="cond n">Tronçon {v.segCount + (v.active.side === 'none' ? 0 : 1)}</strong>
            <span class="sub">{SIDE_LABEL[v.active.side]}. Les adresses seront ajoutées à la fin.</span>
          {/if}
        </p>

        <div class="sides">
          {#each BUTTONS as b (b.side)}
            <button
              class="side {b.side}"
              class:on={v.active?.side === b.side}
              aria-pressed={v.active?.side === b.side}
              disabled={paused}
              onclick={() => choose(b.side)}
            >
              <span class="s1">{b.title}</span>
              <span class="s2">{b.hint}</span>
            </button>
          {/each}
        </div>
        <button class="pinbtn" class:on={pinMode} onclick={() => (pinMode = !pinMode)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
          {pinMode ? 'Annuler' : 'Le GPS se trompe ? Corrige ta position sur la carte'}
        </button>
      {/if}
    </section>
  </div>
{/if}

<style>
  .setup .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 0;
    padding: 0;
    margin: 0;
  }
  .setup legend {
    margin-bottom: 8px;
    padding: 0;
  }
  .setup input {
    height: 56px;
    border-radius: 16px;
    border: 2px solid var(--line);
    background: var(--card);
    padding: 0 16px;
    font: 600 18px var(--body);
    color: var(--ink);
    width: 100%;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .seg button {
    height: 56px;
    border-radius: 16px;
    border: 2px solid var(--line);
    background: var(--card);
    font: 700 20px var(--cond);
  }
  .seg button.on {
    border-color: var(--solid);
    background: var(--solid);
    color: #fff;
  }

  .rec {
    position: fixed;
    inset: 0;
    background: var(--map);
  }
  .top {
    position: absolute;
    top: calc(var(--safe-top) + 12px);
    left: 14px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 30;
  }
  .theme-slot {
    position: absolute;
    left: 14px;
    top: calc(var(--safe-top) + 68px);
    z-index: 30;
  }
  .pill-rec {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 44px;
    padding: 0 16px 0 14px;
    border-radius: 999px;
    background: var(--solid);
    color: #fff;
  }
  .pill-rec .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--rec);
    animation: blink 1.6s ease-in-out infinite;
  }
  .pill-rec.paused .dot {
    background: #9aa6b5;
    animation: none;
  }
  @keyframes blink {
    50% {
      opacity: 0.35;
    }
  }
  .lab {
    font-weight: 600;
    font-size: 15px;
  }
  .time {
    font-weight: 600;
    font-size: 19px;
    color: #c8d1de;
  }
  .end {
    height: 44px;
    padding: 0 14px;
    border-radius: 999px;
    border: 0;
    background: var(--card);
    font-weight: 600;
    font-size: 15px;
  }
  .panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    background: var(--card);
    border-radius: 26px 26px 0 0;
    padding: 16px 16px calc(var(--safe-bottom) + 16px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 -6px 24px rgba(21, 35, 63, 0.14);
  }
  .state {
    font-size: 18px;
    font-weight: 500;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .status {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 17px;
    font-weight: 500;
    min-height: 34px;
  }
  .n {
    font-weight: 700;
    font-size: 30px;
    line-height: 1;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .side {
    height: 92px;
    border: 0;
    border-radius: 18px;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-family: var(--cond);
    transition:
      transform 0.08s,
      box-shadow 0.15s;
  }
  .side:active:not(:disabled) {
    transform: scale(0.95);
  }
  .side.on {
    box-shadow:
      0 0 0 4px var(--card),
      0 0 0 8px var(--yellow);
  }
  .s1 {
    font-weight: 700;
    font-size: 24px;
    line-height: 1;
  }
  .s2 {
    font-weight: 500;
    font-size: 15px;
    letter-spacing: 0.08em;
    opacity: 0.85;
  }
  .side.pair {
    background: var(--email);
  }
  .side.impair {
    background: var(--impair);
  }
  .side.both {
    background: var(--solid);
  }
  .side.none {
    background: var(--ground);
    color: var(--ink);
    box-shadow: inset 0 0 0 2px var(--line);
  }
  .side.none.on {
    box-shadow:
      inset 0 0 0 2px var(--line),
      0 0 0 4px var(--card),
      0 0 0 8px var(--yellow);
  }
  .pinbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    border: 0;
    border-radius: 14px;
    background: var(--ground);
    color: var(--link);
    font-weight: 600;
    font-size: 15px;
    padding: 0 12px;
  }
  .pinbtn.on {
    background: var(--yellow);
    color: var(--on-yellow);
  }
  .small {
    font-size: 13px;
  }
  .center {
    text-align: center;
  }
</style>
