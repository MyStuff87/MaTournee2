// Position GPS (ou simulée en mode démo) et maintien de l'écran allumé.
import type { Fix } from './types';
import { isDemo, startDemoGPS } from './demo';
import { notePosition } from './theme';

export type GpsError = 'denied' | 'unavailable' | null;

export function watchGPS(onFix: (f: Fix) => void, onError: (e: GpsError) => void): () => void {
  if (isDemo()) {
    const speed = Number(new URLSearchParams(location.search).get('speed') || '1');
    return startDemoGPS(onFix, speed);
  }
  if (!('geolocation' in navigator)) {
    onError('unavailable');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      onError(null);
      notePosition(pos.coords.latitude, pos.coords.longitude);
      onFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        acc: pos.coords.accuracy,
        t: pos.timestamp,
        speed: pos.coords.speed,
      });
    },
    (err) => onError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

// --- Écran toujours allumé ---
let lock: any = null;
let wanted = false;

async function acquire() {
  try {
    lock = await (navigator as any).wakeLock?.request('screen');
  } catch {
    lock = null;
  }
}

function onVisible() {
  if (wanted && document.visibilityState === 'visible') acquire();
}

export function keepAwake(on: boolean) {
  wanted = on;
  if (on) {
    acquire();
    document.addEventListener('visibilitychange', onVisible);
  } else {
    document.removeEventListener('visibilitychange', onVisible);
    lock?.release?.().catch(() => {});
    lock = null;
  }
}
