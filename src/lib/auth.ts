// Accès à l'appli par identifiant / mot de passe.
// Le mot de passe n'est jamais stocké : seule une empreinte (PBKDF2-SHA256,
// sel aléatoire) est gardée sur le téléphone.
import { getKV, setKV } from './db';

interface Account {
  login: string;
  salt: string; // base64
  hash: string; // base64
  iter: number;
}

const SESSION_KEY = 'matournee-session';

// Code d'invitation, obligatoire pour créer un accès. Seule son empreinte est ici :
// le code lui-même n'apparaît nulle part dans le code source.
const INVITE = { salt: '4h2g4lEma8HvLY8zxZq2pg==', hash: 'Bo9NfUmrgmA8wFyGsp+BmURiwe4NOus3SOcTlKtoNT4=', iter: 210000 };
const SESSION_HOURS = 14; // une journée de travail

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return b64(bits);
}

const norm = (login: string) => login.trim().toLowerCase();

export async function hasAccount(): Promise<boolean> {
  return !!(await getKV<Account>('account'));
}

export async function getLogin(): Promise<string | null> {
  return (await getKV<Account>('account'))?.login ?? null;
}

/** Vérifie le code d'invitation (espaces, tirets et majuscules ignorés). */
export async function checkInvite(code: string): Promise<boolean> {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 8) return false;
  return (await derive(clean, unb64(INVITE.salt), INVITE.iter)) === INVITE.hash;
}

export async function createAccount(login: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 210000;
  const hash = await derive(password, salt, iter);
  await setKV<Account>('account', { login: norm(login), salt: b64(salt), hash, iter });
  openSession();
}

export async function checkLogin(login: string, password: string): Promise<boolean> {
  const acc = await getKV<Account>('account');
  if (!acc || acc.login !== norm(login)) return false;
  const hash = await derive(password, unb64(acc.salt), acc.iter);
  if (hash !== acc.hash) return false;
  openSession();
  return true;
}

function openSession() {
  try {
    localStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_HOURS * 3600 * 1000));
  } catch {
    /* rien */
  }
}

export function sessionValid(): boolean {
  try {
    return Number(localStorage.getItem(SESSION_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

export function logout() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* rien */
  }
}

/** Mot de passe oublié : tout effacer pour repartir de zéro. */
export async function wipeEverything() {
  logout();
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase('matournee');
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
  location.reload();
}
