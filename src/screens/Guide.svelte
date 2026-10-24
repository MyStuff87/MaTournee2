<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { go, today, toast } from '../lib/app.svelte';
  import { getSession, getTournee, saveSession } from '../lib/db';
  import { AddressIndex, isEven, label } from '../lib/addressIndex';
  import { Guide, stopsFor } from '../lib/guide';
  import { keepAwake, watchGPS, type GpsError } from '../lib/gps';
  import { dist, formatDist, type LL } from '../lib/geo';
  import type { Addr, DaySession, Dot, Fix, Tournee } from '../lib/types';
  import Plaque from '../components/Plaque.svelte';
  import SidePill from '../components/SidePill.svelte';
  import MapView from '../components/MapView.svelte';
  import GpsHelp from '../components/GpsHelp.svelte';

  let { tourneeId }: { tourneeId: string } = $props();
  let t = $state<Tournee | null>(null);
  let session = $state<DaySession | null>(null);
  let stops = $state<Addr[]>([]);
  let done = $state(new Set<string>());
  let skipped = $state(new Set<string>());
  let fix = $state<Fix | null>(null);
  let gpsError = $state<GpsError>(null);
  let showMap = $state(false);
  let index = new AddressIndex();
  let guide: Guide | null = null;
  let stopGps: (() => void) | null = null;

  onMount(async () => {
    t = (await getTournee(tourneeId)) ?? null;
    if (!t) return go({ name: 'home' });
    const key = `${tourneeId}|${today()}`;
    session = (await getSession(key)) ?? { key, tourneeId, date: today(), checked: [], done: [] };
    done = new Set(session.done);
    skipped = new Set(session.skipped ?? []);
    stops = stopsFor(t, new Set(session.checked));
    index.add(Object.values(t.addrs));
    guide = new Guide(t.mode);
    keepAwake(true);
    stopGps = watchGPS(onFix, (e) => (gpsError = e));
  });

  onDestroy(() => {
    stopGps?.();
    keepAwake(false);
  });

  const pending = $derived(stops.filter((a) => !done.has(a.id) && !skipped.has(a.id)));
  const cur = $derived(pending[0] ?? null);
  const next = $derived(pending.slice(1, 4));
  const delivered = $derived(stops.filter((a) => done.has(a.id)).length);
  const pos: LL | null = $derived(fix ? { lat: fix.lat, lon: fix.lon } : null);
  const here = $derived.by(() => {
    if (!pos) return null;
    const a = index.nearest(pos, 35);
    return a;
  });
  const distLabel = $derived(pos && cur ? formatDist(dist(pos, cur)) : '');

  function save() {
    if (!session) return;
    session.done = [...done];
    session.skipped = [...skipped];
    saveSession(session);
  }

  function mark(id: string, delivered: boolean, auto = false) {
    const a = stops.find((s) => s.id === id);
    if (delivered) done = new Set(done).add(id);
    else skipped = new Set(skipped).add(id);
    save();
    if (!auto && a) {
      toast(`${delivered ? 'Livré' : 'Passé'} : ${label(a)} ${a.street}`, { label: 'Annuler', run: () => undo(id) });
    }
  }

  function undo(id: string) {
    const d = new Set(done);
    d.delete(id);
    const s = new Set(skipped);
    s.delete(id);
    done = d;
    skipped = s;
    guide?.reset();
    save();
  }

  function onFix(f: Fix) {
    if (f.acc > 60) return;
    fix = f;
    if (!guide || !cur) return;
    const id = guide.onFix({ lat: f.lat, lon: f.lon }, cur, pending[1] ?? null);
    if (id) {
      const a = cur;
      mark(id, true, true);
      toast(`Livré : ${label(a)} ${a.street}`, { label: 'Annuler', run: () => undo(id) });
    }
  }

  function restart() {
    done = new Set();
    skipped = new Set();
    save();
  }

  const short = (s: string) => s.replace(/^(rue|avenue|boulevard|place|impasse|allée|chemin|route|quai|cours)\s+(de la |du |des |de l'|d'|de )?/i, '');
  const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

  const dots = $derived<Dot[]>(
    stops.map((a) => ({
      lat: a.lat,
      lon: a.lon,
      kind: a.id === cur?.id ? 'next' : done.has(a.id) || skipped.has(a.id) ? 'done' : 'on',
    })),
  );
</script>

