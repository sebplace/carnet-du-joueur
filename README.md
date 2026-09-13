# Carnet du Joueur

[English version](./README.en.md)

**➜ [Ouvrir l'application](https://sebplace.github.io/carnet-du-joueur/)** · installable sur téléphone, fonctionne ensuite hors ligne.

Carnet du Joueur est un carnet privé hors ligne pour noter, organiser et recouper tes informations de joueur dans Blood on the Clocktower.

> Projet de fan non officiel : Carnet du Joueur n’est pas affilié à The Pandemonium Institute, n’est pas approuvé par eux, et ne remplace ni le Conteur ni les règles officielles.

## Ce que fait l’application

- crée une table de 5 à 20 joueurs dans l’ordre des sièges, avec une feuille papier imprimable adaptée au nombre réel de joueurs ;
- enregistre déclarations, « 3 pour 3 », indices, notes, exécutions, votes, morts de nuit, infos différées et ce que toi tu as affirmé ;
- relie et visualise tes notes (sièges, table ronde, chronologie, graphe des liens, grille joueur-personnage, carte des contradictions) et permet la recherche ;
- fonctionne localement dans le navigateur et peut être installée comme PWA.

## Ce qu’elle ne fait pas

- elle ne lit pas le Grimoire du Conteur et ne connaît aucun secret ;
- elle ne simule pas toutes les capacités, le poison, l’ivresse, les jinxes, les changements de rôle ou les décisions du Conteur ;
- elle ne dit pas qui ment, ne rend aucun verdict de règles et ne certifie pas qu’un monde est légal ;
- elle ne synchronise pas les scripts externes et ne redistribue pas d’assets officiels ;
- elle n’envoie aucune donnée vers un serveur ou un modèle d’IA.

## Lancer en local

Il n’y a aucune bibliothèque tierce et rien à installer dans le projet. Il faut seulement Node.js 20 ou plus récent pour lancer le petit serveur local fourni :

```bash
npm start
```

Ouvre ensuite <http://127.0.0.1:8794>.

N’ouvre pas `index.html` directement avec une URL `file://` : l’application utilise des modules ES et un service worker, qui ont besoin d’une origine HTTP locale ou HTTPS. N’importe quel serveur statique convient ; `npm start` n’est qu’un raccourci pratique autour du serveur Node inclus.

## Hors ligne et installation

Après une première ouverture depuis l’adresse locale ou une adresse HTTPS, le service worker peut mettre l’application en cache. L’état du cache est visible dans les réglages. Installe-la depuis le menu de ton navigateur ; sur iOS/Safari, utilise Partager → Ajouter à l’écran d’accueil.

## Confidentialité

Tout reste dans le stockage local du navigateur. Il n’y a ni compte, ni télémétrie, ni envoi réseau volontaire de tes notes. Les exports sont des fichiers JSON en clair : traite-les comme des notes privées, protège ton appareil et ne les partage pas pendant une partie.

## À montrer à ta table

Tu peux lire ceci tel quel avant la partie :

> J’utilise un carnet privé, comme une feuille de papier. Il ne lit rien du Conteur ni du Grimoire, n’utilise pas d’IA, n’envoie rien sur Internet et ne rend aucun verdict de règles. Si la table préfère que je joue sans téléphone, je le range.

## Captures d’écran à ajouter

<!-- TODO screenshots: écran de création de partie ; saisie rapide d'une déclaration ; relevé de votes ; vue Enquête ; écran de confidentialité et sauvegardes ; installation PWA. -->

## Licence

Le fichier [LICENSE](./LICENSE) indique l’état actuel : le code source et le contenu original du projet sont sous licence Creative Commons Attribution - Pas d’Utilisation Commerciale - Partage dans les Mêmes Conditions 4.0 International (CC BY-NC-SA 4.0). Les droits de Blood on the Clocktower, de ses personnages, scripts, marques, illustrations et textes officiels restent à The Pandemonium Institute et à leurs titulaires.

**Note licence en réflexion :** CC BY-NC-SA 4.0 est peu adaptée au code source. Une séparation future entre licence du code et licence du contenu est envisagée, sans modifier la licence actuelle dans ce document.
