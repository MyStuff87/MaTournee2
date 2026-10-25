<script lang="ts">
  // Créer une tournée en la traçant à la main sur la carte : on choisit le côté,
  // puis on touche la carte de point en point ; la ligne suit les rues.
  import { onMount } from 'svelte';
  import { go, setCurrent, toast } from '../lib/app.svelte';
  import { getTournee, listTournees, saveTournee } from '../lib/db';
  import { AreaLoader } from '../lib/area';
  import { assignSegment } from '../lib/assign';
  import { uid } from '../lib/recorder';
  import { mergeFC, plainFeatures } from '../lib/mapdata';
  import { DEMO_CENTER, isDemo } from '../lib/demo';
  import type { EdgePoint } from '../lib/roads';
  import type { LL, Mode, Segment, SegSide, Tournee } from '../lib/types';
  import TourMap from '../components/TourMap.svelte';
  import ThemeButton from '../components/ThemeButton.svelte';

  let { tourneeId }: { tourneeId?: string } = $props();

  interface Draft {
    id: string;
    side: SegSide;
    way: EdgePoint[];
    /** longueur du tracé après chaque point (pour annuler) */
    marks: number[];
    path: LL[];
  }

  // svelte-ignore state_referenced_locally
  let phase = $state<'setup' | 'draw'>(tourneeId ? 'draw' : 'setup');
  let name = $state('');
  let mode = $state<Mode>('pied');
  let tournee: Tournee | null = null;
  let kept: Segment[] = []; // tronçons déjà existants (si on complète une tournée)

  let tick = $state(0);
  const area = new AreaLoader(() => tick++);
  let drafts = $state.raw<Draft[]>([]);
  let side = $state<SegSide | null>(null);
  let query = $state('');
  let results = $state<{ label: string; p: LL }[]>([]);
  let panelH = $state(0);
  let saving = $state(false);
  let mapRef: TourMap | undefined = $state();

  onMount(async () => {
    if (tourneeId) {
      tournee = (await getTournee(tourneeId)) ?? null;
      if (!tournee) return go({ name: 'home' });
      mode = tournee.mode;
      kept = tournee.segments;
      area.index.add(Object.values(tournee.addrs));
    } else name = `Tournée ${(await listTournees()).length + 1}`;
  });

  function startDrawing() {
    phase = 'draw';
    setTimeout(locate, 50);
  }

  $effect(() => {
    if (phase === 'draw' && mapRef && tourneeId) {
      const last = kept[kept.length - 1]?.path;
      const p = last?.[last.length - 1];
      if (p) mapRef.flyTo(p, 17);
    }
  });

  /** Centrer sur la position actuelle, une seule fois. */
  function locate() {
    if (isDemo()) return mapRef?.flyTo(DEMO_CENTER, 17);
    navigator.geolocation?.getCurrentPosition(
      (pos) => mapRef?.flyTo({ lat: pos.coords.latitude, lon: pos.coords.longitude }, 17),
      () => toast('Position inconnue : cherche ta commune ou ta rue'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function search(e: Event) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    try {
      const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&limit=5`);
      const j = await r.json();
      results = (j.features ?? []).map((f: any) => ({
        label: f.properties?.label ?? q,
        p: { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] },
      }));
      if (!results.length) toast('Aucun résultat');
    } catch {
      toast('Recherche impossible sans réseau');
    }
  }

  function pickResult(r: { p: LL }) {
    results = [];
    query = '';
    mapRef?.flyTo(r.p, 17);
  }

  function onMoveEnd(c: LL, zoom: number) {
    if (zoom >= 15) area.ensure(c.lat, c.lon);
  }

  const current = $derived(drafts[drafts.length - 1] ?? null);

  function chooseSide(s: SegSide) {
    side = s;
    const cur = drafts[drafts.length - 1];
    if (cur && cur.way.length < 2) {
      // pas encore tracé : on change juste son côté
      drafts = [...drafts.slice(0, -1), { ...cur, side: s }];
      return;
    }
    // nouveau tronçon, qui part du dernier point
    const start = cur ? cur.way[cur.way.length - 1] : null;
    drafts = [
      ...drafts,
      { id: uid(), side: s, way: start ? [start] : [], marks: start ? [1] : [], path: start ? [start.p] : [] },
    ];
  }

  function onMapTap(p: LL) {
    if (!side) return toast("Choisis d'abord Pair, Impair, Les deux ou Rien");
    area.ensure(p.lat, p.lon);
    const ep = area.roads.nearest(p, 40);
    if (!ep) return toast(area.roads.size ? 'Touche plus près d’une rue' : 'Chargement des rues, réessaie dans un instant');
    let cur = drafts[drafts.length - 1];
    if (!cur) {
      chooseSide(side);
      cur = drafts[drafts.length - 1];
    }
    if (!cur.way.length) {
      cur.way.push(ep);
      cur.path.push(ep.p);
      cur.marks.push(cur.path.length);
    } else {
      const last = cur.way[cur.way.length - 1];
      const r = area.roads.route(last, ep, 4000);
      if (!r) return toast('Pas de chemin trouvé par les rues jusque-là');
      cur.way.push(ep);
      cur.path.push(...r.slice(1));
      cur.marks.push(cur.path.length);
    }
    drafts = [...drafts.slice(0, -1), { ...cur }]; // nouvel objet : l'affichage suit
  }

  function undo() {
    const cur = drafts[drafts.length - 1];
    if (!cur) return;
    if (cur.way.length <= 1) {
      drafts = drafts.slice(0, -1);
      side = drafts[drafts.length - 1]?.side ?? side;
      return;
    }
    cur.way.pop();
    cur.marks.pop();
    cur.path = cur.path.slice(0, cur.marks[cur.marks.length - 1] ?? 0);
    drafts = [...drafts.slice(0, -1), { ...cur }];
  }

  async function finish() {
    const ready = drafts.filter((d) => d.path.length >= 2);
    if (!ready.length) return toast('Trace au moins un tronçon');
    saving = true;
    for (const d of ready) for (const p of d.path.filter((_, i) => i % 15 === 0)) area.ensure(p.lat, p.lon);
    await area.idle(15000);
    const taken = new Set(kept.flatMap((s) => s.addrIds));
    const addrs: Tournee['addrs'] = { ...(tournee?.addrs ?? {}) };
    const segs: Segment[] = ready.map((d) => {
      const r = assignSegment(d.side, d.path, area.index, taken, area.roads);
      r.addrIds.forEach((id) => taken.add(id));
      for (const id of r.addrIds) {
        const k = area.index.byId.get(id)?.streetKey;
        if (k) for (const a of area.index.street(k)?.addrs ?? []) addrs[a.id] = a;
      }
      return { id: d.id, side: d.side, raw: d.path, ...r };
    });
    const t: Tournee = tournee ?? {
      id: uid(),
      name: name.trim() || 'Ma tournée',
      mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      segments: [],
      addrs: {},
      track: [],
    };
    t.segments = [...kept, ...segs];
    t.addrs = addrs;
    t.track = [...t.track, ...segs.flatMap((s) => s.path ?? [])];
    t.updatedAt = Date.now();
    await saveTournee(t);
    setCurrent(t.id);
    go({ name: 'review', tourneeId: t.id });
  }

  const routes = $derived.by(() => {
    tick;
    const get = (id: string) => area.index.byId.get(id) ?? tournee?.addrs[id];
    const old = plainFeatures(kept, get, 'done');
    const done = plainFeatures(
      drafts.slice(0, -1).filter((d) => d.path.length >= 2).map((d) => ({ id: d.id, side: d.side, path: d.path, addrIds: [], streetKey: '', street: '', city: '' })),
      get,
      'later',
    );
    const cur = drafts[drafts.length - 1];
    const live =
      cur && cur.path.length >= 2
        ? plainFeatures([{ id: cur.id, side: cur.side, path: cur.path, addrIds: [], streetKey: '', street: '', city: '' }], get, 'next')
        : plainFeatures([], {});
    return mergeFC(old, done, live);
  });
  const lastPoint = $derived(current?.way[current.way.length - 1]?.p ?? null);
  const segCount = $derived(drafts.filter((d) => d.path.length >= 2 && d.side !== 'none').length);

  const BUTTONS: { side: SegSide; title: string; hint: string }[] = [
    { side: 'pair', title: 'Pair', hint: '2 4 6' },
    { side: 'impair', title: 'Impair', hint: '1 3 5' },
    { side: 'both', title: 'Les deux', hint: '1 2 3' },
    { side: 'none', title: 'Rien', hint: 'passage' },
  ];
</script>

{#if phase === 'setup'}
  <main class="screen setup">
    <div class="row">
      <button class="icon-btn" aria-label="Retour" onclick={() => history.back()}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
    </div>
    <h1 class="title">Tracer une tournée</h1>
    <p class="sub">
      Sans sortir : choisis le côté (pair, impair, les deux ou rien), puis touche la carte de point en point.
      La ligne suit les rues toute seule. Change de bouton à chaque nouveau tronçon. Les adresses sont
      ajoutées à la fin.
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
    <button class="btn btn-primary" onclick={startDrawing}>Ouvrir la carte</button>
  </main>
{:else}
  <div class="draw">
    <TourMap bind:this={mapRef} {routes} followMode={false} autoFit={false} padBottom={panelH} padTop={120} pin={lastPoint} {onMapTap} {onMoveEnd} />

    <div class="top">
      <button class="icon-btn" aria-label="Retour" onclick={() => history.back()}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <form class="search" onsubmit={search}>
        <input bind:value={query} placeholder="Commune, rue…" aria-label="Rechercher un lieu" />
      </form>
      <button class="icon-btn" aria-label="Me localiser" onclick={locate}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--email)" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
      </button>
      <ThemeButton />
    </div>
    {#if results.length}
      <ul class="results card">
        {#each results as r (r.label)}
          <li><button onclick={() => pickResult(r)}>{r.label}</button></li>
        {/each}
      </ul>
    {/if}

    <section class="panel" bind:clientHeight={panelH}>
      <p class="status">
        {#if !side}
          Choisis le côté, puis touche la carte au début du tronçon.
        {:else if !current || current.way.length === 0}
          Touche la carte au début du tronçon.
        {:else}
          <strong class="cond n">Tronçon {drafts.length}</strong>
          <span class="sub">Touche la carte plus loin pour prolonger. Un autre bouton commence le tronçon suivant.</span>
        {/if}
      </p>
      <div class="sides">
        {#each BUTTONS as b (b.side)}
          <button class="side {b.side}" class:on={side === b.side} aria-pressed={side === b.side} onclick={() => chooseSide(b.side)}>
            <span class="s1">{b.title}</span>
            <span class="s2">{b.hint}</span>
          </button>
        {/each}
      </div>
      <div class="row">
        <button class="btn btn-ghost" onclick={undo} disabled={!drafts.length}>Annuler le dernier point</button>
        <button class="btn btn-primary grow" onclick={finish} disabled={saving || !segCount}>{saving ? 'Calcul des adresses…' : 'Terminer'}</button>
      </div>
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
  .draw {
    position: fixed;
    inset: 0;
    background: var(--map);
  }
  .top {
    position: absolute;
    top: calc(var(--safe-top) + 12px);
    left: 12px;
    right: 12px;
    display: flex;
    gap: 8px;
    z-index: 30;
  }
  .top .icon-btn {
    box-shadow: 0 2px 10px rgba(21, 35, 63, 0.18);
  }
  .search {
    flex: 1;
    min-width: 0;
  }
  .search input {
    width: 100%;
    height: 44px;
    border-radius: 999px;
    border: 0;
    padding: 0 16px;
    background: var(--card);
    color: var(--ink);
    font: 500 16px var(--body);
    box-shadow: 0 2px 10px rgba(21, 35, 63, 0.18);
  }
  .results {
    position: absolute;
    top: calc(var(--safe-top) + 64px);
    left: 12px;
    right: 12px;
    z-index: 31;
    list-style: none;
    margin: 0;
    padding: 6px;
    box-shadow: 0 8px 24px rgba(21, 35, 63, 0.2);
  }
  .results button {
    width: 100%;
    min-height: 48px;
    border: 0;
    background: none;
    text-align: left;
    padding: 0 12px;
    font-weight: 600;
    font-size: 16px;
    border-radius: 10px;
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
  .status {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 16px;
    font-weight: 500;
    min-height: 34px;
  }
  .n {
    font-weight: 700;
    font-size: 26px;
    line-height: 1;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .side {
    height: 80px;
    border: 0;
    border-radius: 18px;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-family: var(--cond);
  }
  .side.on {
    box-shadow:
      0 0 0 4px var(--card),
      0 0 0 8px var(--yellow);
  }
  .s1 {
    font-weight: 700;
    font-size: 22px;
    line-height: 1;
  }
  .s2 {
    font-weight: 500;
    font-size: 14px;
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
  .grow {
    flex: 1;
  }
  .row .btn {
    min-height: 56px;
  }
  .row .btn-ghost {
    font-size: 14px;
    padding: 0 12px;
  }
</style>
