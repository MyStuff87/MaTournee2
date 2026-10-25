# MaTournée

Appli de guidage de tournée pour facteur (à pied, à vélo ou en voiture).

- **Enregistrer** une tournée à vide : à chaque changement, on touche Pair, Impair,
  Les deux ou Rien ; un nouveau tronçon commence à cet endroit. La position GPS est
  lissée (filtre de Kalman) puis redressée en lignes droites, et les adresses
  officielles (Base Adresse Nationale) longées sont retrouvées automatiquement.
- **Préparer la journée** : on touche les numéros qui ont du courrier.
- **Guidage** : carte qui tourne façon GPS (MapLibre), lignes du côté distribué,
  position collée au parcours, avance automatique, rien à valider.
- **Où suis-je ?** : la rue et les numéros pair / impair autour de soi.

Tout reste sur le téléphone et fonctionne hors-ligne une fois les adresses chargées.

## Installer sur iPhone

Ouvrir https://mystuff87.github.io/MaTournee2/ dans **Safari**, bouton Partager,
puis « Sur l'écran d'accueil ».

## Essayer sans sortir

Ajouter `?demo` à l'adresse (et `&speed=10` pour accélérer) : un quartier fictif et
un GPS simulé.

## Développement

```
npm install
npm run dev
```

Svelte 5 + Vite, PWA (vite-plugin-pwa), cartes Plan IGN (MapLibre GL), adresses via
le WFS `BAN.DATA.GOUV:ban` de la Géoplateforme.
