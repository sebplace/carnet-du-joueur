# Changelog

All notable changes to Carnet du Joueur are recorded here.

## 1.5.0

### Sécurité des données et sauvegardes
- Un enregistrement trop volumineux pour être rouvert est refusé avant l’écriture, au lieu de produire un carnet illisible.
- La restauration d’un carnet exporté accepte désormais tout fichier que le format lui-même accepte, sans plafond arbitraire plus strict.
- Les copies de secours ne tournent qu’après un enregistrement réussi, et une rotation qui ne ferait que dupliquer le carnet actuel est ignorée.
- L’annulation ne consomme plus son étape d’historique tant que l’enregistrement n’a pas réussi, et refuse quand l’état enregistré a divergé, au lieu de fabriquer un état qui n’a jamais existé.
- Les prénoms sont mesurés après normalisation Unicode NFC : un nom décomposé n’est plus refusé à tort.
- Archiver puis restaurer ton propre siège préserve quel siège est « moi » et le personnage qui t’avait été montré au départ.

### Fiches et import
- La fiche du Bone Collector indique désormais qu’il ne peut pas agir la première nuit.
- L’import de script tronque le nom au-delà de 120 caractères et rejette les caractères de contrôle de direction de texte bidirectionnelle.

### Déroulé à table
- Relevé de scrutin : un pointage rapide permet de marquer une main levée d’un seul tap pendant le vote ; le détail par votant est désormais replié par défaut et facultatif.
- Marquer un joueur mort ou vivant se fait d’un seul tap depuis sa carte, sans fenêtre de confirmation, puisque l’annulation répare l’erreur.
- Le masque de confidentialité résiste maintenant à un rechargement de page, au lieu d’être contourné par un rafraîchissement.
- Une note à moitié saisie est conservée comme brouillon si la fiche est fermée par erreur, et restaurée à la réouverture.
- Le seuil de vote et les votes fantômes comptent désormais les Voyageurs vivants et morts, conformément aux règles.
- La barre d’outils de la table a été allégée : les outils occasionnels en sont sortis.

### Accessibilité et performance
- La vue des liens du tableau d’enquête est plafonnée avec un bouton « Afficher plus », au lieu de générer un HTML sans limite, et le tableau ne prépare que la vue réellement affichée.
- Les liens de relation ne reposent plus sur la seule couleur, et les étiquettes de colonnes des tableaux sur mobile sont du vrai texte plutôt qu’un contenu généré par CSS.

### Interface
- L’application dispose d’un logo dédié et d’un système visuel retravaillé.
- Les contrastes et les tailles de texte ont été relevés pour que les avertissements et les données des cartes restent lisibles dans une pièce sombre comme dans le thème clair.

### Documentation
- Guide et README (français et anglais) mis à jour pour décrire l’application telle qu’elle se présente aujourd’hui : un carnet de notes privé.

## 1.4.0

### Notes de partie et acceptabilité à table
- Les estimations en direct sont désormais masquées par défaut et déplacées derrière un réglage explicite, pour privilégier le carnet de notes privé plutôt qu’une assistance probabiliste visible.
- Le filtre des morts nocturnes par profil de Démon devient une hypothèse volontaire à activer, désactivée par défaut.
- Ajout d’un journal personnel de ce que le joueur a lui-même affirmé, à qui, et si l’information est restée privée.
- Ajout d’un espace structuré pour conserver les informations différées nuit après nuit ou jour après jour (Town Crier, Flowergirl, Savant, Gossip, Juggler, Amnesiac et cas similaires).
- Ajout d’une feuille papier imprimable adaptée au nombre réel de joueurs et d’un chemin de capture express plus rapide.

### Enquête et modèle
- Le tableau d’enquête est documenté comme un ensemble de lentilles liées : sièges, table ronde, chronologie, graphe, grille joueur-personnage et carte des contradictions partagent une sélection commune.
- Nouvelle portée « voisins de siège » dans le constructeur d’idées : au lieu de figer deux noms, l’idée cible une personne et ses deux voisins vivants sont recalculés depuis l’ordre des sièges au moment du calcul, en sautant les morts.
- Nouveau bouton « Pourquoi ? » à côté de chaque pourcentage : il retire tes éléments enregistrés un par un et montre ce que deviendrait le chiffre sans chacun d’eux. Quand tes hypothèses sont incompatibles, il propose un ensemble suffisant d’éléments à relâcher, sans prétendre qu’il est minimal.
- Le lien vers l’annuaire de scripts pointe désormais vers botcscripts.com ; l’ancienne adresse renvoyait une erreur.

