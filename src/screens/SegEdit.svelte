<script lang="ts">
  // Modifier le tracé d'un tronçon déjà enregistré : déplacer le début ou la fin,
  // le retracer, le couper en deux, changer son côté. Les adresses sont recalculées.
  import { onMount } from 'svelte';
  import { go, toast } from '../lib/app.svelte';
  import { getTournee, saveTournee } from '../lib/db';
  import { AreaLoader } from '../lib/area';
  import { assignSegment, migrateSegment } from '../lib/assign';
  import { uid } from '../lib/recorder';
  import { label } from '../lib/addressIndex';
  import { lineLength, projectDetailed, subLine } from '../lib/geo';
  import { mergeFC, plainFeatures } from '../lib/mapdata';
  import type { EdgePoint } from '../lib/roads';
  import type { Addr, LL, Segment, SegSide, Tournee } from '../lib/types';
  import TourMap, { type StopPin } from '../components/TourMap.svelte';
  import ThemeButton from '../components/ThemeButton.svelte';

  let { tourneeId, segId }: { tourneeId: string; segId: string } = $props();

  interface Part {
    id: string;
    side: SegSide;
    path: LL[];
    addrIds: string[];
    street: string;
  }

  let t = $state.raw<Tournee | null>(null);
  let segIndex = -1;
  let parts = $state.raw<Part[]>([]);
  let sel = $state(0);
  let mode = $state<'idle' | 'retrace' | 'cut'>('idle');
  let way: EdgePoint[] = [];
  let tick = $state(0);
  const area = new AreaLoader(() => tick++);
  let ready = $state(false);
  let saving = $state(false);
  let panelH = $state(0);

  onMount(async () => {
    const tt = (await getTournee(tourneeId)) ?? null;
    if (!tt) return go({ name: 'home' });
    segIndex = tt.segments.findIndex((s) => s.id === segId);
    if (segIndex < 0) return go({ name: 'review', tourneeId });
    t = tt;
    area.index.add(Object.values(tt.addrs));
    const seg = migrateSegment(tt.segments[segIndex], tt.addrs);
    const path = seg.path ?? [];
    for (const [k, p] of path.entries()) if (k % 10 === 0 || k === path.length - 1) area.ensure(p.lat, p.lon);
    await area.idle(15000);
    parts = [{ id: seg.id, side: seg.side, path, addrIds: seg.addrIds, street: seg.street }];
    ready = true;
  });

  const others = (): Set<string> => new Set((t?.segments ?? []).filter((_, i) => i !== segIndex).flatMap((s) => s.addrIds));

  /** Recalcule les adresses de toutes les parties du tronçon. */
  function recompute(list: Part[]): Part[] {
    const taken = others();
    return list.map((p) => {
      if (p.path.length < 2) return { ...p, addrIds: [] };
      const r = assignSegment(p.side, p.path, area.index, taken, area.roads);
      r.addrIds.forEach((id) => taken.add(id));
      return { ...p, path: r.path.length >= 2 ? r.path : p.path, addrIds: r.addrIds, street: r.street || p.street };
    });
  }

  function update(i: number, patch: Partial<Part>, recalc = true) {
    const next = parts.map((p, k) => (k === i ? { ...p, ...patch } : p));
    parts = recalc ? recompute(next) : next;
  }

  function setSide(s: SegSide) {
    update(sel, { side: s });
  }

  const snap = (p: LL) => area.roads.nearest(p, 40);

  /** Glisser le début ou la fin : raccourcir si on reste sur le tracé, sinon allonger par les rues. */
  function onHandleDrop(id: string, p: LL) {
    const i = id === 'start' ? 0 : parts.length - 1;
    const path = parts[i].path;
    const ep = snap(p);
    if (!ep) return toast('Pose le repère sur une rue'), (parts = [...parts]);
    const pr = projectDetailed(ep.p, path);
    const total = lineLength(path);
    let next: LL[] | null;
    if (pr.d < 8) next = id === 'start' ? subLine(path, pr.along, total) : subLine(path, 0, pr.along);
    else {
      const anchor = snap(id === 'start' ? path[0] : path[path.length - 1]);
      const r = anchor ? (id === 'start' ? area.roads.route(ep, anchor, 4000) : area.roads.route(anchor, ep, 4000)) : null;
      if (!r) return toast('Pas de chemin par les rues jusque-là'), (parts = [...parts]);
      next = id === 'start' ? [...r, ...path.slice(1)] : [...path, ...r.slice(1)];
    }
    if (next.length < 2) return toast('Tronçon trop court'), (parts = [...parts]);
    update(i, { path: next });
  }

  function onMapTap(p: LL) {
    if (mode === 'retrace') {
      const ep = snap(p);
      if (!ep) return toast('Touche plus près d’une rue');
      if (!way.length) {
        way = [ep];
        update(sel, { path: [ep.p] }, false);
        return;
      }
      const r = area.roads.route(way[way.length - 1], ep, 4000);
      if (!r) return toast('Pas de chemin par les rues jusque-là');
      way = [...way, ep];
      update(sel, { path: [...parts[sel].path, ...r.slice(1)] }, false);
    } else if (mode === 'cut') {
      const part = parts[sel];
      const pr = projectDetailed(p, part.path);
      if (pr.d > 30 || !pr.inside) return toast('Touche sur le tracé du tronçon');
      const total = lineLength(part.path);
      const a: Part = { ...part, path: subLine(part.path, 0, pr.along) };
      const b: Part = { ...part, id: uid(), path: subLine(part.path, pr.along, total) };
      parts = recompute([...parts.slice(0, sel), a, b, ...parts.slice(sel + 1)]);
      sel = sel + 1;
      mode = 'idle';
      toast('Tronçon coupé en deux : choisis le côté de chaque partie');
    }
  }

  function startRetrace() {
    mode = 'retrace';
    way = [];
    update(sel, { path: [] }, false);
  }

  function endRetrace() {
    mode = 'idle';
    if (parts[sel].path.length < 2) return toast('Touche au moins deux points');
    parts = recompute(parts);
  }

  async function save() {
    if (!t) return;
    saving = true;
    const addrs = { ...t.addrs };
    const segs: Segment[] = parts
      .filter((p) => p.path.length >= 2)
      .map((p) => {
        for (const id of p.addrIds) {
          const k = area.index.byId.get(id)?.streetKey;
          if (k) for (const a of area.index.street(k)?.addrs ?? []) addrs[a.id] = a;
        }
        const first = p.addrIds.map((id) => area.index.byId.get(id) ?? addrs[id]).find(Boolean);
        return {
          id: p.id,
          side: p.side,
          path: p.path,
          raw: p.path,
          addrIds: p.addrIds,
          streetKey: first?.streetKey ?? '',
          street: p.street || first?.street || '',
          city: first?.city ?? '',
          streets: [...new Set(p.addrIds.map((id) => (area.index.byId.get(id) ?? addrs[id])?.street).filter(Boolean) as string[])],
        };
      });
    const segments = [...t.segments.slice(0, segIndex), ...segs, ...t.segments.slice(segIndex + 1)];
    await saveTournee({ ...t, segments, addrs, updatedAt: Date.now() });
    toast('Tronçon enregistré');
    go({ name: 'review', tourneeId });
  }

  // --- Affichage ---
  const get = (id: string): Addr | undefined => area.index.byId.get(id) ?? t?.addrs[id];
  const routes = $derived.by(() => {
    tick;
    if (!t) return plainFeatures([], {});
    const rest = plainFeatures(t.segments.filter((_, i) => i !== segIndex), get, 'done');
    const mine = parts.map((p, k) =>
      plainFeatures([{ id: p.id, side: p.side, path: p.path, addrIds: p.addrIds, streetKey: '', street: '', city: '' }], get, k === sel ? 'next' : 'later'),
    );
    return mergeFC(rest, ...mine);
  });
  const pins = $derived.by<StopPin[]>(() =>
    parts.flatMap((p) => p.addrIds.map(get).filter((a): a is Addr => !!a).map((a) => ({ id: a.id, label: label(a), lat: a.lat, lon: a.lon, state: 'todo' as const }))),
  );
  const handles = $derived.by(() => {
    if (mode !== 'idle' || !parts.length) return [];
    const first = parts[0].path[0];
    const lastPath = parts[parts.length - 1].path;
    const last = lastPath[lastPath.length - 1];
    return first && last
      ? [
          { id: 'start', label: 'Début', lat: first.lat, lon: first.lon },
          { id: 'end', label: 'Fin', lat: last.lat, lon: last.lon },
        ]
      : [];
  });
  const total = $derived(parts.reduce((n, p) => n + p.addrIds.length, 0));

  const BUTTONS: { side: SegSide; title: string }[] = [
    { side: 'pair', title: 'Pair' },
    { side: 'impair', title: 'Impair' },
    { side: 'both', title: 'Les deux' },
    { side: 'none', title: 'Rien' },
  ];
