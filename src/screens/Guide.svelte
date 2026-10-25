<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { go, today, toast } from '../lib/app.svelte';
  import { getSession, getTournee, saveSession, saveTournee } from '../lib/db';
  import { AddressIndex, isEven, label } from '../lib/addressIndex';
  import { stopsFor } from '../lib/guide';
  import { buildRoute, passedStops, RouteFollower, type Route } from '../lib/follow';
  import { PositionFilter } from '../lib/smooth';
  import { guideFeatures } from '../lib/mapdata';
  import { keepAwake, watchGPS, type GpsError } from '../lib/gps';
  import { dist, formatDist, type LL } from '../lib/geo';
  import type { Addr, DaySession, Fix, Tournee } from '../lib/types';
  import TourMap, { type StopPin } from '../components/TourMap.svelte';
  import SidePill from '../components/SidePill.svelte';
  import GpsHelp from '../components/GpsHelp.svelte';
  import NoteSheet from '../components/NoteSheet.svelte';
  import ThemeButton from '../components/ThemeButton.svelte';

  let { tourneeId }: { tourneeId: string } = $props();
  let t = $state<Tournee | null>(null);
  let session: DaySession | null = null;
  let stops = $state<Addr[]>([]);
  let done = $state(new Set<string>());
  let fix = $state<Fix | null>(null);
  let gpsError = $state<GpsError>(null);
  let pos = $state<LL | null>(null);
  let heading = $state<number | null>(null);
  let along = $state(0);
  let offRoute = $state(false);
  let cardH = $state(0);
  const index = new AddressIndex();
  let route: Route | null = null;
  let follower: RouteFollower | null = null;
  let filter: PositionFilter | null = null;
  let stopGps: (() => void) | null = null;

  onMount(async () => {
    t = (await getTournee(tourneeId)) ?? null;
    if (!t) return go({ name: 'home' });
    const key = `${tourneeId}|${today()}`;
    session = (await getSession(key)) ?? { key, tourneeId, date: today(), checked: [], done: [] };
    done = new Set(session.done);
    stops = stopsFor(t, new Set(session.checked));
    index.add(Object.values(t.addrs));
    route = buildRoute(t);
    // reprise : on repart après le dernier arrêt fait
    const resume = Math.max(0, ...[...done].map((id) => route!.stopAlong.get(id) ?? 0));
    along = resume;
    follower = new RouteFollower(route, resume);
    filter = new PositionFilter(t.mode);
    keepAwake(true);
    stopGps = watchGPS(onFix, (e) => (gpsError = e));
  });

  onDestroy(() => {
    stopGps?.();
    keepAwake(false);
  });

  const pending = $derived(stops.filter((a) => !done.has(a.id)));
  const cur = $derived(pending[0] ?? null);
  const next = $derived(pending.slice(1, 4));
  const pct = $derived(stops.length ? Math.round(((stops.length - pending.length) / stops.length) * 100) : 0);
  const here = $derived(pos ? index.nearest(pos, 30) : null);
  const distLabel = $derived.by(() => {
    if (!pos || !cur || !route) return '';
    const sa = route.stopAlong.get(cur.id);
    if (!offRoute && sa !== undefined) return formatDist(Math.max(0, sa - along));
    return formatDist(dist(pos, cur));
  });

  function save() {
    if (!session) return;
    session.done = [...done];
    saveSession(session);
  }

  function onFix(f: Fix) {
    if (f.acc > 60 || !filter || !follower || !route) return;
    fix = f;
    const smooth = filter.update(f);
    const r = follower.update(smooth);
    offRoute = r.offRoute;
    if (r.snapped) {
      // Collé au parcours : lignes droites, direction du parcours.
      pos = r.snapped;
      heading = r.heading;
      along = r.along;
      const passed = passedStops(pending, route, along);
      if (passed.length) {
        const n = new Set(done);
        for (const id of passed) n.add(id);
        done = n;
        save();
      }
    } else {
      pos = smooth;
      heading = filter.heading ?? heading;
    }
  }

  // Toucher un numéro sur la carte : ouvre sa note. Rien à valider, tout avance seul.
  let sheetAddr = $state<Addr | null>(null);

  function onStopTap(id: string) {
    sheetAddr = t?.addrs[id] ?? null;
  }

  function saveNote(a: Addr, text: string) {
    if (!t) return;
    const notes = { ...(t.notes ?? {}) };
    if (text) notes[a.id] = text;
    else delete notes[a.id];
    t.notes = notes;
    t.updatedAt = Date.now();
    saveTournee($state.snapshot(t) as Tournee);
    sheetAddr = null;
    toast(text ? 'Note enregistrée' : 'Note effacée');
  }

  function restart() {
    done = new Set();
    along = 0;
    if (route) follower = new RouteFollower(route, 0);
    save();
  }

  const features = $derived(t ? guideFeatures(t, along) : { type: 'FeatureCollection' as const, features: [] });
  const pins = $derived<StopPin[]>(
    stops.map((a) => ({
      id: a.id,
      label: label(a),
      lat: a.lat,
      lon: a.lon,
      state: a.id === cur?.id ? 'next' : done.has(a.id) ? 'done' : 'todo',
      note: !!t?.notes?.[a.id],
    })),
  );

  const short = (s: string) =>
    s.replace(/^(rue|avenue|boulevard|place|impasse|allée|chemin|route|quai|cours)\s+(de la |du |des |de l'|d'|de )?/i, '');
  const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
