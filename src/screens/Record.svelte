<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app, go, setCurrent, toast } from '../lib/app.svelte';
  import { getTournee, listTournees, saveTournee } from '../lib/db';
  import { AreaLoader } from '../lib/area';
  import { Recorder, uid } from '../lib/recorder';
  import { keepAwake, watchGPS, type GpsError } from '../lib/gps';
  import { label } from '../lib/addressIndex';
  import { normalize } from '../lib/ban';
  import type { Dot, Fix, Mode, Side, Tournee } from '../lib/types';
  import type { LL } from '../lib/geo';
  import MapView from '../components/MapView.svelte';
  import Plaque from '../components/Plaque.svelte';
  import SidePill from '../components/SidePill.svelte';
  import GpsHelp from '../components/GpsHelp.svelte';
  import ThemeButton from '../components/ThemeButton.svelte';

  let { tourneeId }: { tourneeId?: string } = $props();

  // --- Préparation ---
  // svelte-ignore state_referenced_locally
  let phase = $state<'setup' | 'running'>(tourneeId ? 'running' : 'setup');
  let name = $state('');
  let mode = $state<Mode>('velo');
  let tournee: Tournee | null = null;

  // --- Enregistrement ---
  let tick = $state(0);
  const bump = () => tick++;
  const area = new AreaLoader(bump);
  let rec: Recorder | null = null;
  let fix = $state<Fix | null>(null);
  let gpsError = $state<GpsError>(null);
  let paused = $state(false);
  let startedAt = Date.now();
  let now = $state(Date.now());
  let picker = $state(false);
  let query = $state('');
  let chosen = $state<{ streetKey: string; street: string; city: string } | null>(null);
  let sideMenu = $state(false);
  let stopGps: (() => void) | null = null;
  let clock: ReturnType<typeof setInterval>;

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
    rec = new Recorder(area.index, mode);
    rec.segments = [...tournee.segments];
    rec.addrs = { ...tournee.addrs };
    // les adresses déjà connues de la tournée servent même hors-ligne
    area.index.add(Object.values(tournee.addrs));
    phase = 'running';
    startedAt = Date.now();
    keepAwake(true);
    clock = setInterval(() => (now = Date.now()), 1000);
    stopGps = watchGPS(onFix, (e) => (gpsError = e));
  }

  function onFix(f: Fix) {
    if (f.acc > 60) return; // trop imprécis
    fix = f;
    area.ensure(f.lat, f.lon);
    if (!paused && rec) rec.onFix(f);
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

  function chooseSide(side: Side) {
    if (!rec) return;
    const target = chosen ?? rec.prompt;
    if (!target) return;
    const prev = rec.active ? rec.finish() : null;
    rec.start(target.streetKey, side);
    chosen = null;
    picker = false;
    if (prev) {
      toast(`${prev.street} : ${plural(prev.addrIds.length, 'adresse enregistrée', 'adresses enregistrées')}`);
      persistDraft();
    }
    bump();
  }

  function finishSegment() {
    if (!rec) return;
    const s = rec.finish();
    if (s) {
      toast(`${s.street} : ${plural(s.addrIds.length, 'adresse enregistrée', 'adresses enregistrées')}`);
      persistDraft();
    } else toast('Aucune adresse captée, tronçon ignoré');
    sideMenu = false;
    bump();
  }

  function changeSide(side: Side) {
    rec?.changeSide(side);
    sideMenu = false;
    bump();
  }

  function dismiss() {
    rec?.dismiss();
    chosen = null;
    bump();
  }

  function undismiss() {
    if (rec) rec.dismissed = null;
    bump();
  }

  async function terminate() {
    if (!rec || !tournee) return;
    rec.finish();
    if (rec.segments.length === 0) {
      if (!confirm("Aucun tronçon n'a été enregistré. Quitter quand même ?")) return;
      go({ name: 'home' });
      return;
    }
    await persistDraft();
    setCurrent(tournee.id);
    go({ name: 'review', tourneeId: tournee.id });
  }

  // --- Vues dérivées ---
  const v = $derived.by(() => {
    tick;
    const r = rec;
    const summary = r?.activeSummary() ?? null;
    const p: LL | null = fix ? { lat: fix.lat, lon: fix.lon } : null;
    const prompt = chosen ?? r?.prompt ?? null;
    const promptInfo = prompt ? area.index.street(prompt.streetKey) : null;
    let dots: Dot[] = [];
    if (r?.active && summary) {
      const on = new Set(summary.addrs.map((a) => a.id));
      dots = (area.index.street(r.active.streetKey)?.addrs ?? []).map((a) => ({
        lat: a.lat,
        lon: a.lon,
        kind: a.id === summary.lastId ? 'next' : on.has(a.id) ? 'on' : 'off',
      }));
    } else if (promptInfo) {
      dots = promptInfo.addrs.map((a) => ({ lat: a.lat, lon: a.lon, kind: 'off' as const }));
    }
    return {
      p,
      track: [...(tournee?.track ?? []), ...(r?.track ?? [])],
      dots,
      summary,
      active: r?.active ?? null,
      prompt,
      promptInfo,
      detected: r?.detected ?? null,
      dismissed: r?.dismissed ?? null,
      segCount: r?.segments.length ?? 0,
      areaStatus: area.status,
      indexSize: area.index.size,
    };
  });

  const nearby = $derived.by(() => {
    tick;
    if (!picker) return [];
    const q = normalize(query);
    if (q) {
      return [...area.index.streets.values()]
        .filter((s) => normalize(s.street).includes(q))
        .slice(0, 30)
        .map((s) => ({ streetKey: s.streetKey, street: s.street, city: s.city }));
    }
    return v.p ? area.index.candidates(v.p, 200).slice(0, 12) : [];
  });

  const elapsed = $derived.by(() => {
    const s = Math.max(0, Math.floor((now - startedAt) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(ss).padStart(2, '0')}`;
  });

  const range = (info: { minNum: number; maxNum: number; city: string } | null | undefined) =>
    info ? `Numéros ${info.minNum} à ${info.maxNum}${info.city ? ', ' + info.city : ''}` : '';

  let mapRef: MapView | undefined = $state();
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
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
      Fais ta tournée à vide, appli ouverte. En entrant dans une rue, choisis le côté que tu fais : pair,
      impair ou les deux. Les adresses devant lesquelles tu passes s'ajoutent toutes seules.
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
    <div class="map-wrap">
      <MapView bind:this={mapRef} position={v.p} track={v.track} dots={v.dots} />
    </div>

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
      <button class="end" onclick={terminate}>Terminer</button>
    </div>

    <div class="theme-slot"><ThemeButton /></div>
    <button class="icon-btn recenter" aria-label="Recentrer la carte" onclick={() => mapRef?.recenter()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--email)" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
    </button>

    <section class="sheet">
      {#if gpsError}
        <GpsHelp error={gpsError} />
      {:else if !fix}
        <p class="state">Recherche de ta position GPS…</p>
      {:else if paused}
        <p class="state">Enregistrement en pause. Les adresses ne sont pas captées.</p>
        <button class="btn btn-primary" onclick={() => (paused = false)}>Reprendre</button>
      {:else if v.indexSize === 0 && v.areaStatus !== 'offline'}
        <p class="state">Chargement des adresses du quartier…</p>
      {:else if v.indexSize === 0}
        <p class="state">
          Pas de réseau : les adresses du quartier n'ont pas pu être chargées. Elles arriveront dès que le
          réseau revient.
        </p>
      {:else if picker && !chosen}
        <div class="row">
          <h2 class="h2">Choisis la rue</h2>
          <span class="spacer"></span>
          <button class="link" onclick={() => ((picker = false), (query = ''))}>Annuler</button>
        </div>
        <input class="search" placeholder="Rechercher une rue" bind:value={query} autocomplete="off" />
        <div class="streets">
          {#each nearby as s (s.streetKey)}
            <button class="street-row" onclick={() => (chosen = s)}>
              <span>{s.street}</span>
              {#if 'd' in s}<span class="sub small">{Math.round((s as { d: number }).d)} m</span>{/if}
            </button>
          {:else}
            <p class="sub">Aucune rue trouvée.</p>
          {/each}
        </div>
      {:else if v.prompt}
        <p class="sub">{chosen ? 'Rue choisie' : 'Tu entres dans'}</p>
        <Plaque text={v.prompt.street} size="l" upper />
        <p class="sub center">{range(v.promptInfo)}</p>
        <h2 class="h2">Quel côté fais-tu ?</h2>
        <div class="sides">
          <button class="side pair" onclick={() => chooseSide('pair')}><span class="s1">Pair</span><span class="s2">2 4 6</span></button>
          <button class="side impair" onclick={() => chooseSide('impair')}><span class="s1">Impair</span><span class="s2">1 3 5</span></button>
          <button class="side both" onclick={() => chooseSide('both')}><span class="s1">Les deux</span><span class="s2">1 2 3</span></button>
        </div>
        <div class="row">
          {#if chosen}
            <button class="btn btn-ghost grow" onclick={() => ((chosen = null), (picker = true))}>Autre rue</button>
            <button class="btn btn-ghost" onclick={() => ((chosen = null), (picker = false))}>Annuler</button>
          {:else if v.active}
            <button class="btn btn-ghost grow" onclick={dismiss}>Je continue {v.active.street.charAt(0).toLowerCase() + v.active.street.slice(1)}</button>
            <button class="btn btn-ghost" onclick={() => (picker = true)}>Autre rue</button>
          {:else}
            <button class="btn btn-ghost grow" onclick={dismiss}>Je ne distribue pas ici</button>
            <button class="btn btn-ghost" onclick={() => (picker = true)}>Autre rue</button>
          {/if}
        </div>
      {:else if v.active && v.summary}
        <div class="row">
          <div class="grow"><Plaque text={v.active.street} size="m" upper /></div>
          <button class="pill-btn" onclick={() => (sideMenu = !sideMenu)} aria-expanded={sideMenu}>
            <SidePill side={v.active.side} long />
          </button>
        </div>
        {#if sideMenu}
          <div class="sides small-sides">
            <button class="side pair" onclick={() => changeSide('pair')}><span class="s1">Pair</span></button>
            <button class="side impair" onclick={() => changeSide('impair')}><span class="s1">Impair</span></button>
            <button class="side both" onclick={() => changeSide('both')}><span class="s1">Les deux</span></button>
          </div>
        {/if}
        <div class="count">
          <p class="cond n">{v.summary.count} adresse{v.summary.count > 1 ? 's' : ''}</p>
          {#if v.summary.min !== null}<p class="sub">du {v.summary.min} au {v.summary.max}</p>{/if}
        </div>
        {#if v.summary.count}
          <div class="chips">
            {#each v.summary.addrs.slice(-14) as a (a.id)}
              <Plaque text={label(a)} size="chip" ring={a.id === v.summary.lastId} />
            {/each}
          </div>
        {:else}
          <p class="sub">Avance devant les boîtes : les numéros apparaissent ici.</p>
        {/if}
        <p class="sub hint">Tu feras la suite plus tard ? Termine le tronçon ici, le reste de la rue restera libre.</p>
        <button class="btn btn-primary" onclick={finishSegment}>Fin du tronçon</button>
      {:else if v.detected && v.dismissed === v.detected.streetKey}
        <Plaque text={v.detected.street} size="m" upper />
        <p class="sub center">Pas de distribution ici. Avance jusqu'à la prochaine rue.</p>
        <div class="row">
          <button class="btn btn-ghost grow" onclick={undismiss}>Je distribue ici</button>
          <button class="btn btn-ghost" onclick={() => (picker = true)}>Autre rue</button>
        </div>
      {:else}
        <p class="state">Avance jusqu'à la première rue de ta tournée.</p>
        <button class="btn btn-ghost" onclick={() => (picker = true)}>Choisir la rue</button>
      {/if}
      {#if v.segCount > 0 && !picker}
        <p class="sub small center">{v.segCount} tronçon{v.segCount > 1 ? 's' : ''} enregistré{v.segCount > 1 ? 's' : ''}</p>
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
  .setup input,
  .search {
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
  .map-wrap {
    position: absolute;
    inset: 0 0 auto 0;
    height: 62dvh;
  }
  .top {
    position: absolute;
    top: calc(var(--safe-top) + 12px);
    left: 14px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 1100;
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
  .recenter {
    position: absolute;
    right: 14px;
    top: calc(var(--safe-top) + 68px);
    z-index: 1100;
  }
  .theme-slot {
    position: absolute;
    left: 14px;
    top: calc(var(--safe-top) + 68px);
    z-index: 1100;
  }
  .sheet {
    position: absolute;
    z-index: 1100 !important;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 78dvh;
    overflow-y: auto;
    background: var(--card);
    border-radius: 28px 28px 0 0;
    padding: 20px 20px calc(var(--safe-bottom) + 22px);
    display: flex;
    flex-direction: column;
    gap: 14px;
    z-index: 600;
    box-shadow: 0 -6px 24px rgba(21, 35, 63, 0.12);
  }
  .state {
    font-size: 18px;
    font-weight: 500;
    line-height: 1.4;
  }
  .h2 {
    font: 700 26px/1.1 var(--cond);
  }
  .center {
    text-align: center;
  }
  .small {
    font-size: 14px;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .side {
    height: 104px;
    border: 0;
    border-radius: 20px;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-family: var(--cond);
  }
  .side:active {
    transform: scale(0.96);
  }
  .small-sides .side {
    height: 56px;
    border-radius: 14px;
  }
  .s1 {
    font-weight: 700;
    font-size: 28px;
    line-height: 1;
  }
  .small-sides .s1 {
    font-size: 22px;
  }
  .s2 {
    font-weight: 500;
    font-size: 17px;
    letter-spacing: 0.12em;
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
  .grow {
    flex: 1;
    min-width: 0;
  }
  .pill-btn {
    border: 0;
    background: none;
    padding: 0;
  }
  .count {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .n {
    font-weight: 700;
    font-size: 44px;
    line-height: 1;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .hint {
    font-size: 15px;
  }
  .streets {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 40dvh;
    overflow-y: auto;
  }
  .street-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 54px;
    padding: 0 16px;
    border-radius: 14px;
    border: 0;
    background: var(--ground);
    font-weight: 600;
    font-size: 17px;
    text-align: left;
  }
</style>
