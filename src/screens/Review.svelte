<script lang="ts">
  import { onMount } from 'svelte';
  import { go, setCurrent, toast } from '../lib/app.svelte';
  import { deleteTournee, getTournee, saveTournee } from '../lib/db';
  import { exportTournees } from '../lib/backup';
  import { AddressIndex, isEven, label, sortByNum } from '../lib/addressIndex';
  import { assignAll, assignSegment, migrateSegment } from '../lib/assign';
  import { cellsAround, loadCell } from '../lib/ban';
  import { lineLength, projectDetailed } from '../lib/geo';
  import { pinsFor, plainFeatures } from '../lib/mapdata';
  import type { Addr, Mode, Segment, SegSide, Side, Tournee } from '../lib/types';
  import Plaque from '../components/Plaque.svelte';
  import SidePill from '../components/SidePill.svelte';
  import TourMap from '../components/TourMap.svelte';
  import NoteSheet from '../components/NoteSheet.svelte';

  let { tourneeId }: { tourneeId: string } = $props();
  let t = $state<Tournee | null>(null);
  let open = $state<string | null>(null);
  let showMap = $state(false);
  let tapMode = $state<'include' | 'note'>('include');
  let noteAddr = $state<Addr | null>(null);

  function saveNote(a: Addr, text: string) {
    if (!t) return;
    const notes = { ...(t.notes ?? {}) };
    if (text) notes[a.id] = text;
    else delete notes[a.id];
    t.notes = notes;
    noteAddr = null;
    save();
    toast(text ? 'Note enregistrée' : 'Note effacée');
  }

  onMount(async () => {
    t = (await getTournee(tourneeId)) ?? null;
    if (!t) go({ name: 'home' });
  });

  function save() {
    if (!t) return;
    t.updatedAt = Date.now();
    saveTournee(t);
  }

  const total = $derived(t ? new Set(t.segments.flatMap((s) => s.addrIds)).size : 0);

  const parityOk = (a: Addr, side: SegSide) =>
    side === 'both' || (side === 'pair' ? isEven(a) : side === 'impair' ? !isEven(a) : false);

  /** Numéros proposés pour un tronçon : ceux des rues qu'il traverse, du bon côté. */
  function streetAddrs(seg: Segment): Addr[] {
    if (!t) return [];
    const keys = new Set([seg.streetKey, ...seg.addrIds.map((id) => t!.addrs[id]?.streetKey)]);
    return Object.values(t.addrs)
      .filter((a) => keys.has(a.streetKey) && parityOk(a, seg.side))
      .sort((a, b) => a.street.localeCompare(b.street) || sortByNum(a, b));
  }

  function title(seg: Segment) {
    const st = seg.streets?.length ? seg.streets : [seg.street];
    return st.length > 1 ? `${st[0]}, puis ${st.length === 2 ? st[1] : `${st.length - 1} autres rues`}` : st[0] || 'Rue inconnue';
  }

  const indexOf = (tt: Tournee) => {
    const idx = new AddressIndex();
    idx.add(Object.values(tt.addrs));
    return idx;
  };
  const takenExcept = (seg: Segment) => new Set(t!.segments.filter((s) => s !== seg).flatMap((s) => s.addrIds));

  function summary(seg: Segment) {
    const nums = seg.addrIds.map((id) => t!.addrs[id]?.num).filter((n) => n !== undefined);
    if (!nums.length) return 'Aucune adresse';
    const n = seg.addrIds.length;
    const head = `${n} adresse${n > 1 ? 's' : ''}`;
    if (n === 1) return `${head}, le ${nums[0]}`;
    if (seg.side === 'both') return `${head}, numéros ${Math.min(...nums)} à ${Math.max(...nums)}`;
    return `${head}, du ${nums[0]} au ${nums[nums.length - 1]}`;
  }

  function toggle(seg: Segment, a: Addr) {
    const i = seg.addrIds.indexOf(a.id);
    if (i >= 0) seg.addrIds.splice(i, 1);
    else {
      // on l'insère à sa place le long du tracé
      const path = migrateSegment(seg, t!.addrs).path ?? [];
      const pos = (x: Addr) => (path.length >= 2 ? projectDetailed(x, path).along : x.num);
      const list = seg.addrIds.map((id) => t!.addrs[id]);
      let at = list.findIndex((b) => pos(b) > pos(a));
      if (at < 0) at = list.length;
      seg.addrIds.splice(at, 0, a.id);
    }
    save();
  }

  function setSide(seg: Segment, side: Side) {
    if (!t || seg.side === side) return;
    seg.side = side;
    if (seg.raw && seg.raw.length >= 2) {
      const r = assignSegment(side, seg.raw, indexOf(t), takenExcept(seg));
      Object.assign(seg, r);
    } else {
      const keys = new Set([seg.streetKey, ...seg.addrIds.map((id) => t!.addrs[id]?.streetKey)]);
      const path = migrateSegment(seg, t.addrs).path ?? [];
      seg.addrIds = Object.values(t.addrs)
        .filter((a) => keys.has(a.streetKey) && parityOk(a, side))
        .sort((a, b) => (path.length >= 2 ? projectDetailed(a, path).along - projectDetailed(b, path).along : sortByNum(a, b)))
        .map((a) => a.id);
    }
    save();
  }

  // Recalcule toutes les adresses à partir des tracés (utile si le réseau manquait à l'enregistrement).
  let recomputing = $state(false);
  async function recompute() {
    if (!t) return;
    recomputing = true;
    const idx = indexOf(t);
    const cells = new Set<string>();
    for (const s of t.segments)
      for (const [k, p] of (s.raw ?? []).entries()) if (k % 20 === 0) cellsAround(p.lat, p.lon).forEach((c) => cells.add(c));
    let offline = false;
    await Promise.all(
      [...cells].map(async (c) => {
        const addrs = await loadCell(c);
        if (addrs) idx.add(addrs);
        else offline = true;
      }),
    );
    const before = new Set(t.segments.flatMap((s) => s.addrIds)).size;
    t.segments = assignAll($state.snapshot(t.segments) as Segment[], idx);
    for (const seg of t.segments)
      for (const id of seg.addrIds) {
        const k = idx.byId.get(id)?.streetKey;
        if (k) for (const a of idx.street(k)?.addrs ?? []) t.addrs[a.id] = a;
      }
    save();
    recomputing = false;
    const after = new Set(t.segments.flatMap((s) => s.addrIds)).size;
    toast(`${after} adresses (avant : ${before})${offline ? '. Pas de réseau pour une partie du quartier.' : ''}`);
  }

  function move(i: number, d: number) {
    if (!t) return;
    const j = i + d;
    if (j < 0 || j >= t.segments.length) return;
    const [s] = t.segments.splice(i, 1);
    t.segments.splice(j, 0, s);
    save();
  }

  function remove(i: number) {
    if (!t) return;
    const [s] = t.segments.splice(i, 1);
    open = null;
    save();
    toast(`Tronçon ${s.street} supprimé`, {
      label: 'Annuler',
      run: () => {
        t!.segments.splice(i, 0, s);
        save();
      },
    });
  }

  function setMode(m: Mode) {
    if (!t) return;
    t.mode = m;
    save();
  }

  async function destroy() {
    if (!t || !confirm(`Supprimer définitivement « ${t.name} » ?`)) return;
    await deleteTournee(t.id);
    setCurrent(null);
    go({ name: 'home' });
  }

  const mapRoutes = $derived(t ? plainFeatures(t.segments, t.addrs) : plainFeatures([], {}));
  const mapPins = $derived(
    t ? pinsFor(t.segments.flatMap((s) => s.addrIds.map((id) => t!.addrs[id]).filter(Boolean)), 'todo', t.notes) : [],
  );
  const distSegs = $derived(t ? t.segments.filter((s) => s.side !== 'none') : []);
