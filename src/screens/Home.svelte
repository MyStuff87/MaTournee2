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
  let fileInput: HTMLInputElement;

  const current = $derived(tournees.find((t) => t.id === app.currentTourneeId) ?? tournees[0]);
  // La dernière tournée utilisée en premier, puis les autres.
  const ordered = $derived(current ? [current, ...tournees.filter((t) => t !== current)] : tournees);

  function start(t: Tournee) {
    setCurrent(t.id);
    go({ name: 'prepare', tourneeId: t.id });
  }

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

</script>

<main class="screen">
  <header class="hello">
    <p class="sub date">{dateLabel}</p>
    <h1 class="title">{hello}</h1>
  </header>

  {#if loaded && tournees.length}
    <section class="list" aria-label="Mes tournées">
      <h2 class="list-h cond">{tournees.length > 1 ? 'Choisis ta tournée' : 'Ta tournée'}</h2>
      {#each ordered as t (t.id)}
        {@const s = stats(t)}
        <article class="card tcard" class:last={t.id === current?.id && tournees.length > 1}>
          <Plaque text={t.name} size="s" upper />
          <p class="sub meta">{s.addrs} adresses, {s.rues} rue{s.rues > 1 ? 's' : ''}, {modeLabel[t.mode].toLowerCase()}</p>
          <div class="row">
            <button class="btn btn-primary grow" onclick={() => start(t)}>Préparer la journée</button>
            <button class="btn btn-ghost edit" aria-label="Modifier {t.name}" onclick={() => { setCurrent(t.id); go({ name: 'review', tourneeId: t.id }); }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
            </button>
          </div>
        </article>
      {/each}
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
        <span class="sub small">Une nouvelle tournée</span>
      </span>
    </button>
  </div>

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
    font-weight: 700;
    font-size: 24px;
  }
  .tcard {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border: 3px solid transparent;
  }
  .tcard.last {
    border-color: var(--yellow);
  }
  .meta {
    font-size: 15px;
  }
  .grow {
    flex: 1;
  }
  .edit {
    width: 66px;
    min-height: 66px;
    padding: 0;
    border-radius: 20px;
    flex: none;
  }
  .foot {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 22px;
  }
</style>
