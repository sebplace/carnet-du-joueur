// Vocabulaire et règles pures de l'encodage rapide : camp, effets, liens par rôle.
// Aucune dépendance : state.js l'importe pour valider, l'interface pour afficher.

export const CAMPS = ['neutral', 'good', 'evil', 'doubt'];
export const CAMP_NAMES = {
  neutral: ['Neutre', 'Neutral'],
  good: ['Bleu', 'Blue'],
  evil: ['Rouge', 'Red'],
  doubt: ['Orange', 'Orange']
};
export const CAMP_MEANING = {
  neutral: ['pas encore d’avis', 'no opinion yet'],
  good: ['je pense qu’il est du côté du bien', 'I think they are good'],
  evil: ['je pense qu’il est du côté du mal', 'I think they are evil'],
  doubt: ['je doute', 'I am unsure']
};

export const nextCamp = camp => CAMPS[(CAMPS.indexOf(camp) + 1) % CAMPS.length] || 'neutral';
export const campForTeam = team => ({townsfolk: 'good', outsider: 'good', minion: 'evil', demon: 'evil'})[team] || '';
// Ancien champ « confiance » : repris tel quel comme couleur au premier chargement.
export const campFromTrust = trust => ({trusted: 'good', suspect: 'evil', watch: 'doubt'})[trust] || 'neutral';

export const EFFECTS = [
  {id: 'poisoned', icon: '🧪', fr: 'Empoisonné', en: 'Poisoned'},
  {id: 'drunk', icon: '🍺', fr: 'Ivre', en: 'Drunk'},
  {id: 'protected', icon: '🛡', fr: 'Protégé', en: 'Protected'},
  {id: 'killed', icon: '🌙', fr: 'Mort la nuit', en: 'Killed at night'},
  {id: 'outlaw', icon: '🚫', fr: 'Hors-la-loi', en: 'Outlaw'},
  {id: 'mad', icon: '🌀', fr: 'Rendu fou', en: 'Made mad'},
  {id: 'herring', icon: '🎯', fr: 'Faux suspect', en: 'Red herring'},
  {id: 'turned', icon: '🔀', fr: 'Camp changé', en: 'Turned'}
];
export const EFFECT_IDS = EFFECTS.map(e => e.id);
export const effectInfo = id => EFFECTS.find(e => e.id === id);

const T = (id, fr, en, min, max, result = 'none', prompt = null) => ({id, fr, en, min, max, result, prompt});
export const LINK_TEMPLATES = Object.fromEntries([
  T('oneof', 'Un de ces deux est…', 'One of these two is…', 2, 2, 'role'),
  T('neighbours', 'Voisins maléfiques', 'Evil neighbours', 0, 0, 'number'),
  T('pick-demon', 'A désigné', 'Picked', 2, 2, 'yesno', ['Un Démon parmi eux ?', 'A Demon among them?']),
  T('pick-same', 'A comparé', 'Compared', 2, 2, 'yesno', ['Du même camp ?', 'Same alignment?']),
  T('learned', 'A appris le rôle de', 'Learned the character of', 1, 1, 'role'),
  T('protects', 'Protège', 'Protects', 1, 2),
  T('poisons', 'Empoisonne', 'Poisons', 1, 1),
  T('exorcises', 'Exorcise', 'Exorcises', 1, 1),
  T('curses', 'Maudit', 'Curses', 1, 1),
  T('maddens', 'Rend fou', 'Makes mad', 1, 1),
  T('targets', 'Vise', 'Targets', 1, 1),
  T('master', 'Maître', 'Master', 1, 1),
  T('grandchild', 'Petit-enfant', 'Grandchild', 1, 1),
  T('known-evil', 'Mauvais connu', 'Known evil', 1, 1),
  T('chosen', 'A choisi', 'Chose', 1, 3),
  T('related', 'Lié à', 'Linked to', 1, 4)
].map(t => [t.id, t]));
export const LINK_IDS = Object.keys(LINK_TEMPLATES);

// Rôles dont la capacité désigne ou concerne d'autres joueurs : le lien qu'on propose d'abord.
const ROLE_LINKS = {
  washerwoman: ['oneof'], librarian: ['oneof'], investigator: ['oneof'],
  empath: ['neighbours'],
  fortuneteller: ['pick-demon'], seamstress: ['pick-same'],
  undertaker: ['learned'], ravenkeeper: ['learned'], dreamer: ['learned'],
  monk: ['protects'], innkeeper: ['protects'], exorcist: ['exorcises'],
  poisoner: ['poisons'], witch: ['curses'], cerenovus: ['maddens'],
  assassin: ['targets'], slayer: ['targets'], gunslinger: ['targets'], godfather: ['targets'],
  butler: ['master'], grandmother: ['grandchild'], bountyhunter: ['known-evil'],
  chambermaid: ['chosen'], gambler: ['chosen'], sailor: ['chosen'], courtier: ['chosen'], preacher: ['chosen'], juggler: ['chosen']
};
const ROLE_TEAM_OF_ONEOF = {washerwoman: 'townsfolk', librarian: 'outsider', investigator: 'minion'};

