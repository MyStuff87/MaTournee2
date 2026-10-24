<script lang="ts">
  // Carte IGN (Plan IGN), avec le tracé, des points d'adresse et la position.
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { onMount } from 'svelte';
  import type { LL } from '../lib/geo';
  import type { Dot } from '../lib/types';


  interface Props {
    position?: LL | null;
    track?: LL[];
    dots?: Dot[];
    follow?: boolean;
    fit?: boolean;
    zoom?: number;
  }
  let { position = null, track = [], dots = [], follow = true, fit = false, zoom = 18 }: Props = $props();

  let el: HTMLDivElement;
  let map: L.Map | undefined;
  let line: L.Polyline | undefined;
  let me: L.CircleMarker | undefined;
  let halo: L.CircleMarker | undefined;
  let dotLayer: L.LayerGroup | undefined;
  let userMoved = false;

  const STYLE: Record<Dot['kind'], L.CircleMarkerOptions> = {
    on: { radius: 6, color: '#1b4c9c', weight: 0, fillColor: '#1b4c9c', fillOpacity: 1 },
    off: { radius: 4, color: '#9aa6b5', weight: 0, fillColor: '#9aa6b5', fillOpacity: 0.9 },
    next: { radius: 9, color: '#15233f', weight: 3, fillColor: '#ffc20e', fillOpacity: 1 },
    done: { radius: 5, color: '#1f7a4d', weight: 0, fillColor: '#1f7a4d', fillOpacity: 0.8 },
  };

  onMount(() => {
    map = L.map(el, { zoomControl: false, attributionControl: false }).setView([46.6, 2.4], 6);
    L.control.attribution({ prefix: false, position: 'topleft' }).addTo(map);
    L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      { maxNativeZoom: 19, maxZoom: 20, attribution: '© IGN' },
    ).addTo(map);
    line = L.polyline([], { color: '#1b4c9c', weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    dotLayer = L.layerGroup().addTo(map);
    map.on('dragstart', () => (userMoved = true));
    const ro = new ResizeObserver(() => map?.invalidateSize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      map?.remove();
    };
  });

  $effect(() => {
    if (!map || !line) return;
    line.setLatLngs(track.map((p) => [p.lat, p.lon]));
  });

  $effect(() => {
    if (!map || !dotLayer) return;
    dotLayer.clearLayers();
    for (const d of dots) L.circleMarker([d.lat, d.lon], STYLE[d.kind]).addTo(dotLayer);
    if (fit && dots.length) {
      map.fitBounds(L.latLngBounds(dots.map((d) => [d.lat, d.lon] as [number, number])), { padding: [30, 30], maxZoom: 18 });
    }
  });

  $effect(() => {
    if (!map || !position) return;
    const ll: [number, number] = [position.lat, position.lon];
    if (!me) {
      halo = L.circleMarker(ll, { radius: 22, weight: 0, fillColor: '#1b4c9c', fillOpacity: 0.18 }).addTo(map);
      me = L.circleMarker(ll, { radius: 10, color: '#fff', weight: 4, fillColor: '#1b4c9c', fillOpacity: 1 }).addTo(map);
      if (!fit) map.setView(ll, zoom);
    } else {
      me.setLatLng(ll);
      halo!.setLatLng(ll);
      if (follow && !userMoved && !fit) map.panTo(ll, { animate: true });
    }
  });

  export function recenter() {
    userMoved = false;
    if (map && position) map.setView([position.lat, position.lon], Math.max(map.getZoom(), 17));
  }
</script>

<div class="map" bind:this={el}></div>

<style>
  .map {
    width: 100%;
    height: 100%;
  }
</style>
