<script lang="ts" module>
  export interface RouteProps {
    side: 'pair' | 'impair' | 'both' | 'none';
    off: number; // +1 droite, -1 gauche, 0 milieu
    state: 'done' | 'next' | 'later';
  }
  export interface StopPin {
    id: string;
    label: string;
    lat: number;
    lon: number;
    state: 'todo' | 'next' | 'done';
    note?: boolean;
  }
</script>

<script lang="ts">
  // Carte façon GPS (MapLibre) : tourne dans le sens de marche, lignes
  // décalées du côté distribué, numéros des arrêts.
  import { Map as MlMap, Marker, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import { onMount } from 'svelte';
  import type { LL } from '../lib/types';
  import { TILE_URL } from '../lib/tiles';

  setWorkerUrl(workerUrl);

  interface Props {
    routes: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteProps>;
    stops?: StopPin[];
    position?: LL | null;
    heading?: number | null;
    /** suivre la position en tournant la carte (sinon vue d'ensemble) */
    followMode?: boolean;
    zoom?: number;
    padBottom?: number;
    padTop?: number;
    onStopTap?: (id: string) => void;
  }
  let {
    routes,
    stops = [],
    position = null,
    heading = null,
    followMode = true,
    zoom = 18,
    padBottom = 0,
    padTop = 70,
    onStopTap,
  }: Props = $props();

  let el: HTMLDivElement;
  let map: MlMap | undefined = $state();
  let ready = $state(false);
  let following = $state(true);
  let me: Marker | undefined;
  let meEl: HTMLDivElement | undefined;
  const pins = new Map<string, { m: Marker; el: HTMLElement; key: string }>();
  let fittedOnce = false;
  let firstFix = true;

  const COLORS = {
    light: { pair: '#1b4c9c', impair: '#b84a12', both: '#15233f', none: '#7a8699', done: '#8b96a8' },
    dark: { pair: '#5b8de0', impair: '#e07a45', both: '#dfe6f2', none: '#7a8699', done: '#56627a' },
  };
  const isDark = () => document.documentElement.dataset.theme === 'dark';

  function sideColor(): unknown {
    const c = isDark() ? COLORS.dark : COLORS.light;
    return ['match', ['get', 'side'], 'pair', c.pair, 'impair', c.impair, 'both', c.both, c.none];
  }

  function applyTheme() {
    if (!map || !ready) return;
    const dark = isDark();
    map.setPaintProperty('ign', 'raster-brightness-min', dark ? 0.92 : 0);
    map.setPaintProperty('ign', 'raster-brightness-max', dark ? 0.1 : 1);
    map.setPaintProperty('ign', 'raster-hue-rotate', dark ? 180 : 0);
    map.setPaintProperty('ign', 'raster-saturation', dark ? -0.55 : 0);
    map.setPaintProperty('bg', 'background-color', dark ? '#172133' : '#dce2e7');
    for (const id of ['route-later', 'route-next']) map.setPaintProperty(id, 'line-color', sideColor() as never);
    map.setPaintProperty('route-done', 'line-color', dark ? COLORS.dark.done : COLORS.light.done);
  }

  const off = (px: number) => ['*', ['get', 'off'], px];
  const OFFSET = ['interpolate', ['linear'], ['zoom'], 14, off(1.5), 17, off(5), 19, off(12)];

  onMount(() => {
    map = new MlMap({
      container: el,
      style: {
        version: 8,
        sources: {
          ign: { type: 'raster', tiles: [TILE_URL], tileSize: 256, maxzoom: 19 },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#dce2e7' } },
          { id: 'ign', type: 'raster', source: 'ign' },
        ],
      },
      center: [2.4, 46.6],
      zoom: 5,
      attributionControl: false,
      pitchWithRotate: false,
      maxZoom: 20,
    });
    map.touchPitch.disable();
    const zoomClass = () => el.classList.toggle('far', map!.getZoom() < 17);
    map.on('zoom', zoomClass);
    zoomClass();
    map.on('load', () => {
      map!.addSource('route', { type: 'geojson', data: routes });
      map!.addLayer({
        id: 'route-done',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'state'], 'done'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLORS.light.done, 'line-width': 5, 'line-opacity': 0.75, 'line-offset': OFFSET as never },
      });
      map!.addLayer({
        id: 'route-later',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'state'], 'later'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': sideColor() as never, 'line-width': 5, 'line-opacity': 0.45, 'line-offset': OFFSET as never },
      });
      map!.addLayer({
        id: 'route-next',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'state'], 'next'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': sideColor() as never, 'line-width': 9, 'line-opacity': 1, 'line-offset': OFFSET as never },
      });
      ready = true;
      applyTheme();
      fitIfNeeded();
    });
    const stopFollow = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) following = false;
    };
    map.on('dragstart', stopFollow);
    map.on('rotatestart', stopFollow);
    map.on('zoomstart', stopFollow);
    const mo = new MutationObserver(applyTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const ro = new ResizeObserver(() => map?.resize());
    ro.observe(el);
    return () => {
      mo.disconnect();
      ro.disconnect();
      map?.remove();
    };
  });

  $effect(() => {
    const data = routes;
    if (!map || !ready) return;
    (map.getSource('route') as unknown as { setData: (d: unknown) => void })?.setData(data);
    fitIfNeeded();
  });

  function fitIfNeeded(force = false) {
    if (!map || !ready || (!force && (followMode || fittedOnce))) return;
    const b = new LngLatBounds();
    let n = 0;
    for (const f of routes.features)
      for (const c of f.geometry.coordinates) {
        b.extend(c as [number, number]);
        n++;
      }
    for (const s of stops) {
      b.extend([s.lon, s.lat]);
      n++;
    }
    if (!n) return;
    fittedOnce = true;
    map.fitBounds(b, { padding: { top: padTop, bottom: padBottom + 30, left: 30, right: 30 }, maxZoom: 18, duration: force ? 600 : 0, bearing: 0 });
  }

  /** Revenir à la vue d'ensemble de la tournée. */
  export function overview() {
    fitIfNeeded(true);
  }

  // Numéros des arrêts
  $effect(() => {
    if (!map) return;
    const keep = new Set<string>();
    for (const s of stops) {
      keep.add(s.id);
      const key = `${s.state}|${s.note ? 1 : 0}|${s.label}`;
      const cur = pins.get(s.id);
      if (cur && cur.key === key) continue;
      const cls = `mk ${s.state}${s.note ? ' has-note' : ''}`;
      if (cur) {
        cur.el.className = cls;
        cur.el.textContent = s.state === 'done' ? '' : s.label;
        cur.key = key;
        cur.el.style.zIndex = s.state === 'next' ? '3' : s.state === 'todo' ? '2' : '1';
        continue;
      }
      const pinEl = document.createElement('button');
      pinEl.className = cls;
      pinEl.textContent = s.state === 'done' ? '' : s.label;
      pinEl.setAttribute('aria-label', `Numéro ${s.label}`);
      pinEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onStopTap?.(s.id);
      });
      const m = new Marker({ element: pinEl, rotationAlignment: 'viewport' }).setLngLat([s.lon, s.lat]).addTo(map);
      pinEl.style.zIndex = s.state === 'next' ? '3' : s.state === 'todo' ? '2' : '1';
      pins.set(s.id, { m, el: pinEl, key });
    }
    for (const [id, p] of pins)
      if (!keep.has(id)) {
        p.m.remove();
        pins.delete(id);
      }
    fitIfNeeded();
  });

  // Passage en mode suivi : on se recadre sur la position, zoom compris.
  let wasFollow = followMode;
  $effect(() => {
    if (followMode && !wasFollow) {
      firstFix = true;
      following = true;
    }
    wasFollow = followMode;
  });

  // Position + caméra façon GPS
  $effect(() => {
    if (!map || !position) return;
    const ll: [number, number] = [position.lon, position.lat];
    if (!me) {
      meEl = document.createElement('div');
      meEl.className = 'me';
      meEl.innerHTML = '<span class="arrow"></span><span class="dot"></span>';
      me = new Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(ll).addTo(map);
    } else me.setLngLat(ll);
    me.setRotation(heading ?? 0);
    meEl!.classList.toggle('no-heading', heading === null);
    if (followMode && following) camera(ll, firstFix);
    firstFix = false;
  });

  function camera(ll: [number, number], jump: boolean) {
    if (!map) return;
    const opts = {
      center: ll,
      bearing: heading ?? map.getBearing(),
      padding: { top: padTop, bottom: padBottom, left: 0, right: 0 },
    };
    if (jump) map.jumpTo({ ...opts, zoom });
    else map.easeTo({ ...opts, duration: 950, easing: (t: number) => t });
  }

  export function recenter() {
    following = true;
    if (position && map) {
      map.easeTo({
        center: [position.lon, position.lat],
        bearing: heading ?? map.getBearing(),
        zoom: Math.max(map.getZoom(), zoom - 0.5),
        padding: { top: padTop, bottom: padBottom, left: 0, right: 0 },
        duration: 500,
      });
    }
  }

  function northUp() {
    map?.easeTo({ bearing: 0, duration: 400 });
  }
