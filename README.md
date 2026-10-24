# MaTournée

Appli de guidage de tournée pour facteur (à pied, à vélo ou en voiture).

- **Enregistrer** une tournée à vide : en entrant dans une rue, on choisit le côté
  (pair, impair ou les deux). Les adresses officielles (Base Adresse Nationale)
  devant lesquelles on passe sont ajoutées automatiquement. « Fin du tronçon »
  permet de ne faire qu'un bout de rue et de revenir faire la suite plus tard.
- **Préparer la journée** : on touche les numéros qui ont du courrier.
- **Guidage** : le prochain arrêt en très grand, les suivants, « Livré » / « Passer »,
  avec avance automatique quand on passe devant.
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

Svelte 5 + Vite, PWA (vite-plugin-pwa), cartes Plan IGN (Leaflet), adresses via
le WFS `BAN.DATA.GOUV:ban` de la Géoplateforme.
