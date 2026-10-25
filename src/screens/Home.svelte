<script lang="ts">
  import { onMount } from 'svelte';
  import { app, go, setCurrent, toast } from '../lib/app.svelte';
  import { listTournees } from '../lib/db';
  import { exportTournees, importFile } from '../lib/backup';
  import { logout } from '../lib/auth';
  import type { Tournee } from '../lib/types';
  import Plaque from '../components/Plaque.svelte';

  let tournees = $state<Tournee[]>([]);
  let loaded = $state(false);
  let picking = $state(false);
  let fileInput: HTMLInputElement;

  const current = $derived(tournees.find((t) => t.id === app.currentTourneeId) ?? tournees[0]);
  const others = $derived(tournees.filter((t) => t !== current));

  const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const hello = new Date().getHours() >= 18 ? 'Bonsoir' : 'Bonjour';

  const modeLabel = { pied: 'À pied', velo: 'Vélo', voiture: 'Voiture' };
  const stats = (t: Tournee) => ({
    addrs: new Set(t.segments.flatMap((s) => s.addrIds)).size,
    rues: new Set(t.segments.map((s) => s.streetKey)).size,
  });

  async function refresh() {
    tournees = await listTournees();
    loaded = true;
  }
  onMount(refresh);

  function choose(t: Tournee) {
    setCurrent(t.id);
    picking = false;
  }

  async function onImport(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const n = await importFile(f);
      toast(n ? `${n} tournée${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}` : 'Aucune tournée dans ce fichier');
      refresh();
    } catch {
      toast("Ce fichier n'est pas une sauvegarde MaTournée");
    }
    fileInput.value = '';
  }

  function splitName(name: string) {
    const m = name.match(/^(tourn[ée]e\s*\d+)[\s,–-]+(.+)$/i);
    return m ? { main: m[1], sub: m[2] } : { main: name, sub: undefined };
  }
</script>

<main class="screen">
  <header class="hello">
    <p class="sub date">{dateLabel}</p>
    <h1 class="title">{hello}</h1>
  </header>

  {#if loaded && current}
    {@const s = stats(current)}
    {@const n = splitName(current.name)}
    <section class="card hero">
      <div class="row">
        <p class="sub">Ta tournée</p>
        <span class="spacer"></span>
        {#if tournees.length > 1}
          <button class="link" onclick={() => (picking = !picking)}>{picking ? 'Fermer' : 'Changer'}</button>
        {/if}
      </div>
      {#if picking}
        <div class="pick">
          {#each tournees as t (t.id)}
            <button class="pick-row" class:sel={t === current} onclick={() => choose(t)}>
              <span>{t.name}</span><span class="sub">{stats(t).addrs} adr.</span>
            </button>
          {/each}
        </div>
      {:else}
        <Plaque text={n.main} sub={n.sub} size="l" upper />
        <div class="stats">
          <div><span class="big cond">{s.addrs}</span><span class="sub">adresses</span></div>
          <div><span class="big cond">{s.rues}</span><span class="sub">rues</span></div>
          <div><span class="big cond">{modeLabel[current.mode]}</span><span class="sub">mode</span></div>
        </div>
        <button class="btn btn-primary" onclick={() => go({ name: 'prepare', tourneeId: current.id })}>Préparer la journée</button>
        <button class="link edit" onclick={() => go({ name: 'review', tourneeId: current.id })}>Voir et modifier la tournée</button>
      {/if}
    </section>
  {:else if loaded}
    <section class="card hero empty">
      <h2 class="cond h2">Enregistre ta première tournée</h2>
      <p class="sub">
        Fais ta tournée une fois à vide avec l'appli ouverte. À chaque rue, tu indiques le côté que tu
        fais ; les adresses se remplissent toutes seules.
      </p>
      <button class="btn btn-primary" onclick={() => go({ name: 'record' })}>Commencer l'enregistrement</button>
    </section>
  {/if}

  <div class="tiles">
    <button class="tile" onclick={() => go({ name: 'libre' })}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--email)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
      <span class="tile-t">
        <span class="cond tile-h">Où suis-je ?</span>
        <span class="sub small">L'adresse devant toi</span>
      </span>
    </button>
    <button class="tile" onclick={() => go({ name: 'record' })}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--impair)" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" fill="var(--impair)" /></svg>
      <span class="tile-t">
        <span class="cond tile-h">Enregistrer</span>
        <span class="sub small">Une tournée à vide</span>
      </span>
    </button>
  </div>

  {#if others.length}
    <section class="list">
      <h2 class="sub small list-h">Mes autres tournées</h2>
      {#each others as t (t.id)}
        <button class="list-row" onclick={() => choose(t)}>
          <span class="name">{t.name}</span>
          <span class="sub small">{stats(t).addrs} adr.</span>
        </button>
      {/each}
    </section>
  {/if}

  <footer class="foot">
    {#if tournees.length}
      <button class="link" onclick={() => exportTournees()}>Sauvegarder mes tournées</button>
    {/if}
    <button class="link" onclick={() => fileInput.click()}>Importer une tournée</button>
    <button class="link" onclick={() => { logout(); location.reload(); }}>Se déconnecter</button>
    <input bind:this={fileInput} type="file" accept=".json,application/json" class="sr-only" onchange={onImport} />
  </footer>
</main>

<style>
  .hello {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 6px;
  }
  .date::first-letter {
    text-transform: uppercase;
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: 16px;
    border-radius: 24px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .stats div {
    display: flex;
    flex-direction: column;
  }
  .big {
    font-weight: 700;
    font-size: 30px;
    line-height: 1;
  }
  .small {
    font-size: 14px;
  }
  .edit {
    align-self: center;
    margin-top: -6px;
  }
  .empty .h2 {
    font-weight: 700;
    font-size: 28px;
    line-height: 1.1;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pick-row,
  .list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 60px;
    padding: 0 18px;
    border-radius: 16px;
    border: 0;
    background: var(--card);
    text-align: left;
    font-weight: 600;
    font-size: 17px;
  }
  .pick-row {
    background: var(--ground);
    border: 2px solid transparent;
  }
  .pick-row.sel {
    border-color: var(--email);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .tile {
    background: var(--card);
    border: 0;
    border-radius: 22px;
    padding: 18px;
    height: 150px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    text-align: left;
  }
  .tile:active {
    transform: scale(0.98);
  }
  .tile-t {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tile-h {
    font-weight: 700;
    font-size: 24px;
    line-height: 1.05;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .list-h {
    margin-left: 4px;
    font-weight: 500;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .foot {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 22px;
  }
</style>