{#if t}
  <main class="screen guide">
    <div class="row">
      <button class="icon-btn" aria-label="Quitter la tournée" onclick={() => history.back()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div class="prog">
        <div class="row between">
          <span class="strong">{delivered} livré{delivered > 1 ? 's' : ''} sur {stops.length}</span>
          <span class="sub small">encore {pending.length}</span>
        </div>
        <div class="bar"><div style="width: {stops.length ? Math.round(((stops.length - pending.length) / stops.length) * 100) : 0}%"></div></div>
      </div>
      <button class="icon-btn" aria-label={showMap ? 'Masquer la carte' : 'Voir la carte'} aria-pressed={showMap} onclick={() => (showMap = !showMap)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--email)" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15M15 6v15" /></svg>
      </button>
    </div>

    {#if gpsError}
      <div class="card"><GpsHelp error={gpsError} /></div>
    {:else}
      <p class="here sub">
        <span class="here-dot" class:live={!!fix}></span>
        {#if !fix}Recherche de ta position GPS…{:else if here}Tu es {lc(here.street)}, devant le {label(here)}{:else}Tu es hors des adresses de la tournée{/if}
      </p>
    {/if}

    {#if showMap}
      <div class="map card"><MapView position={pos} dots={dots} /></div>
    {/if}

    {#if cur}
      <section class="card next" aria-live="polite">
        <p class="sub lab">Prochain arrêt</p>
        <Plaque text={label(cur)} size="xxl" />
        <p class="street cond">{cur.street}</p>
        <div class="row">
          <SidePill side={isEven(cur) ? 'pair' : 'impair'} long />
          {#if distLabel}<span class="dist cond">{distLabel}</span>{/if}
        </div>
      </section>

      {#if next.length}
        <div class="then">
          <p class="sub small then-h">Ensuite</p>
          <div class="then-grid">
            {#each next as n (n.id)}
              <div class="then-card">
                <Plaque text={label(n)} size="chip" />
                <span class="sub tiny">{short(n.street)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="actions">
        <button class="btn btn-ghost skip" onclick={() => mark(cur!.id, false)}>Passer</button>
        <button class="btn btn-primary deliver" onclick={() => mark(cur!.id, true)}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
          Livré
        </button>
      </div>
    {:else if stops.length}
      <section class="card finished">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7 12.5l3.2 3.2L17 9" /></svg>
        <h1 class="title">Tournée terminée</h1>
        <p class="sub">{delivered} livré{delivered > 1 ? 's' : ''}{skipped.size ? `, ${skipped.size} passé${skipped.size > 1 ? 's' : ''}` : ''}. Bonne fin de journée.</p>
        <button class="btn btn-primary" onclick={() => go({ name: 'home' })}>Retour à l'accueil</button>
        <button class="link" onclick={restart}>Recommencer la tournée</button>
      </section>
    {/if}
  </main>
{/if}

<style>
  .guide {
    gap: 16px;
  }
  .prog {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .between {
    justify-content: space-between;
  }
  .strong {
    font-weight: 600;
    font-size: 15px;
  }
  .small {
    font-size: 15px;
  }
  .tiny {
    font-size: 13px;
    text-align: center;
    line-height: 1.2;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--line-soft);
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--ok);
    border-radius: 4px;
    transition: width 0.3s;
  }
  .here {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .here-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #9aa6b5;
    flex: none;
  }
  .here-dot.live {
    background: var(--email);
    box-shadow: 0 0 0 4px rgba(27, 76, 156, 0.2);
  }
  .map {
    height: 34dvh;
    padding: 0;
    overflow: hidden;
  }
  .next {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    border-radius: 28px;
    padding: 20px 20px 22px;
  }
  .lab {
    align-self: flex-start;
  }
  .street {
    font-weight: 700;
    font-size: 30px;
    line-height: 1.05;
    text-align: center;
  }
  .dist {
    font-weight: 600;
    font-size: 22px;
  }
  .then {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .then-h {
    margin-left: 4px;
  }
  .then-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .then-card {
    background: var(--card);
    border-radius: 16px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .actions {
    margin-top: auto;
    display: flex;
    gap: 10px;
    position: sticky;
    bottom: calc(var(--safe-bottom) + 10px);
  }
  .skip {
    width: 112px;
    min-height: 76px;
    border-radius: 22px;
    font: 700 22px var(--cond);
  }
  .deliver {
    flex: 1;
    min-height: 76px;
    border-radius: 22px;
    font-size: 28px;
  }
  .finished {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
    padding: 30px 20px;
  }
  .finished .btn {
    width: 100%;
  }
</style>
