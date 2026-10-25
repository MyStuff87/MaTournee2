// Lissage de la position GPS : filtre de Kalman à vitesse constante.
// Il gomme le zigzag du GPS tout en suivant les vrais changements de direction.
import type { Fix, Mode } from './types';
import { xy, offsetLL, type LL } from './geo';

class Axis {
  p = 0; // position (m)
  v = 0; // vitesse (m/s)
  P = [
    [100, 0],
    [0, 10],
  ];
  constructor(private q: number) {}

  init(p: number) {
    this.p = p;
    this.v = 0;
    this.P = [
      [100, 0],
      [0, 10],
    ];
  }

  step(z: number, r: number, dt: number) {
    // prédiction
    this.p += this.v * dt;
    const [[a, b], [c, d]] = this.P;
    const q = this.q;
    const dt2 = dt * dt;
    let P00 = a + dt * (c + b) + dt2 * d + (q * dt2 * dt2) / 4;
    let P01 = b + dt * d + (q * dt2 * dt) / 2;
    let P10 = c + dt * d + (q * dt2 * dt) / 2;
    let P11 = d + q * dt2;
    // correction
    const S = P00 + r;
    const K0 = P00 / S;
    const K1 = P10 / S;
    const y = z - this.p;
    this.p += K0 * y;
    this.v += K1 * y;
    P11 -= K1 * P01;
    P10 -= K1 * P00;
    P01 -= K0 * P01;
    P00 -= K0 * P00;
    this.P = [
      [P00, P01],
      [P10, P11],
    ];
  }
}

const ACCEL: Record<Mode, number> = { pied: 0.6, velo: 1.5, voiture: 3 };

export class PositionFilter {
  private origin: LL | null = null;
  private x: Axis;
  private y: Axis;
  private t = 0;

  constructor(mode: Mode) {
    const q = ACCEL[mode] ** 2;
    this.x = new Axis(q);
    this.y = new Axis(q);
  }

  /** Repart d'une position connue (posée à la main). */
  reset(p: LL) {
    this.origin = { lat: p.lat, lon: p.lon };
    this.x.init(0);
    this.y.init(0);
  }

  update(f: Fix): LL {
    if (!this.origin) {
      this.origin = { lat: f.lat, lon: f.lon };
      this.x.init(0);
      this.y.init(0);
      this.t = f.t;
      return { lat: f.lat, lon: f.lon };
    }
    const [mx, my] = xy(f, this.origin);
    const dt = Math.min(10, Math.max(0.2, (f.t - this.t) / 1000));
    this.t = f.t;
    // Après une longue coupure, on repart de la mesure.
    if (dt >= 10) {
      this.x.init(mx);
      this.y.init(my);
    } else {
      const r = Math.max(9, f.acc * f.acc);
      this.x.step(mx, r, dt);
      this.y.step(my, r, dt);
    }
    return offsetLL(this.origin, this.x.p, this.y.p);
  }

  /** Vitesse estimée (m/s). */
  get speed() {
    return Math.hypot(this.x.v, this.y.v);
  }

  /** Cap estimé d'après la vitesse (null à l'arrêt). */
  get heading(): number | null {
    if (this.speed < 0.5) return null;
    return ((Math.atan2(this.x.v, this.y.v) * 180) / Math.PI + 360) % 360;
  }
}
