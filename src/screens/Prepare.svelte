<script lang="ts">
  import { onMount } from 'svelte';
  import { go, today } from '../lib/app.svelte';
  import { getSession, getTournee, saveSession } from '../lib/db';
  import { label } from '../lib/addressIndex';
  import type { Addr, DaySession, Segment, Tournee } from '../lib/types';
  import Plaque from '../components/Plaque.svelte';
  import SidePill from '../components/SidePill.svelte';

  let { tourneeId }: { tourneeId: string } = $props();
  let t = $state<Tournee | null>(null);
  let session = $state<DaySession | null>(null);
  let checked = $state(new Set<string>());

  onMount(async () => {
    t = (await getTournee(tourneeId)) ?? null;
    if (!t) return go({ name: 'home' });
    const key = `${tourneeId}|${today()}`;
    session = (await getSession(key)) ?? { key, tourneeId, date: today(), checked: [], done: [] };
    checked = new Set(session.checked);
  });

  // Chaque adresse n'apparaît qu'une fois, dans son premier tronçon.
  const sections = $derived.by(() => {
    if (!t) return [] as { seg: Segment; addrs: Addr[] }[];
    const seen = new Set<string>();
    return t.segments
      .map((seg) => ({
        seg,
        addrs: seg.addrIds.filter((id) => !seen.has(id) && seen.add(id)).map((id) => t!.addrs[id]).filter(Boolean),
      }))
      .filter((s) => s.addrs.length);
  });
  const allIds = $derived(sections.flatMap((s) => s.addrs.map((a) => a.id)));
  const count = $derived(allIds.filter((id) => checked.has(id)).length);
  const all = $derived(allIds.length > 0 && count === allIds.length);

  function persist() {
    if (!session) return;
    session.checked = [...checked];
    saveSession(session);
  }

  function toggle(id: string) {
    const n = new Set(checked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    checked = n;
    persist();
  }

  function toggleAll() {
    checked = all ? new Set() : new Set(allIds);
    persist();
  }

  function toggleSection(addrs: Addr[]) {
    const n = new Set(checked);
    const every = addrs.every((a) => n.has(a.id));
    for (const a of addrs) every ? n.delete(a.id) : n.add(a.id);
    checked = n;
    persist();
  }

  function start() {
    persist();
    go({ name: 'guide', tourneeId });
  }
</script>

<main class="screen prep">
  <div class="row">
    <button class="icon-btn" aria-label="Retour" onclick={() => history.back()}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <span class="spacer"></span>
    <button class="chip-btn" onclick={toggleAll}>{all ? 'Aucun' : 'Tout'}</button>
  </div>
  <div>
    <h1 class="title">Qui a du courrier ?</h1>
    <p class="sub">Touche les numéros à servir aujourd'hui.</p>
  </div>

  {#each sections as { seg, addrs }, i (seg.id)}
    <section class="card sec">
      <div class="row">
        <span class="ord cond">{i + 1}</span>
        <span class="grow"><Plaque text={seg.street} size="s" upper /></span>
        <button class="pill-btn" onclick={() => toggleSection(addrs)} aria-label="Tout cocher pour {seg.street}">
          <SidePill side={seg.side} />
        </button>
      </div>
      <div class="grid">
        {#each addrs as a (a.id)}
          {@const on = checked.has(a.id)}
          <button class="tile" class:on aria-pressed={on} onclick={() => toggle(a.id)}>{label(a)}</button>
        {/each}
      </div>
    </section>
  {:else}
    {#if t}<p class="sub">Cette tournée n'a encore aucune adresse.</p>{/if}
  {/each}

  <div class="go">
    <button class="btn btn-primary" onclick={start} disabled={!allIds.length}>
      {count === 0 ? 'Partir (toutes les adresses)' : count === 1 ? 'Partir avec 1 arrêt' : `Partir avec ${count} arrêts`}
    </button>
  </div>
</main>

<style>
  .prep {
    padding-bottom: calc(var(--safe-bottom) + 110px);
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
  .sec {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }
  .ord {
    width: 18px;
    font-weight: 500;
    font-size: 15px;
    color: var(--muted);
  }
  .grow {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .pill-btn {
    border: 0;
    background: none;
    padding: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .tile {
    height: 54px;
    border-radius: 9px;
    border: 2px solid var(--line-soft);
    background: var(--tile-off);
    color: var(--faint);
    font: 700 22px/1 var(--cond);
    padding: 0 2px;
    transition: transform 0.08s;
  }
  .tile:active {
    transform: scale(0.94);
  }
  .tile.on {
    border: 0;
    background: var(--email);
    color: #fff;
    box-shadow:
      inset 0 0 0 3px var(--email),
      inset 0 0 0 5px #fff;
  }
  .go {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 14px 20px calc(var(--safe-bottom) + 18px);
    background: linear-gradient(to bottom, rgba(232, 236, 239, 0), var(--ground) 30%);
    display: flex;
    justify-content: center;
  }
  .go .btn {
    width: 100%;
    max-width: 520px;
  }
</style>
