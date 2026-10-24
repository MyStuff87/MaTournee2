<script lang="ts">
  import { onMount } from 'svelte';
  import { go, setCurrent, toast } from '../lib/app.svelte';
  import { deleteTournee, getTournee, saveTournee } from '../lib/db';
  import { exportTournees } from '../lib/backup';
  import { label, matchesSide, sortByNum } from '../lib/addressIndex';
  import type { Addr, Mode, Segment, Side, Tournee } from '../lib/types';
  import Plaque from '../components/Plaque.svelte';
  import SidePill from '../components/SidePill.svelte';
  import MapView from '../components/MapView.svelte';

  let { tourneeId }: { tourneeId: string } = $props();
  let t = $state<Tournee | null>(null);
  let open = $state<string | null>(null);
  let showMap = $state(false);

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

  function streetAddrs(seg: Segment): Addr[] {
    if (!t) return [];
    return Object.values(t.addrs)
      .filter((a) => a.streetKey === seg.streetKey && matchesSide(a, seg.side))
      .sort(sortByNum);
  }

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
      const list = seg.addrIds.map((id) => t!.addrs[id]);
      const dir = list.length >= 2 ? Math.sign(list[list.length - 1].num - list[0].num) || 1 : 1;
      let at = list.findIndex((b) => (b.num - a.num) * dir > 0);
      if (at < 0) at = list.length;
      seg.addrIds.splice(at, 0, a.id);
    }
    save();
  }

  function setSide(seg: Segment, side: Side) {
    if (seg.side === side) return;
    const cur = seg.addrIds.map((id) => t!.addrs[id]).filter(Boolean);
    const lo = cur.length ? Math.min(...cur.map((a) => a.num)) : -Infinity;
    const hi = cur.length ? Math.max(...cur.map((a) => a.num)) : Infinity;
    const dir = cur.length >= 2 ? Math.sign(cur[cur.length - 1].num - cur[0].num) || 1 : 1;
    seg.side = side;
    const next = Object.values(t!.addrs)
      .filter((a) => a.streetKey === seg.streetKey && matchesSide(a, side) && a.num >= lo - 1 && a.num <= hi + 1)
      .sort((a, b) => sortByNum(a, b) * dir);
    seg.addrIds = next.map((a) => a.id);
    save();
  }

  function reverse(seg: Segment) {
    seg.addrIds.reverse();
    save();
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

  const mapDots = $derived(
    t ? t.segments.flatMap((s) => s.addrIds.map((id) => t!.addrs[id]).filter(Boolean)).map((a) => ({ lat: a.lat, lon: a.lon, kind: 'on' as const })) : [],
  );
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
    <p class="sub">{t.segments.length} tronçon{t.segments.length > 1 ? 's' : ''}, {total} adresses. Touche un tronçon pour le corriger.</p>

    <div class="seg3" role="group" aria-label="Mode de déplacement">
      {#each [['pied', 'À pied'], ['velo', 'Vélo'], ['voiture', 'Voiture']] as [val, lab] (val)}
        <button class:on={t.mode === val} aria-pressed={t.mode === val} onclick={() => setMode(val as Mode)}>{lab}</button>
      {/each}
    </div>

    {#if showMap}
      <div class="map card">
        <MapView track={t.track} dots={mapDots} fit follow={false} />
      </div>
    {:else}
      <ol class="segs">
        {#each t.segments as seg, i (seg.id)}
          <li class="card segc" class:open={open === seg.id}>
            <button class="seg-head" onclick={() => (open = open === seg.id ? null : seg.id)} aria-expanded={open === seg.id}>
              <span class="ord cond">{i + 1}</span>
              <span class="seg-main">
                <span class="row">
                  <span class="grow"><Plaque text={seg.street} size="s" upper /></span>
                  <SidePill side={seg.side} />
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
                <p class="sub small">Touche un numéro pour l'ajouter ou le retirer du tronçon.</p>
                <div class="grid">
                  {#each streetAddrs(seg) as a (a.id)}
                    {@const on = seg.addrIds.includes(a.id)}
                    <button class="tile" class:on aria-pressed={on} onclick={() => toggle(seg, a)}>{label(a)}</button>
                  {/each}
                </div>
                <div class="actions">
                  <button class="btn btn-ghost" onclick={() => reverse(seg)}>Inverser le sens</button>
                  <button class="btn btn-ghost" onclick={() => move(i, -1)} disabled={i === 0}>Monter</button>
                  <button class="btn btn-ghost" onclick={() => move(i, 1)} disabled={i === t.segments.length - 1}>Descendre</button>
                  <button class="btn btn-ghost danger" onclick={() => remove(i)}>Supprimer</button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}

    <button class="btn btn-ghost" onclick={() => go({ name: 'record', tourneeId: t!.id })}>Continuer l'enregistrement</button>
    <button class="btn btn-primary" onclick={() => { setCurrent(t!.id); go({ name: 'home' }); }}>C'est bon</button>
    <div class="foot">
      <button class="link" onclick={() => exportTournees(t!)}>Envoyer cette tournée</button>
      <button class="link danger-link" onclick={destroy}>Supprimer la tournée</button>
    </div>
  </main>
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
    border-color: var(--ink);
    background: var(--ink);
    color: #fff;
  }
  .map {
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .actions .btn {
    min-height: 48px;
    font-size: 15px;
  }
  .danger {
    color: #a32a12;
  }
  .foot {
    display: flex;
    justify-content: center;
    gap: 22px;
    flex-wrap: wrap;
  }
  .danger-link {
    color: #a32a12;
  }
</style>
