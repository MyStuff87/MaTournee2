export interface LL {
  lat: number;
  lon: number;
}

/** Point de trajet ; m = position placée à la main (« Je suis ici »). */
export interface RawPt extends LL {
  m?: 1;
}

export type Side = 'pair' | 'impair' | 'both';
export type Mode = 'pied' | 'velo' | 'voiture';

/** Une adresse de la Base Adresse Nationale. */
export interface Addr {
  id: string;
  num: number;
  rep: string; // "bis", "ter", "A"…
  street: string; // "Rue Victor Hugo"
  streetKey: string; // code INSEE + nom normalisé
  insee: string;
  city: string;
  lat: number;
  lon: number;
}

/** Ce que fait le facteur sur un tronçon ; « none » = simple passage. */
export type SegSide = Side | 'none';

export interface Segment {
  id: string;
  side: SegSide;
  /** tracé lissé et simplifié (lignes droites), dans le sens de passage */
  path?: LL[];
  /** positions lissées brutes, pour recalculer les adresses */
  raw?: RawPt[];
  /** adresses dans l'ordre de passage */
  addrIds: string[];
  /** rue principale (affichage) */
  streetKey: string;
  street: string;
  city: string;
  /** toutes les rues traversées en distribuant */
  streets?: string[];
  /** trace importée (GPX) : à découper automatiquement par rue au premier calcul */
  autoSplit?: boolean;
}

export interface Tournee {
  id: string;
  name: string;
  mode: Mode;
  createdAt: number;
  updatedAt: number;
  segments: Segment[];
  addrs: Record<string, Addr>;
  /** notes par adresse (id -> texte) */
  notes?: Record<string, string>;
  /** tracé enregistré */
  track: { lat: number; lon: number }[];
}

/** État d'une journée de distribution. */
export interface DaySession {
  key: string; // tourneeId + date
  tourneeId: string;
  date: string;
  checked: string[]; // adresses avec courrier
  done: string[]; // adresses livrées
  skipped?: string[]; // adresses passées sans livrer
}

export interface Fix {
  lat: number;
  lon: number;
  acc: number;
  t: number;
  speed?: number | null;
}

export interface Dot {
  lat: number;
  lon: number;
  kind: 'on' | 'off' | 'next' | 'done';
}