</script>

{#if t}
  <main class="screen">
    <div class="row">
      <button class="icon-btn" aria-label="Accueil" onclick={() => go({ name: 'home' })}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span class="spacer"></span>
      <button class="chip-btn" onclick={() => (showMap = !showMap)}>{showMap ? 'Liste' : 'Carte'}</button>
    </div>

    <input class="name title" bind:value={t.name} onchange={save} aria-label="Nom de la tournée" />
    <p class="sub">{distSegs.length} tronçon{distSegs.length > 1 ? 's' : ''}, {total} adresses. Touche un tronçon pour le corriger.</p>

    <div class="seg3" role="group" aria-label="Mode de déplacement">
      {#each [['pied', 'À pied'], ['velo', 'Vélo'], ['voiture', 'Voiture']] as [val, lab] (val)}
        <button class:on={t.mode === val} aria-pressed={t.mode === val} onclick={() => setMode(val as Mode)}>{lab}</button>
      {/each}
    </div>

    {#if showMap}
      <div class="map card">
        <TourMap routes={mapRoutes} stops={mapPins} followMode={false} padTop={20} />
      </div>
    {:else}
      <ol class="segs">
        {#each t.segments as seg, i (seg.id)}
          {#if seg.side === 'none'}
            <li class="passage">
              <span class="sub small">Passage sans distribuer{seg.path ? `, ${Math.round(lineLength(seg.path) / 10) * 10} m` : ''}</span>
              <button class="link small" onclick={() => remove(i)}>Retirer</button>
            </li>
          {:else}
          <li class="card segc" class:open={open === seg.id}>
            <button class="seg-head" onclick={() => (open = open === seg.id ? null : seg.id)} aria-expanded={open === seg.id}>
              <span class="ord cond">{i + 1}</span>
              <span class="seg-main">
                <span class="row">
                  <span class="grow"><Plaque text={title(seg)} size="s" upper /></span>
                  <SidePill side={seg.side as Side} />
                </span>
                <span class="sub small">{summary(seg)}</span>
              </span>
            </button>

            {#if open === seg.id}
              <div class="editor">
                <div class="seg3 small" role="group" aria-label="Côté">
                  {#each [['pair', 'Pair'], ['impair', 'Impair'], ['both', 'Les deux']] as [val, lab] (val)}
                    <button class:on={seg.side === val} aria-pressed={seg.side === val} onclick={() => setSide(seg, val as Side)}>{lab}</button>
                  {/each}
                </div>
                <div class="tapmode" role="group" aria-label="Quand je touche un numéro">
                  <button class:on={tapMode === 'include'} aria-pressed={tapMode === 'include'} onclick={() => (tapMode = 'include')}>Ajouter / retirer</button>
                  <button class:on={tapMode === 'note'} aria-pressed={tapMode === 'note'} onclick={() => (tapMode = 'note')}>Écrire une note</button>
                </div>
                <p class="sub small">
                  {tapMode === 'include' ? "Touche un numéro pour l'ajouter ou le retirer du tronçon." : 'Touche un numéro pour écrire sa note. Les numéros avec une note ont un point jaune.'}
                </p>
                <div class="grid">
                  {#each streetAddrs(seg) as a (a.id)}
                    {@const on = seg.addrIds.includes(a.id)}
                    <button
                      class="tile"
                      class:on
                      class:has-note={!!t.notes?.[a.id]}
                      aria-pressed={tapMode === 'include' ? on : undefined}
                      aria-label="{label(a)}{t.notes?.[a.id] ? ', avec note' : ''}"
                      onclick={() => (tapMode === 'note' ? (noteAddr = a) : toggle(seg, a))}>{label(a)}</button
                    >
                  {/each}
                </div>
                <div class="actions">
                  <button class="btn btn-ghost" onclick={() => move(i, -1)} disabled={i === 0}>Monter</button>
                  <button class="btn btn-ghost" onclick={() => move(i, 1)} disabled={i === t.segments.length - 1}>Descendre</button>
                  <button class="btn btn-ghost danger" onclick={() => remove(i)}>Supprimer</button>
                </div>
              </div>
            {/if}
          </li>
          {/if}
        {/each}
      </ol>
    {/if}

    <button class="btn btn-ghost" onclick={() => go({ name: 'record', tourneeId: t!.id })}>Continuer l'enregistrement</button>
    <button class="btn btn-ghost" onclick={recompute} disabled={recomputing}>{recomputing ? 'Calcul en cours…' : 'Recalculer les adresses depuis le tracé'}</button>
    <button class="btn btn-primary" onclick={() => { setCurrent(t!.id); go({ name: 'home' }); }}>C'est bon</button>
    <div class="foot">
      <button class="link" onclick={() => exportTournees(t!)}>Envoyer cette tournée</button>
      <button class="link danger-link" onclick={destroy}>Supprimer la tournée</button>
    </div>
  </main>

  {#if noteAddr}
    {@const a = noteAddr}
    <NoteSheet addr={a} note={t.notes?.[a.id] ?? ''} onSave={(text) => saveNote(a, text)} onClose={() => (noteAddr = null)} />
  {/if}
{/if}

<style>
  .name {
    border: 0;
    background: transparent;
    color: var(--ink);
    padding: 0;
    width: 100%;
    border-bottom: 2px dashed transparent;
  }
  .name:focus {
    outline: none;
    border-bottom-color: var(--line);
  }
  .chip-btn {
    height: 40px;
    padding: 0 16px;
    border-radius: 999px;
    border: 0;
    background: var(--card);
    font-weight: 600;
    font-size: 15px;
  }
  .seg3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .seg3 button {
    height: 48px;
    border-radius: 14px;
    border: 2px solid var(--line);
    background: var(--card);
    font: 700 19px var(--cond);
  }
  .seg3.small button {
    height: 44px;
  }
  .seg3 button.on {
    border-color: var(--solid);
    background: var(--solid);
    color: #fff;
  }
  .passage {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 0 40px;
    min-height: 36px;
  }
  .map {
    position: relative;
    height: 60dvh;
    padding: 0;
    overflow: hidden;
  }
  .segs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .segc {
    padding: 0;
    overflow: hidden;
  }
  .seg-head {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 14px 14px 14px 10px;
    border: 0;
    background: none;
    text-align: left;
  }
  .ord {
    width: 26px;
    text-align: center;
    font-weight: 600;
    font-size: 17px;
    color: var(--muted);
    flex: none;
  }
  .seg-main {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .small {
    font-size: 14px;
  }
  .editor {
    padding: 4px 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-top: 1px solid var(--line-soft);
    padding-top: 14px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
    gap: 8px;
  }
  .tile {
    height: 50px;
    border-radius: 9px;
    border: 2px solid var(--line-soft);
    background: var(--tile-off);
    color: var(--faint);
    font: 700 21px/1 var(--cond);
    padding: 0 2px;
  }
  .tile {
    position: relative;
  }
  .tile.has-note::after {
    content: '';
    position: absolute;
    right: -4px;
    top: -4px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--yellow);
    box-shadow: 0 0 0 2px var(--card);
  }
  .tapmode {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    background: var(--ground);
  }
  .tapmode button {
    height: 40px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    font-weight: 600;
    font-size: 15px;
    color: var(--muted);
  }
  .tapmode button.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: 0 1px 4px rgba(21, 35, 63, 0.15);
  }
  .tile.on {
    border: 0;
    background: var(--email);
    color: #fff;
    box-shadow:
      inset 0 0 0 3px var(--email),
      inset 0 0 0 5px #fff;
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .actions .btn {
    min-height: 48px;
    font-size: 15px;
  }
  .danger {
    color: var(--danger);
  }
  .foot {
    display: flex;
    justify-content: center;
    gap: 22px;
    flex-wrap: wrap;
  }
  .danger-link {
    color: var(--danger);
  }
</style>
