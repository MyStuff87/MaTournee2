<script lang="ts">
  // Carte de guidage : chemin fait / à faire, arrêts numérotés, position et direction.
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { onMount } from 'svelte';
  import type { LL } from '../lib/geo';
  import { label } from '../lib/addressIndex';
  import type { Addr } from '../lib/types';
  import { TILE_URL } from '../lib/tiles';

  interface Props {
    track: LL[];
    trackIdx: number;
    aheadIdx: number;
    stops: Addr[];
    done: Set<string>;
    nextId: string | null;
    position: LL | null;
    heading: number | null;
    /** marge basse (px) cachée par la carte d'info, pour bien placer la position */
    bottomInset?: number;
    notes?: Record<string, string>;
    onStopTap?: (a: Addr) => void;
  }
  let { track, trackIdx, aheadIdx, stops, done, nextId, position, heading, bottomInset = 0, notes = {}, onStopTap }: Props = $props();

  let el: HTMLDivElement;
  let map: L.Map | undefined = $state();
  let lineDone: L.Polyline, lineSoon: L.Polyline, lineLater: L.Polyline;
  let me: L.Marker | undefined;
  const markers = new Map<string, { m: L.Marker; state: string }>();
  let follow = $state(true);
  let fitted = false;

  onMount(() => {
    map = L.map(el, { zoomControl: false, attributionControl: false }).setView([46.6, 2.4], 6);
    L.control.attribution({ prefix: false, position: 'topleft' }).addTo(map);
    L.tileLayer(
      TILE_URL,
      { maxNativeZoom: 19, maxZoom: 20, attribution: '© IGN' },
    ).addTo(map);
    lineLater = L.polyline([], { color: '#1b4c9c', weight: 5, opacity: 0.35, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    lineDone = L.polyline([], { color: '#7a8699', weight: 5, opacity: 0.55, lineCap: 'round', lineJoin: 'round', dashArray: '1 9' }).addTo(map);
    lineSoon = L.polyline([], { color: '#1b4c9c', weight: 8, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    const setZoomClass = () => el.classList.toggle('far', map!.getZoom() < 17);
    map.on('zoomend', setZoomClass);
    setZoomClass();
    map.on('dragstart', () => (follow = false));
    const ro = new ResizeObserver(() => map?.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      map?.remove();
    };
  });

  // Chemin : déjà fait (pointillé gris), les prochaines centaines de mètres (bleu fort), la suite (bleu pâle).
  $effect(() => {
    if (!map) return;
    const ll = (p: LL) => [p.lat, p.lon] as [number, number];
    lineDone.setLatLngs(track.slice(0, trackIdx + 1).map(ll));
    lineSoon.setLatLngs(track.slice(trackIdx, aheadIdx + 1).map(ll));
    lineLater.setLatLngs(track.slice(aheadIdx).map(ll));
  });

  function iconFor(a: Addr, state: string) {
    const [base, flag] = state.split('+');
    const txt = base === 'done' ? '' : label(a);
    return L.divIcon({
      className: '',
      html: `<span class="mk ${base}${flag ? ' has-note' : ''}">${txt}</span>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  $effect(() => {
    if (!map) return;
    const keep = new Set<string>();
    for (const a of stops) {
      keep.add(a.id);
      const state = (a.id === nextId ? 'next' : done.has(a.id) ? 'done' : 'todo') + (notes[a.id] ? '+n' : '');
      const cur = markers.get(a.id);
      if (!cur) {
        const m = L.marker([a.lat, a.lon], { icon: iconFor(a, state), zIndexOffset: state.startsWith('next') ? 1000 : 0 })
          .on('click', () => onStopTap?.(a))
          .addTo(map);
        markers.set(a.id, { m, state });
      } else if (cur.state !== state) {
        cur.m.setIcon(iconFor(a, state));
        cur.m.setZIndexOffset(state.startsWith('next') ? 1000 : state.startsWith('todo') ? 100 : 0);
        cur.state = state;
      }
    }
    for (const [id, { m }] of markers) if (!keep.has(id)) (m.remove(), markers.delete(id));
    if (!fitted && stops.length && !position) {
      map.fitBounds(L.latLngBounds(stops.map((a) => [a.lat, a.lon] as [number, number])), { padding: [40, 40] });
    }
  });

  $effect(() => {
    if (!map || !position) return;
    const ll: [number, number] = [position.lat, position.lon];
    const html = `<span class="me"><span class="arrow" style="transform: rotate(${heading ?? 0}deg); opacity: ${heading === null ? 0 : 1}"></span><span class="dot"></span></span>`;
    const icon = L.divIcon({ className: '', html, iconSize: [64, 64], iconAnchor: [32, 32] });
    if (!me) me = L.marker(ll, { icon, interactive: false, zIndexOffset: 2000 }).addTo(map);
    else {
      me.setLatLng(ll);
      me.setIcon(icon);
    }
    if (!fitted) {
      fitted = true;
      map.setView(ll, 18, { animate: false });
    }
    if (follow) centerOn(ll);
  });

  function centerOn(ll: [number, number]) {
    if (!map) return;
    // Décale la carte pour que la position soit au-dessus de la carte d'info.
    const z = map.getZoom();
    const pt = map.project(ll, z).add([0, bottomInset / 2]);
    map.panTo(map.unproject(pt, z), { animate: true, duration: 0.6 });
  }

  export function recenter() {
    follow = true;
    if (map && position) {
      if (map.getZoom() < 17) map.setZoom(18, { animate: false });
      centerOn([position.lat, position.lon]);
    }
  }

  export function isFollowing() {
    return follow;
  }
</script>

<div class="gmap" bind:this={el}></div>
{#if !follow && position}
  <button class="recenter" onclick={recenter}>Recentrer</button>
{/if}

<style>
  .gmap {
    position: absolute;
    inset: 0;
  }
  .recenter {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: calc(var(--safe-top) + 70px);
    z-index: 1000;
    height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--solid);
    color: #fff;
    font: 700 18px var(--cond);
    box-shadow: 0 4px 14px rgba(21, 35, 63, 0.25);
  }
  .gmap :global(.mk) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    min-width: 34px;
    height: 30px;
    padding: 0 6px;
    border-radius: 7px;
    background: var(--email);
    color: #fff;
    font: 700 18px/1 var(--cond);
    box-shadow:
      inset 0 0 0 2px var(--email),
      inset 0 0 0 4px #fff,
      0 2px 6px rgba(21, 35, 63, 0.3);
    white-space: nowrap;
  }
  .gmap :global(.mk.next) {
    min-width: 50px;
    height: 44px;
    font-size: 26px;
    background: var(--yellow);
    color: var(--on-yellow);
    box-shadow:
      inset 0 0 0 3px var(--on-yellow),
      0 3px 10px rgba(21, 35, 63, 0.4);
    border-radius: 10px;
  }
  .gmap :global(.mk.has-note)::after {
    content: '';
    position: absolute;
    right: -5px;
    top: -5px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--yellow);
    box-shadow: 0 0 0 2px var(--on-yellow);
  }
  .gmap :global(.mk) {
    position: relative;
  }
  .gmap :global(.mk.done) {
    min-width: 10px;
    width: 10px;
    height: 10px;
    padding: 0;
    border-radius: 50%;
    background: #9aa6b5;
    box-shadow: 0 0 0 2px #fff;
  }
  .gmap:global(.far) :global(.mk.todo) {
    min-width: 12px;
    width: 12px;
    height: 12px;
    padding: 0;
    font-size: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #fff;
  }
  .gmap :global(.me) {
    position: relative;
    display: block;
    width: 64px;
    height: 64px;
  }
  .gmap :global(.me .dot) {
    position: absolute;
    left: 20px;
    top: 20px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--email);
    box-shadow:
      0 0 0 4px #fff,
      0 0 0 14px rgba(27, 76, 156, 0.18);
  }
  .gmap :global(.me .arrow) {
    position: absolute;
    inset: 0;
    transition: transform 0.4s;
  }
  .gmap :global(.me .arrow::before) {
    content: '';
    position: absolute;
    left: 50%;
    top: -2px;
    transform: translateX(-50%);
    border-left: 11px solid transparent;
    border-right: 11px solid transparent;
    border-bottom: 18px solid var(--email);
  }
</style>
