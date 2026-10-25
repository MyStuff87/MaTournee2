// Heures de lever / coucher du soleil (algorithme de SunCalc, simplifié).
const rad = Math.PI / 180;
const DAY = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397;

const toDays = (d: Date) => d.valueOf() / DAY - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY);
const solarMeanAnomaly = (d: number) => rad * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M: number) =>
  M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
const declination = (l: number) => Math.asin(Math.sin(e) * Math.sin(l));

/** Lever et coucher du soleil pour la date et le lieu (null en cas de jour / nuit polaire). */
export function sunTimes(date: Date, lat: number, lon: number): { rise: Date; set: Date } | null {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h0 = -0.833 * rad; // bord du soleil à l'horizon
  const cosw = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosw < -1 || cosw > 1) return null;
  const w = Math.acos(cosw);
  const a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { rise: fromJulian(Jrise), set: fromJulian(Jset) };
}

/** Fait-il nuit ici et maintenant ? (avec 20 min de marge de crépuscule) */
export function isNight(lat: number, lon: number, now = new Date()): boolean {
  const t = sunTimes(now, lat, lon);
  if (!t) return now.getMonth() >= 9 || now.getMonth() <= 2; // cas polaire : grossier
  const margin = 20 * 60000;
  return now.valueOf() < t.rise.valueOf() - margin || now.valueOf() > t.set.valueOf() + margin;
}