export function templatesFor(roleId, team = '') {
  const first = ROLE_LINKS[roleId] || (team === 'minion' || team === 'demon' ? ['targets'] : []);
  return [...new Set([...first, 'chosen', 'related'])];
}
export const oneofTeam = roleId => ROLE_TEAM_OF_ONEOF[roleId] || '';

const pick = (pair, lang) => pair[lang === 'en' ? 1 : 0];
const list = (names, lang, joiner) => {
  if (names.length < 2) return names.join('');
  const word = joiner === 'or' ? (lang === 'en' ? 'or' : 'ou') : (lang === 'en' ? 'and' : 'et');
  return `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}`;
};
const yesNo = (value, lang) => value === 'yes' ? (lang === 'en' ? 'yes' : 'oui') : value === 'no' ? (lang === 'en' ? 'no' : 'non') : '';

// Voisins vivants (on saute les morts), comme à la table.
export function neighbourIds(game, anchorId) {
  const seats = game.players.filter(p => !p.traveller);
  const index = seats.findIndex(p => p.id === anchorId);
  if (index < 0 || seats.length < 3) return [];
  const find = step => {
    for (let i = 1; i < seats.length; i++) {
      const candidate = seats[(index + step * i + seats.length * seats.length) % seats.length];
      if (candidate.id !== anchorId && candidate.alive) return candidate.id;
    }
    return '';
  };
  return [...new Set([find(-1), find(1)].filter(Boolean))];
}

export function linkTargets(game, link) {
  return link.kind === 'neighbours' ? neighbourIds(game, link.from) : link.to;
}

export function shortLinkLabel(link, {roleName = id => id, lang = 'fr'} = {}) {
  const t = LINK_TEMPLATES[link.kind];
  if (!t) return '';
  if (t.result === 'number') return `${link.result || '?'}`;
  if (t.result === 'yesno') return yesNo(link.result, lang) || pick([t.fr, t.en], lang);
  if (t.result === 'role' && link.roleId) return roleName(link.roleId);
  return pick([t.fr, t.en], lang);
}

export function describeLink(link, {name = id => id, roleName = id => id, lang = 'fr', game = null} = {}) {
  const t = LINK_TEMPLATES[link.kind];
  const from = name(link.from);
  if (!t) return from;
  const targets = (game ? linkTargets(game, link) : link.to).map(name);
  const label = pick([t.fr, t.en], lang);
  if (link.kind === 'oneof') {
    const role = link.roleId ? roleName(link.roleId) : '…';
    return lang === 'en' ? `${from}: ${list(targets, lang, 'or')} is ${role}` : `${from} : ${list(targets, lang, 'or')} serait ${role}`;
  }
  if (link.kind === 'neighbours') {
    const n = link.result === '' || link.result == null ? '?' : link.result;
    const tail = targets.length ? ` (${list(targets, lang, 'and')})` : '';
    return lang === 'en' ? `${from}: ${n} evil neighbour(s)${tail}` : `${from} : ${n} voisin(s) maléfique(s)${tail}`;
  }
  if (link.kind === 'learned') {
    const role = link.roleId ? roleName(link.roleId) : '…';
    return lang === 'en' ? `${from} learned ${targets[0] || '…'} is ${role}` : `${from} a appris que ${targets[0] || '…'} est ${role}`;
  }
  const answer = t.result === 'yesno' ? yesNo(link.result, lang) : '';
  return `${from} · ${label} : ${list(targets, lang, 'and')}${answer ? ` → ${answer}` : ''}`;
}

// Chaque joueur d'un côté, chaque cible de l'autre : ce que le cadran dessine.
export function linkEdges(game) {
  const edges = [];
  for (const link of game.links || []) for (const to of linkTargets(game, link)) if (to !== link.from) edges.push({from: link.from, to, link});
  return edges;
}

export function campTally(game) {
  const counts = {neutral: 0, good: 0, evil: 0, doubt: 0};
  for (const p of game.players) if (!p.traveller) counts[p.camp] = (counts[p.camp] || 0) + 1;
  return counts;
}

// Rôle supposé -> qui l'a, pour la liste de contrôle des rôles du script.
export function guessIndex(game) {
  const index = new Map();
  for (const p of game.players) if (p.guess) index.set(p.guess, [...(index.get(p.guess) || []), p.id]);
  return index;
}

// Combien de joueurs on suppose dans chaque type, à comparer aux effectifs de départ.
export function guessedByTeam(game, roleOf) {
  const counts = {townsfolk: 0, outsider: 0, minion: 0, demon: 0};
  for (const p of game.players) {
    if (p.traveller || !p.guess) continue;
    const team = roleOf(p.guess)?.team;
    if (team in counts) counts[team]++;
  }
  return counts;
}

export const effectsOf = player => (player.effects || []).map(e => e.id);
