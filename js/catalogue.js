const MAX_TEXT_LENGTH = 250_000;
const MAX_ENTRIES = 200;
const MAX_SCRIPT_NAME_LENGTH = 120;
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/u;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const RESERVED_IDS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype).map(name => name.toLowerCase()),
  'prototype',
  '_meta',
]);
const TEAMS = new Set([
  'townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled', 'unknown',
]);
const has = (object, key) => Object.hasOwn(object, key);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function checkId(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || RESERVED_IDS.has(id.toLowerCase())) {
    throw new Error('Identifiant de rôle invalide ou réservé (1 à 80 lettres, chiffres, _ ou -).');
  }
}

function scriptName(metadata) {
  if (!isRecord(metadata)) throw new Error('Les métadonnées doivent être un objet JSON.');
  if (!has(metadata, 'name')) return 'Script importé';
  if (typeof metadata.name !== 'string') throw new Error('Le nom du script doit être un texte.');
  if (BIDI_CONTROLS.test(metadata.name)) throw new Error('Le nom du script contient des caractères de direction interdits. / Script name contains forbidden direction controls.');
  const name = metadata.name.trim();
  if (name.length > MAX_SCRIPT_NAME_LENGTH) throw new Error('Le nom du script dépasse 120 caractères. / Script name exceeds 120 characters.');
  return name || 'Script importé';
}

function bilingual(value, field, fallback = '') {
  if (value === undefined) return { fr: fallback, en: fallback };
  if (typeof value === 'string') {
    const text = field === 'name' ? value.trim() || fallback : value;
    return { fr: text, en: text };
  }
  if (!isRecord(value)) throw new Error(`Le champ « ${field} » doit être un texte ou un objet fr/en.`);
  for (const language of ['fr', 'en']) {
    if (has(value, language) && typeof value[language] !== 'string') {
      throw new Error(`Le champ « ${field}.${language} » doit être un texte.`);
    }
  }
  const fr = has(value, 'fr') ? value.fr : '';
  const en = has(value, 'en') ? value.en : '';
  return field === 'name'
    ? { fr: fr.trim() || en.trim() || fallback, en: en.trim() || fr.trim() || fallback }
    : { fr, en };
}

function customRole(entry, id, warnings) {
  const definition = typeof entry === 'string' ? {} : entry;
  if (has(definition, 'team') && typeof definition.team !== 'string') {
    throw new Error('Le champ « team » doit être un texte.');
  }
  const importedTeam = definition.team === 'traveler' ? 'traveller' : definition.team;
  const team = TEAMS.has(importedTeam) ? importedTeam : 'unknown';
  if (has(definition, 'team') && !TEAMS.has(importedTeam)) {
    warnings.push(`Catégorie non reconnue pour « ${id} » : conservée comme « unknown ».`);
  }
  const hasDescription = ['name', 'team', 'ability'].some(field => has(definition, field));
  warnings.push(hasDescription
    ? `Rôle personnalisé « ${id} » : texte descriptif uniquement, mécaniques non vérifiées.`
    : `Rôle inconnu « ${id} » : aucune catégorie ni capacité n’est déduite.`);

  // Construct only plain-text allowlisted fields; never retain assets or executable metadata.
  return {
    id,
    name: bilingual(definition.name, 'name', id),
    team,
    ability: bilingual(definition.ability, 'ability'),
  };
}

export function parseScript(text, catalogue) {
  if (typeof text !== 'string') throw new Error('Le script doit être fourni sous forme de texte JSON.');
  if (text.length > MAX_TEXT_LENGTH) throw new Error('Le script dépasse la limite de 250 000 caractères.');
  if (!isRecord(catalogue) || !Array.isArray(catalogue.roles)) {
    throw new Error('Catalogue de rôles invalide.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON invalide : fournissez un tableau de rôles sans commentaires ni code.');
  }

  let entries;
  let name = 'Script importé';
  let metadataSeen = false;
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (isRecord(parsed) && Array.isArray(parsed.characters)) {
    entries = parsed.characters;
    if (has(parsed, 'meta')) {
      name = scriptName(parsed.meta);
      metadataSeen = true;
    }
  } else {
    throw new Error('Format de script invalide : tableau JSON de rôles attendu.');
  }
  if (entries.length > MAX_ENTRIES) throw new Error('Le script dépasse la limite de 200 entrées.');

  const knownIds = new Set(catalogue.roles.map(role => role.id));
  const seen = new Set();
  const roleIds = [];
  const customRoles = [];
  const warnings = [];
  let ignoredDefinitions = 0;

  for (const entry of entries) {
    if (typeof entry !== 'string' && (!isRecord(entry) || !has(entry, 'id'))) {
      throw new Error('Chaque entrée doit être un identifiant texte ou un objet contenant « id ».');
    }
    const id = typeof entry === 'string' ? entry : entry.id;
    if (id === '_meta' && isRecord(entry)) {
      if (metadataSeen) throw new Error('Métadonnées « _meta » répétées : une seule définition est autorisée.');
      name = scriptName(entry);
      metadataSeen = true;
      continue;
    }
    checkId(id);
    if (seen.has(id)) {
      warnings.push(`Rôle « ${id} » en double : seule la première entrée est conservée.`);
      continue;
    }
    seen.add(id);
    roleIds.push(id);

    if (knownIds.has(id)) {
      if (isRecord(entry) && ['name', 'team', 'ability'].some(field => has(entry, field))) {
        ignoredDefinitions += 1;
      }
    } else {
      customRoles.push(customRole(entry, id, warnings));
    }
  }

  if (ignoredDefinitions) {
    warnings.push(`Définitions intégrées conservées : ${ignoredDefinitions} définition(s) importée(s) de rôles connus ignorée(s).`);
  }
  return { name, roleIds, customRoles, warnings };
}