</script>

{#if t}
  <div class="guide">
    <TourMap
      routes={features}
      stops={pins}
      position={pos}
      {heading}
      zoom={t.mode === 'voiture' ? 17 : 18}
      padBottom={cardH}
      {onStopTap}
    />

    <div class="top">
      <button class="icon-btn" aria-label="Quitter la tournée" onclick={() => history.back()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <ThemeButton />
      <div class="prog" aria-label="Progression">
        <span class="cond count">{stops.length - pending.length}<span class="of">&nbsp;/ {stops.length}</span></span>
        <span class="bar"><span style="width: {pct}%"></span></span>
      </div>
    </div>

    <section class="card info" bind:clientHeight={cardH}>
      {#if gpsError}
        <GpsHelp error={gpsError} />
      {:else if cur}
        <div class="nextrow">
          <span class="num cond">{label(cur)}</span>
          <div class="nextcol">
            <p class="street cond">{cur.street}</p>
            <div class="row">
              <SidePill side={isEven(cur) ? 'pair' : 'impair'} long />
              {#if distLabel}<span class="dist cond">{distLabel}</span>{/if}
            </div>
          </div>
        </div>
        {#if t.notes?.[cur.id]}
          <button class="note" onclick={() => (sheetAddr = cur)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H9l-5 4z" /></svg>
            <span>{t.notes[cur.id]}</span>
          </button>
        {/if}
        {#if next.length}
          <p class="then">
            <span class="sub">Ensuite</span>
            {#each next as n (n.id)}
              <span class="chip cond">{label(n)}</span>{#if n.street !== cur.street}<span class="sub st">{short(n.street)}</span>{/if}
            {/each}
          </p>
        {/if}
        <p class="here sub">
          {#if !fix}Recherche de ta position GPS…{:else if here}Tu es {lc(here.street)}, au niveau du {label(here)}{:else}Tu es hors des rues de la tournée{/if}
        </p>
      {:else if stops.length}
        <div class="finished">
          <h1 class="title">Tournée terminée</h1>
          <p class="sub">Les {stops.length} arrêts sont faits. Bonne fin de journée.</p>
          <button class="btn btn-primary" onclick={() => go({ name: 'home' })}>Retour à l'accueil</button>
          <button class="link" onclick={restart}>Recommencer la tournée</button>
        </div>
      {:else}
        <p class="sub">Cette tournée n'a aucun arrêt.</p>
      {/if}
    </section>
  </div>

  {#if sheetAddr}
    {@const a = sheetAddr}
    <NoteSheet
      addr={a}
      note={t.notes?.[a.id] ?? ''}
      onSave={(text) => saveNote(a, text)}
      onClose={() => (sheetAddr = null)}
    />
  {/if}
{/if}

<style>
  .guide {
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
    gap: 10px;
    z-index: 30;
  }
  .top .icon-btn {
    box-shadow: 0 2px 10px rgba(21, 35, 63, 0.18);
  }
  .prog {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    background: var(--solid);
    color: #fff;
    min-width: 170px;
  }
  .count {
    font-weight: 700;
    font-size: 22px;
    white-space: nowrap;
  }
  .of {
    font-weight: 500;
    color: #c8d1de;
  }
  .bar {
    flex: 1;
    height: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.22);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--yellow);
    border-radius: 4px;
    transition: width 0.4s;
  }
  .info {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: calc(var(--safe-bottom) + 10px);
    z-index: 30;
    border-radius: 26px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 8px 28px rgba(21, 35, 63, 0.22);
    max-width: 560px;
    margin: 0 auto;
  }
  .nextrow {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .num {
    min-width: 92px;
    height: 78px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    background: var(--yellow);
    color: var(--on-yellow);
    font-weight: 700;
    font-size: 52px;
    line-height: 1;
    box-shadow: inset 0 0 0 4px var(--on-yellow);
    flex: none;
  }
  .nextcol {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .street {
    font-weight: 700;
    font-size: 26px;
    line-height: 1.05;
  }
  .dist {
    font-weight: 600;
    font-size: 21px;
  }
  .note {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    text-align: left;
    border: 0;
    border-radius: 14px;
    padding: 10px 12px;
    background: var(--note);
    color: var(--note-ink);
    font-weight: 600;
    font-size: 17px;
    line-height: 1.3;
  }
  .note svg {
    flex: none;
    margin-top: 1px;
  }
  .then {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }
  .chip {
    min-width: 36px;
    height: 32px;
    padding: 0 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: var(--email);
    color: #fff;
    font-weight: 700;
    font-size: 19px;
    box-shadow:
      inset 0 0 0 2px var(--email),
      inset 0 0 0 4px #fff;
  }
  .st {
    font-size: 14px;
    margin-left: -2px;
  }
  .here {
    font-size: 14px;
  }
  .finished {
    display: flex;
    flex-direction: column;
    gap: 12px;
    text-align: center;
  }
</style>
