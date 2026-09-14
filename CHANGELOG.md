# Changelog

All notable changes to Carnet du Joueur are recorded here.

## 2.1.0

La vue Roles etait la plus longue de l application : 5040 px sur telephone,
parce que les 27 capacites du script y etaient depliees en permanence.

### La liste des roles se parcourt au lieu de se derouler
- Chaque fiche est repliee : le nom reste scannable, la capacite est a un tap.
- Une recherche qui ne laisse que quelques roles les ouvre d'elle meme.
- L'equipe devient un titre de section au lieu d'etre repetee sur chacune des
  27 lignes. Une fiche repliee tient sur une seule ligne.
- Un compteur annonce combien de roles sont affiches.
- Le pave « trouver d'autres scripts » est replie : il ne sert qu'a l'occasion.

### Correction de fond
- Une regle `.card{padding:20px}` du bloc mobile ecrasait le padding des fiches
  a specificite egale et ajoutait 40 px a chacune des 27 lignes. C'est elle qui
  rendait les colonnes si etroites que des noms simples comme « Bibliothecaire »
  etaient coupes en deux. Corrigee par specificite.

Resultat mesure sur telephone : 5040 px devient 1715 px, cible tactile de 44 px
conservee, et aucun nom de role n'est coupe en deux entre 320 et 1280 px.

## 2.0.0

Retour de test sur la 1.9 : « que signifie le dit qui apparait sur le schema ? ».
Le cadran ecrivait « dit » la ou la legende, juste en dessous, ecrivait
« communique ». Deux mots pour une seule relation, aucun sens de lecture, et un
mot qui signifiait en realite « contenu inconnu ».

### Un seul vocabulaire
- Le mot d'un lien est desormais le meme sur le trait, dans la legende et sur la
  pastille de la liste.
- Une etiquette de trait porte toujours le CONTENU du lien : le personnage quand
  il est connu. La categorie reste portee par le style du trait et la legende.

### Le cas vide s'annonce comme tel
- Un propos sans personnage nomme affiche « sans detail » au lieu de « dit », et
  la phrase de la liste se termine par « sans role precise ».

### Le sens de lecture est visible
- Les liens orientes (propos, vote, nomination) portent une fleche qui va de qui
  parle vers qui est vise. Un conflit ou une hypothese lient deux sieges a
  egalite : ils n'en portent pas.
- Une ligne explique la fleche des qu'une seule est a l'ecran.

### Lisibilite du cadran
- Une etiquette ne se pose plus sous un cercle de siege : les sieges sont
  desormais des obstacles au placement.
- Deux liens sur une meme paire suivaient la meme courbe et le second
  disparaissait sous le premier. Leurs traces sont maintenant ecartes.
- Une note trop longue est coupee sur un mot entier, plus au signe pres.

### Partie de demonstration
- La note d'exemple supposait connu le format d'information de l'Empathe et
  parlait d'un « 1 » sans unite. Elle dit maintenant ce que le chiffre signifie.

## 1.9.0

Retour de test sur le cadran : on ne comprenait pas au premier coup d'oeil ce qui
avait ete communique ni ce qui causait un conflit. Les liens annoncaient leur
categorie, jamais leur substance.

### Les liens disent enfin ce qu'ils portent
- Un conflit annonce sa cause : « Chloe et Bruno revendiquent tous deux Empathe ».
- Une information dit qui parle de qui : « Bruno dit : Chloe est Empathe », ou
  « Bruno a parle d'Alice » quand aucun role n'est nomme.
- Le nom du role est resolu et traduit. Avant, l'identifiant brut du script
  pouvait remonter jusqu'a l'ecran.
- Ta note d'origine apparait en citation sous la phrase, et une seule fois meme
  si plusieurs liens partagent la meme note.
- Le titre du panneau nomme le siege choisi, avec l'elision correcte.

### Lire le cadran sans mode d'emploi
- Une legende relie chaque trait a son sens, en reprenant sa couleur et son motif.
- Sur le cadran, l'etiquette porte le role plutot que le mot de categorie.
- Les etiquettes ne se chevauchent plus : chacune choisit sa place sur sa propre
  corde plutot que de se poser au meme endroit.
- Selectionner un siege ramene le cadran et ses liens dans l'ecran. La reponse
  n'attend plus sous la ligne de flottaison.
- La consigne d'usage disparait une fois le siege choisi : elle a servi.
## 1.8.0

### Le cadran : voir la table, pas une liste
- Nouvelle forme d'affichage des joueurs : le plan de table dessine comme un cadran d'horloge, siege 1 en haut, sens horaire. L'adjacence devient immediatement visible, ce qui est au coeur du raisonnement dans ce jeu : une liste verticale la cachait.
- Les connexions ne s'affichent que pour le siege selectionne. La table ronde precedente les dessinait toutes a la fois et devenait illisible des dix joueurs.
- Un panneau sous le cadran liste les liens du siege choisi en toutes lettres.
- La vue Joueurs offre desormais deux formes du meme carnet : Liste pour saisir vite, Plan pour lire la situation. Le choix est memorise.
- Etats lisibles sans percevoir les couleurs : cerne epais et chiffre souligne pour soi, chiffre surligne pour un voyageur, croix pleine ou rompue selon que le vote fantome reste disponible, motifs de tirets distincts pour la confiance accordee.

### Simplification
- Le tableau passe de six a quatre lentilles. La matrice a ete supprimee car elle repetait la liste des joueurs, et la table ronde a ete remplacee par le cadran.
- Le code devenu inatteignable a ete supprime plutot que conserve : neuf fonctions au total.
## 1.7.0

### Lisibilite de la situation a l'instant T
- Les cartes joueur deviennent des lignes denses : numero de siege, nom, role declare et etat sur une seule ligne. Sept joueurs tiennent desormais a l'ecran la ou trois etaient visibles.
- Les actions passent de quatre boutons texte a trois pictogrammes, accompagnes d'une legende permanente qui dit ce que chacun fait.
- La confiance accordee a un joueur s'affiche par un ruban texture a gauche de la ligne, distinguable sans percevoir les couleurs.

### Navigation et clarte
- La navigation basse est renommee pour dire ce qu'on y trouve : Joueurs, Tableau, Journal, Roles.
- Le menu Outils explique chaque entree en une phrase au lieu de n'afficher qu'un nom.
- Points d'entree rationalises : chaque action n'a plus qu'un domicile, sauf lorsque deux contextes differents le justifient. Les limites du carnet etaient atteignables depuis quatre endroits, le rafraichissement depuis cinq.
- Le bouton de masquage de l'ecran est de retour dans l'en-tete, en plus de celui de la zone du pouce.
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


