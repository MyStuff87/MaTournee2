<script lang="ts">
  import { onMount } from 'svelte';
  import { checkInvite, checkLogin, createAccount, getLogin, hasAccount, wipeEverything } from '../lib/auth';
  import Plaque from '../components/Plaque.svelte';

  let { onDone }: { onDone: () => void } = $props();

  let mode = $state<'loading' | 'create' | 'login'>('loading');
  let login = $state('');
  let password = $state('');
  let confirm2 = $state('');
  let invite = $state('');
  let error = $state('');
  let busy = $state(false);
  let forgot = $state(false);
  let show = $state(false);

  onMount(async () => {
    mode = (await hasAccount()) ? 'login' : 'create';
    if (mode === 'login') login = (await getLogin()) ?? '';
  });

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!login.trim()) return (error = 'Indique ton identifiant.');
    if (mode === 'create') {
      if (!invite.trim()) return (error = "Indique le code d'invitation.");
      if (password.length < 6) return (error = 'Le mot de passe doit faire au moins 6 caractères.');
      if (password !== confirm2) return (error = 'Les deux mots de passe ne sont pas identiques.');
    }
    busy = true;
    try {
      if (mode === 'create') {
        if (!(await checkInvite(invite))) {
          error = "Code d'invitation incorrect.";
          return;
        }
        await createAccount(login, password);
        onDone();
      } else if (await checkLogin(login, password)) onDone();
      else error = 'Identifiant ou mot de passe incorrect.';
    } catch {
      error = "La connexion sécurisée n'est pas disponible sur ce navigateur.";
    } finally {
      busy = false;
    }
  }

  async function reset() {
    if (!confirm('Effacer toutes les tournées de ce téléphone et créer un nouvel accès ?')) return;
    await wipeEverything();
  }
</script>

<main class="screen login">
  <div class="brand">
    <Plaque text="MaTournée" size="l" upper />
    <p class="sub center">Le guide de ta tournée, rue par rue.</p>
  </div>

  {#if mode !== 'loading'}
    <form class="card form" onsubmit={submit}>
      <h1 class="h1">{mode === 'create' ? 'Crée ton accès' : 'Connexion'}</h1>
      {#if mode === 'create'}
        <p class="sub">L'appli est réservée : il faut un code d'invitation. Choisis ensuite ton identifiant et ton mot de passe.</p>
        <label class="field">
          <span>Code d'invitation</span>
          <input bind:value={invite} autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" />
        </label>
      {/if}

      <label class="field">
        <span>Identifiant</span>
        <input bind:value={login} autocomplete="username" autocapitalize="none" spellcheck="false" />
      </label>
      <label class="field">
        <span>Mot de passe</span>
        <span class="pw">
          <input
            bind:value={password}
            type={show ? 'text' : 'password'}
            autocomplete={mode === 'create' ? 'new-password' : 'current-password'}
          />
          <button type="button" class="eye" onclick={() => (show = !show)}>{show ? 'Masquer' : 'Voir'}</button>
        </span>
      </label>
      {#if mode === 'create'}
        <label class="field">
          <span>Confirme le mot de passe</span>
          <input bind:value={confirm2} type={show ? 'text' : 'password'} autocomplete="new-password" />
        </label>
      {/if}

      {#if error}<p class="err" role="alert">{error}</p>{/if}

      <button class="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Un instant…' : mode === 'create' ? "Créer l'accès" : 'Se connecter'}
      </button>
    </form>

    {#if mode === 'login'}
      {#if !forgot}
        <button class="link center" onclick={() => (forgot = true)}>Mot de passe oublié ?</button>
      {:else}
        <div class="card forgot">
          <p class="sub">
            Le mot de passe n'est enregistré nulle part : il ne peut pas être retrouvé. Tu peux repartir de zéro, mais
            les tournées de ce téléphone seront effacées. Si tu as une sauvegarde, tu pourras l'importer ensuite.
          </p>
          <button class="btn btn-ghost danger" onclick={reset}>Tout effacer et recommencer</button>
        </div>
      {/if}
    {/if}
  {/if}
</main>

<style>
  .login {
    justify-content: center;
    gap: 22px;
  }
  .brand {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 10px;
  }
  .center {
    text-align: center;
    align-self: center;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-radius: 24px;
    padding: 22px 20px;
  }
  .h1 {
    font: 700 30px/1.05 var(--cond);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-weight: 600;
    font-size: 15px;
  }
  .field input {
    height: 56px;
    border-radius: 16px;
    border: 2px solid var(--line);
    background: var(--card);
    padding: 0 16px;
    font: 500 18px var(--body);
    color: var(--ink);
    width: 100%;
  }
  .field input:focus {
    outline: none;
    border-color: var(--email);
  }
  .pw {
    position: relative;
    display: flex;
  }
  .pw input {
    padding-right: 90px;
  }
  .eye {
    position: absolute;
    right: 6px;
    top: 6px;
    height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: 12px;
    background: var(--ground);
    font-weight: 600;
    font-size: 14px;
  }
  .err {
    color: var(--danger);
    font-weight: 600;
  }
  .forgot {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .danger {
    color: var(--danger);
  }
</style>
