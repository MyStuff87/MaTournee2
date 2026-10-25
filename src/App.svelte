<script lang="ts">
  import { onMount } from 'svelte';
  import { app, initApp } from './lib/app.svelte';
  import { persist } from './lib/db';
  import Home from './screens/Home.svelte';
  import Record from './screens/Record.svelte';
  import Review from './screens/Review.svelte';
  import Prepare from './screens/Prepare.svelte';
  import Guide from './screens/Guide.svelte';
  import Libre from './screens/Libre.svelte';
  import Login from './screens/Login.svelte';
  import View from './screens/View.svelte';
  import Draw from './screens/Draw.svelte';
  import SegEdit from './screens/SegEdit.svelte';
  import { sessionValid } from './lib/auth';

  let ready = $state(false);
  let unlocked = $state(sessionValid());
  onMount(async () => {
    await initApp();
    persist();
    ready = true;
  });
  // Session expirée pendant que l'appli dormait : on redemande l'accès au retour.
  // (sauf pendant une tournée ou un enregistrement en cours)
  document.addEventListener('visibilitychange', () => {
    const busy = app.screen.name === 'guide' || app.screen.name === 'record';
    if (document.visibilityState === 'visible' && !busy && !sessionValid()) unlocked = false;
  });
</script>

{#if ready && !unlocked}
  <Login onDone={() => (unlocked = true)} />
{:else if ready}
  {#key app.screen}
    {#if app.screen.name === 'home'}
      <Home />
    {:else if app.screen.name === 'record'}
      <Record tourneeId={app.screen.tourneeId} />
    {:else if app.screen.name === 'review'}
      <Review tourneeId={app.screen.tourneeId} />
    {:else if app.screen.name === 'prepare'}
      <Prepare tourneeId={app.screen.tourneeId} />
    {:else if app.screen.name === 'guide'}
      <Guide tourneeId={app.screen.tourneeId} />
    {:else if app.screen.name === 'segedit'}
      <SegEdit tourneeId={app.screen.tourneeId} segId={app.screen.segId} />
    {:else if app.screen.name === 'draw'}
      <Draw tourneeId={app.screen.tourneeId} />
    {:else if app.screen.name === 'view'}
      <View tourneeId={app.screen.tourneeId} />
    {:else if app.screen.name === 'libre'}
      <Libre />
    {/if}
  {/key}
{/if}

{#if app.toast}
  <div class="toast" role="status">
    <span>{app.toast.text}</span>
    {#if app.toast.action}
      <button
        onclick={() => {
          app.toast?.action?.run();
          app.toast = null;
        }}>{app.toast.action.label}</button
      >
    {/if}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 14px;
    right: 14px;
    top: calc(env(safe-area-inset-top, 0px) + 10px);
    z-index: 2000;
    max-width: 540px;
    margin: 0 auto;
    background: var(--solid);
    color: #fff;
    border-radius: 16px;
    min-height: 54px;
    padding: 8px 8px 8px 18px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-weight: 500;
    font-size: 16px;
    box-shadow: 0 8px 24px rgba(21, 35, 63, 0.25);
    animation: drop 0.18s ease-out;
  }
  .toast span {
    flex: 1;
  }
  .toast button {
    border: 0;
    background: var(--yellow);
    color: var(--on-yellow);
    border-radius: 12px;
    height: 40px;
    padding: 0 14px;
    font: 700 18px var(--cond);
  }
  @keyframes drop {
    from {
      transform: translateY(-12px);
      opacity: 0;
    }
  }
</style>
