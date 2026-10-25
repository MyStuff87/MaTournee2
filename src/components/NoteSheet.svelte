<script lang="ts">
  // Fenêtre du bas pour lire / écrire la note d'une adresse.
  import type { Addr } from '../lib/types';
  import { label } from '../lib/addressIndex';
  import Plaque from './Plaque.svelte';

  interface Props {
    addr: Addr;
    note: string;
    onSave: (text: string) => void;
    onClose: () => void;
    action?: { label: string; run: () => void } | null;
  }
  let { addr, note, onSave, onClose, action = null }: Props = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(note);
  const QUICK = ['Chien', 'Boîte au fond de la cour', 'Code portail : ', 'Boîte cassée', 'Sonner', 'Déposer chez le voisin'];

  function addQuick(q: string) {
    text = text.trim() ? `${text.trim()}. ${q}` : q;
  }
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Adresse {label(addr)} {addr.street}">
  <div class="head">
    <span class="num"><Plaque text={label(addr)} size="chip" /></span>
    <p class="street cond">{addr.street}</p>
    <button class="icon-btn close" aria-label="Fermer" onclick={onClose}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>

  {#if action}
    <button class="btn btn-ghost" onclick={action.run}>{action.label}</button>
  {/if}

  <label class="lab" for="note-text">Note pour cette adresse</label>
  <textarea id="note-text" bind:value={text} rows="3" maxlength="240" placeholder="Ex. : boîte au fond de la cour, chien…"></textarea>
  <div class="quick">
    {#each QUICK as q (q)}
      <button type="button" onclick={() => addQuick(q)}>{q.replace(/ : $/, '')}</button>
    {/each}
  </div>
  <div class="row">
    {#if note}
      <button class="btn btn-ghost danger" onclick={() => onSave('')}>Effacer</button>
    {/if}
    <button class="btn btn-primary grow" onclick={() => onSave(text.trim())}>Enregistrer la note</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(8, 14, 26, 0.45);
    z-index: 3000;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 3001;
    max-width: 560px;
    margin: 0 auto;
    background: var(--card);
    border-radius: 26px 26px 0 0;
    padding: 18px 18px calc(var(--safe-bottom) + 18px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    animation: up 0.18s ease-out;
  }
  @keyframes up {
    from {
      transform: translateY(30px);
      opacity: 0;
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .street {
    flex: 1;
    font-weight: 700;
    font-size: 24px;
    line-height: 1.05;
  }
  .close {
    background: var(--ground);
  }
  .lab {
    font-weight: 600;
    font-size: 15px;
  }
  textarea {
    width: 100%;
    border-radius: 14px;
    border: 2px solid var(--line);
    background: var(--card);
    color: var(--ink);
    padding: 12px 14px;
    font: 500 17px/1.4 var(--body);
    resize: none;
  }
  textarea:focus {
    outline: none;
    border-color: var(--email);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .quick button {
    height: 36px;
    padding: 0 12px;
    border-radius: 999px;
    border: 0;
    background: var(--note);
    color: var(--note-ink);
    font-weight: 600;
    font-size: 14px;
  }
  .grow {
    flex: 1;
  }
  .danger {
    color: var(--danger);
  }
</style>