</script>

<div class="segedit">
  {#if ready}
    <TourMap {routes} stops={pins} fitTo={parts.flatMap((p) => p.path)} followMode={false} padBottom={panelH} padTop={80} {handles} {onHandleDrop} {onMapTap} />
  {/if}

  <div class="top">
    <button class="icon-btn" aria-label="Retour sans enregistrer" onclick={() => history.back()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <ThemeButton />
  </div>

  <section class="panel" bind:clientHeight={panelH}>
    {#if !ready}
      <p class="state">Chargement des rues et des adresses…</p>
    {:else}
      {#if parts.length > 1}
        <div class="parts" role="group" aria-label="Partie du tronçon">
          {#each parts as p, k (p.id)}
            <button class:on={sel === k} aria-pressed={sel === k} onclick={() => (sel = k)}>Partie {k + 1}</button>
          {/each}
        </div>
      {/if}
      <p class="status">
        {#if mode === 'retrace'}
          <strong>Touche la carte de point en point pour retracer{parts.length > 1 ? ` la partie ${sel + 1}` : ' le tronçon'}.</strong>
        {:else if mode === 'cut'}
          <strong>Touche le tracé à l'endroit où couper.</strong>
        {:else}
          {@const n = parts[sel]?.addrIds.length ?? 0}
          <strong class="cond n">{n} adresse{n > 1 ? 's' : ''}</strong>
          <span class="sub">
            {#if parts.length > 1}Partie {sel + 1}, {total} au total. {/if}
            {#if n === 0 && parts[sel]?.side !== 'none'}Aucune adresse libre de ce côté (elles sont peut-être déjà dans un autre tronçon).{:else}Fais glisser « Début » ou « Fin » pour raccourcir ou allonger.{/if}
          </span>
        {/if}
      </p>
      <div class="sides">
        {#each BUTTONS as b (b.side)}
          <button class="side {b.side}" class:on={parts[sel]?.side === b.side} aria-pressed={parts[sel]?.side === b.side} onclick={() => setSide(b.side)} disabled={mode !== 'idle'}>{b.title}</button>
        {/each}
      </div>
      <div class="row">
        {#if mode === 'retrace'}
          <button class="btn btn-primary grow" onclick={endRetrace}>Fin du nouveau tracé</button>
        {:else if mode === 'cut'}
          <button class="btn btn-ghost grow" onclick={() => (mode = 'idle')}>Annuler la coupe</button>
        {:else}
          <button class="btn btn-ghost grow" onclick={startRetrace}>Retracer</button>
          <button class="btn btn-ghost grow" onclick={() => (mode = 'cut')}>Couper en deux</button>
        {/if}
      </div>
      {#if mode === 'idle'}
        <button class="btn btn-primary" onclick={save} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le tronçon'}</button>
      {/if}
    {/if}
  </section>
</div>

<style>
  .segedit {
    position: fixed;
    inset: 0;
    background: var(--map);
  }
  .top {
    position: absolute;
    top: calc(var(--safe-top) + 12px);
    left: 12px;
    display: flex;
    gap: 8px;
    z-index: 30;
  }
  .top .icon-btn {
    box-shadow: 0 2px 10px rgba(21, 35, 63, 0.18);
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
    font-size: 17px;
  }
  .status {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 15px;
    min-height: 32px;
  }
  .n {
    font-weight: 700;
    font-size: 28px;
    line-height: 1;
  }
  .parts {
    display: flex;
    gap: 6px;
  }
  .parts button {
    flex: 1;
    height: 40px;
    border-radius: 12px;
    border: 2px solid var(--line);
    background: var(--card);
    font: 700 17px var(--cond);
  }
  .parts button.on {
    background: var(--solid);
    border-color: var(--solid);
    color: #fff;
  }
  .sides {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .side {
    height: 56px;
    border: 0;
    border-radius: 16px;
    color: #fff;
    font: 700 20px var(--cond);
  }
  .side.on {
    box-shadow:
      0 0 0 3px var(--card),
      0 0 0 6px var(--yellow);
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
      0 0 0 3px var(--card),
      0 0 0 6px var(--yellow);
  }
  .grow {
    flex: 1;
  }
</style>