### Documentation et catalogue
- Guide mis à jour pour les sauvegardes tournantes, l’usage du stockage, l’état de persistance, la migration depuis les schémas 1 à 4 et l’annulation des modifications récentes sans nombre figé.
- README français et anglais clarifiés : pas de bibliothèques tierces ni d’installation, mais un serveur HTTP statique local est requis ; `npm start` lance seulement le serveur Node inclus.
- Correction de plusieurs reformulations du catalogue sans changer les rôles, les scripts ni le nombre de capacités intégrées.

## 1.3.0

### Corrections issues de l'audit
- Le calcul refuse désormais explicitement les personnages structurellement incompatibles (Legion, Lil' Monsta, Marionette, Atheist, Village Idiot, Riot, Leviathan, Al-Hadikhia, Lleech, Boomdandy…) au lieu de produire silencieusement un modèle faux.
- Supprimé le double comptage : une déclaration ne peut plus peser deux fois via l'influence de son entrée de journal.
- L'écran peut être masqué depuis n'importe quelle fenêtre ouverte, sans perdre la saisie en cours.
- Les filtres de recherche sont réinitialisés au changement de partie.
- Les sièges archivés ne sont plus proposés pour un nouvel événement.
- Le passage en Voyageur depuis une fiche affiche désormais son impact avant application.
- Limite d'import alignée sur les plafonds réels : un carnet autorisé reste toujours réimportable.
- Lien corrigé vers la base de scripts communautaire.

### Fiabilité du calcul
- Intervalles de confiance et marge affichée ; le seuil de fiabilité repose sur l'erreur estimée et non plus sur le seul effectif efficace.
- Prise en compte de l'Ivrogne comme rôle montré possible d'une déclaration de Villageois.
- Plafonds nocturnes resserrés dans le sens sûr pour le Po et le Zombuul à partir des relevés existants.
- Provenance et fragilité explicites sur chaque idée imposée au modèle.

### Tableau d'enquête
- Nouvelle visualisation à quatre vues liées : matrice par siège, table ronde avec cordes de relations, chronologie et graphe des liens, avec une sélection partagée.
- Relations joueur à joueur dérivées des sources, nominations, votes, conflits de déclaration et hypothèses communes.

### Ergonomie, données et installation
- Saisie de scrutin en deux gestes au lieu de plus de vingt.
- Vocabulaire remplacé par un langage de joueur ; jargon statistique relégué au détail.
- Trois copies de secours tournantes, état du stockage et demande de stockage persistant.
- Icône masquable, métadonnées iOS, repli hors ligne et bannière de nouvelle version.

## Unreleased

- Corrected catalogue French metadata for several roles, including Chef adjacency wording, Exorcist broken markup, Ravenkeeper, Minstrel, Harlot, Librarian/Hell's Librarian and Lunatic/Dément wording.
- Restructured `guide.html` as a coherent user guide with a linked table of contents, merged topic sections, and a plain-language explanation of the estimation model.
- Added French and English README files with local run instructions, privacy notes, model limitations, installation guidance and current licensing status.

## 1.2.0

- Added roster editing: rename, add, reorder, archive and restore seats while preserving stable player identities and historical references.
- Added the connected investigation view linking people, claims, clues, events, user assumptions and results, with mobile-readable summaries and paginated records.
- Reframed relationship entry as “Test an idea about characters” with guided count sentences.
- Added a rules-coverage ledger describing recorded tracking, user assumptions, partial filters and mechanics not simulated.
- Migrated storage to schema 3, preserving older schema 1 and 2 saves with empty archives where no archive history existed.

## 1.1.0

- Added checkbox multi-role claims for one, three or more claimed characters.
- Added subjective claim weights: neutral, 2×, 5× and 20×.
- Added dated execution records with nominatee, nominator, outcome, per-voter ballots, vote weights and announced totals.
- Added night-death summaries with multiple victims, explicit empty-night confirmation and duplicate-night correction flow.
- Added conditional Demon-type and Minion-presence estimates.
- Migrated storage to schema 2.

## 1.0.0

- Initial private player notebook for Blood on the Clocktower.
- Added local game setup, player notes, claims, events, clues and hypotheses.
- Added bounded strict hypothesis solver for initial role assignments.
- Added offline/PWA support and a fictional demo game.