</script>

<div class="tmap" bind:this={el}></div>
<span class="attrib">© IGN</span>
{#if followMode && !following && position}
  <button class="recenter" onclick={recenter}>Recentrer</button>
{/if}
{#if !followMode}
  <button class="north icon-btn" aria-label="Nord en haut" onclick={northUp}>
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l5 11h-10z" fill="var(--impair)" /><path d="M12 22l-5-9h10z" fill="var(--faint)" /></svg>
  </button>
{/if}

<style>
  .tmap {
    position: absolute;
    inset: 0;
    background: var(--map);
  }
  .attrib {
    position: absolute;
    left: 6px;
    bottom: 2px;
    z-index: 5;
    font-size: 10px;
    color: var(--muted);
    background: color-mix(in srgb, var(--card) 70%, transparent);
    padding: 0 4px;
    border-radius: 3px;
    pointer-events: none;
  }
  .recenter {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: calc(var(--safe-top) + 70px);
    z-index: 20;
    height: 44px;
    padding: 0 18px;
    border: 0;
    border-radius: 999px;
    background: var(--solid);
    color: #fff;
    font: 700 18px var(--cond);
    box-shadow: 0 4px 14px rgba(21, 35, 63, 0.25);
  }
  .north {
    position: absolute;
    right: 10px;
    top: 10px;
    z-index: 5;
  }
  .tmap :global(.mk) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    height: 30px;
    padding: 0 6px;
    border: 0;
    border-radius: 7px;
    background: var(--email);
    color: #fff;
    font: 700 18px/1 var(--cond);
    box-shadow:
      inset 0 0 0 2px var(--email),
      inset 0 0 0 4px #fff,
      0 2px 6px rgba(21, 35, 63, 0.3);
    white-space: nowrap;
    cursor: pointer;
  }
  .tmap :global(.mk.next) {
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
  .tmap :global(.mk.done) {
    min-width: 10px;
    width: 10px;
    height: 10px;
    padding: 0;
    border-radius: 50%;
    background: #9aa6b5;
    box-shadow: 0 0 0 2px #fff;
  }
  .tmap:global(.far) :global(.mk.todo) {
    min-width: 12px;
    width: 12px;
    height: 12px;
    padding: 0;
    font-size: 0;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #fff;
  }
  .tmap :global(.mk.has-note)::after {
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
  .tmap :global(.me) {
    width: 64px;
    height: 64px;
    pointer-events: none;
  }
  .tmap :global(.me .dot) {
    position: absolute;
    left: 20px;
    top: 20px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--email);
    box-shadow:
      0 0 0 4px #fff,
      0 0 0 14px rgba(27, 76, 156, 0.2);
  }
  .tmap :global(.me .arrow) {
    position: absolute;
    left: 50%;
    top: -4px;
    transform: translateX(-50%);
    border-left: 12px solid transparent;
    border-right: 12px solid transparent;
    border-bottom: 20px solid var(--email);
  }
  .tmap :global(.me.no-heading .arrow) {
    display: none;
  }
</style>
