import {CAMPS, CAMP_NAMES, CAMP_MEANING, nextCamp, campForTeam, EFFECTS, effectInfo, LINK_TEMPLATES, templatesFor, oneofTeam, describeLink, neighbourIds, campTally, guessIndex, guessedByTeam} from './encode.js';
import {normalCounts} from './state.js';

const SHEET_TEAMS = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'unknown'];

// Tout ce qui sert à noter vite : couleur, rôle supposé, effets, notes, liens.
// Le module ne possède aucun état de partie : il lit et modifie la partie par `ctx`.
export function createEncoder(ctx) {
  const {esc} = ctx;
  const tr = (fr, en) => ctx.lang() === 'fr' ? fr : en;
  const g = () => ctx.game();
  const campName = c => tr(...CAMP_NAMES[c]);
  const teamLabel = team => ctx.teamName(team);
  const moment = e => `${e.phase === 'night' ? 'N' : tr('J', 'D')}${e.day}`;
  const livePlayer = id => g().players.find(p => p.id === id);

  let brush = '';
  let sheet = null;

  // ---------- pastille et pinceau ----------
  const campDot = (camp, extra = '') => `<span class="camp-dot ${extra}" data-camp="${esc(camp)}" aria-hidden="true"></span>`;

  function cycleCamp(id) {
    const p = livePlayer(id);
    if (!p) return;
    const next = nextCamp(p.camp);
    ctx.change(game => { game.players.find(x => x.id === id).camp = next; }, tr(`${p.name} : ${campName(next).toLowerCase()}`, `${p.name}: ${campName(next).toLowerCase()}`));
  }

  function setCamp(id, camp) {
    if (!CAMPS.includes(camp)) return;
    ctx.change(game => { game.players.find(x => x.id === id).camp = camp; });
  }

  function paint(id) {
    const p = livePlayer(id);
    if (!p || !brush) return;
    if (brush === 'dead') {
      ctx.change(game => {
        const q = game.players.find(x => x.id === id);
        q.alive = !q.alive;
        ctx.event(game, q.alive ? 'revival' : 'death', q.alive ? tr('Retour en vie observé', 'Observed revival') : tr('Décès observé', 'Observed death'), [q.id]);
      }, p.alive ? tr(`${p.name} noté mort. ↶ pour annuler.`, `${p.name} recorded dead. ↶ to undo.`) : tr(`${p.name} noté vivant. ↶ pour annuler.`, `${p.name} recorded alive. ↶ to undo.`));
      return;
    }
    const next = p.camp === brush ? 'neutral' : brush;
    ctx.change(game => { game.players.find(x => x.id === id).camp = next; });
  }

  function pickBrush(value) {
    brush = brush === value ? '' : value;
    ctx.render();
  }

  function brushBarHtml(showIdleHint = true) {
    const counts = campTally(g());
    const dead = g().players.filter(p => !p.alive).length;
    const buttons = CAMPS.map(c => `<button type="button" class="brush-btn" data-action="brush" data-brush="${c}" aria-pressed="${brush === c}" aria-label="${esc(tr(`Pinceau ${campName(c).toLowerCase()}, ${counts[c]} joueur(s)`, `${campName(c)} brush, ${counts[c]} player(s)`))}">${campDot(c)}<b>${counts[c]}</b><span>${esc(campName(c))}</span></button>`).join('')
      + `<button type="button" class="brush-btn brush-dead" data-action="brush" data-brush="dead" aria-pressed="${brush === 'dead'}" aria-label="${esc(tr(`Pinceau mort, ${dead} joueur(s)`, `Dead brush, ${dead} player(s)`))}"><span class="camp-dot" data-camp="dead" aria-hidden="true">☠</span><b>${dead}</b><span>${esc(tr('Mort', 'Dead'))}</span></button>`;
    const hint = brush
      ? (brush === 'dead'
          ? tr('Pinceau mort : touche un joueur pour le noter mort, ou vivant. ', 'Dead brush: tap a player to record them dead, or alive.')
          : tr(`Pinceau ${campName(brush).toLowerCase()} : touche des joueurs. Un second tap efface.`, `${campName(brush)} brush: tap players. A second tap clears.`))
      : tr('Touche une couleur puis des joueurs pour les peindre, ou un joueur pour sa fiche.', 'Tap a colour then players to paint them, or a player for their sheet.');
    return `<div class="brush" role="group" aria-label="${esc(tr('Pinceau de couleur', 'Colour brush'))}">${buttons}</div><p class="brush-hint ${brush ? 'on' : ''}" aria-live="polite" ${brush || showIdleHint ? '' : 'hidden'}>${esc(hint)}</p>`;
  }

  function startLine() {
    const n = g().players.filter(p => !p.traveller).length;
    if (n < 5 || n > 15) return '';
    const c = normalCounts(n);
    const good = c.townsfolk + c.outsider, evil = c.minion + c.demon;
    return tr(`Au départ, pour ${n} joueurs : ${good} du bien et ${evil} du mal.`, `At the start, with ${n} players: ${good} good and ${evil} evil.`);
  }

  // ---------- ligne de la liste ----------
  const lastNote = id => {
    const list = g().events.filter(e => (e.type === 'info' || e.type === 'note') && e.text && (e.playerIds.includes(id) || e.sourceId === id));
    return list.at(-1);
  };

  function seatRowHtml(p, index) {
    const claim = ctx.latestClaim(p.id);
    const claimLabel = claim ? ctx.roleLabel(claim.roleIds) : '';
    const guessLabel = p.guess ? ctx.rname(p.guess) : '';
    const state = p.alive ? '' : (p.ghost ? tr('mort · vote restant', 'dead · vote left') : tr('mort · vote utilisé', 'dead · vote used'));
    const note = lastNote(p.id);
    const fx = (p.effects || []).map(e => effectInfo(e.id)).filter(Boolean);
    const links = g().links.filter(l => l.from === p.id).length;
    const roleLine = guessLabel
      ? `<span class="seat-role">${esc(guessLabel)}</span>${claimLabel && claimLabel !== guessLabel ? `<span class="seat-claim"> · ${tr('annonce', 'claims')} ${esc(claimLabel)}</span>` : ''}`
      : claimLabel
        ? `<span class="seat-claim">${tr('annonce', 'claims')} ${esc(claimLabel)}</span>`
        : `<span class="seat-role none">${tr('Rôle ?', 'Role ?')}</span>`;
    return `<article class="player-card seat camp-${esc(p.camp)} ${p.id === g().myId ? 'mine' : ''} ${p.alive ? '' : 'dead'}">
      <button type="button" class="seat-camp" data-action="camp" data-id="${p.id}" aria-label="${esc(`${tr('Changer la couleur', 'Change the colour')} : ${p.name} (${campName(p.camp)})`)}" title="${esc(campName(p.camp))}">${campDot(p.camp)}</button>
      <button type="button" class="player-open seat-open" data-action="seat-tap" data-id="${p.id}" aria-label="${esc(tr('Ouvrir la fiche de ', 'Open the sheet of ') + p.name)}">
        <span class="seat-num">${String(index).padStart(2, '0')}</span>
        <span class="seat-body">
          <span class="seat-name">${esc(p.name)}${p.id === g().myId ? ` <em>${tr('moi', 'me')}</em>` : ''}${p.traveller ? ` <span class="seat-flag">${tr('voyageur', 'traveller')}</span>` : ''}</span>
          <span class="seat-line">${roleLine}</span>
          ${note ? `<span class="seat-note">${esc(note.text)}</span>` : ''}
        </span>
        <span class="seat-side">
          ${state ? `<span class="seat-state">${esc(state)}</span>` : ''}
          ${fx.length || links ? `<span class="seat-marks">${fx.slice(0, 3).map(e => `<span class="seat-fx" title="${esc(tr(e.fr, e.en))}">${e.icon}</span>`).join('')}${fx.length > 3 ? `<span class="seat-fx">+${fx.length - 3}</span>` : ''}${links ? `<span class="seat-links" title="${esc(tr('Liens notés', 'Noted links'))}">⌁${links}</span>` : ''}</span>` : ''}
        </span>
        <span data-compact-estimate="${p.id}">${ctx.compactPrediction(p.id)}</span>
      </button></article>`;
  }

  // ---------- fiche ----------
  const focusKey = el => el?.closest?.('#dialog') ? el.dataset?.focus || '' : '';

  function redraw() {
    if (!sheet) return;
    const p = livePlayer(sheet.id);
    if (!p) { sheet = null; ctx.close(); return; }
    const dialog = document.querySelector('#dialog');
    const top = dialog.scrollTop;
    const focus = focusKey(document.activeElement);
    const html = sheet.view === 'role' ? roleViewHtml(p) : sheet.view === 'link' ? linkViewHtml(p) : mainHtml(p);
    ctx.open(p.name, html, d => bind(d, p));
    dialog.classList.add('sheet');
    dialog.scrollTop = top;
    const target = focus && dialog.querySelector(`[data-focus="${CSS.escape(focus)}"]`);
    if (target) target.focus({preventScroll: true});
  }

  function openSheet(id, view = 'main') {
    const p = livePlayer(id);
    if (!p) return;
    const keep = sheet?.id === id ? sheet : null;
    sheet = {id, view, editNote: keep?.editNote || '', noteMode: keep?.noteMode || 'about', draft: keep?.draft || '', link: null, roleQuery: ''};
    redraw();
  }

  function mainHtml(p) {
    const game = g();
    const index = game.players.indexOf(p) + 1;
    const guess = p.guess ? ctx.role(p.guess) : null;
    const claim = ctx.latestClaim(p.id);
    const status = [tr(`Siège ${index}`, `Seat ${index}`), p.id === game.myId ? tr('moi', 'me') : '', p.traveller ? tr('voyageur', 'traveller') : '', p.alive ? tr('vivant', 'alive') : (p.ghost ? tr('mort, vote fantôme disponible', 'dead, ghost vote available') : tr('mort, vote fantôme utilisé', 'dead, ghost vote spent'))].filter(Boolean).join(' · ');
    const campButtons = CAMPS.map(c => `<button type="button" role="radio" aria-checked="${p.camp === c}" class="camp-choice" data-action="set-camp" data-id="${p.id}" data-camp="${c}" data-focus="camp-${c}">${campDot(c)}<span>${esc(campName(c))}</span></button>`).join('');
    const suggested = templatesFor(p.guess, guess?.team).filter(k => k !== 'chosen' && k !== 'related').slice(0, 2);
    const claimLine = claim
      ? `<p class="sheet-claim">${tr('Il annonce', 'Claims')} : <strong>${esc(ctx.roleLabel(claim.roleIds))}</strong>${claim.roleIds.length === 1 && claim.roleIds[0] !== p.guess ? ` <button type="button" class="link-button" data-action="guess-from-claim" data-id="${p.id}" data-focus="from-claim">${tr('Le supposer aussi', 'Assume it too')}</button>` : ''} <button type="button" class="link-button" data-action="edit-claim" data-id="${claim.id}">${tr('Corriger', 'Edit')}</button></p>`
      : `<p class="sheet-claim"><button type="button" class="link-button" data-action="claim" data-id="${p.id}">${tr('Noter le rôle qu’il annonce', 'Note the character they claim')}</button></p>`;
    const effectButtons = EFFECTS.map(e => {
      const on = (p.effects || []).find(x => x.id === e.id);
      return `<button type="button" class="effect" aria-pressed="${!!on}" data-action="toggle-effect" data-id="${p.id}" data-effect="${e.id}" data-focus="fx-${e.id}"><span aria-hidden="true">${e.icon}</span><span>${esc(tr(e.fr, e.en))}</span>${on ? `<small>${esc(moment(on))}</small>` : ''}</button>`;
    }).join('');
    const notes = notesOf(p.id);
    const noteItems = notes.map(e => noteItemHtml(e, p)).join('');
    const links = linksOf(p.id);
    const linkItems = links.map(l => `<li class="sheet-link"><span>${esc(describeLink(l, {name: ctx.pname, roleName: ctx.rname, lang: ctx.lang(), game}))}${l.note ? `<small>${esc(l.note)}</small>` : ''}<small class="muted">${l.from === p.id ? '' : tr('Le concerne · ', 'Involves them · ')}${esc(moment(l))}</small></span><button type="button" class="icon-button small-x" data-action="link-delete" data-link="${l.id}" aria-label="${esc(tr('Supprimer ce lien', 'Delete this link'))}">×</button></li>`).join('');
    return `<div class="sheet-body">
      <p class="sheet-status">${esc(status)}</p>
      <section class="sheet-sec"><h3>${tr('Camp', 'Side')}</h3>
        <div class="camp-choices" role="radiogroup" aria-label="${esc(tr('Camp supposé', 'Assumed side'))}">${campButtons}</div>
        <p class="muted small sheet-meaning">${esc(tr(...CAMP_MEANING[p.camp]))}</p></section>
      <section class="sheet-sec"><h3>${tr('Rôle supposé', 'Assumed character')}</h3>
        <button type="button" class="role-pill ${guess ? '' : 'empty'}" data-action="sheet-role" data-id="${p.id}" data-focus="pick-role">${guess ? `<span class="role-pill-name">${esc(ctx.loc(guess.name))}</span><span class="role-pill-team">${esc(teamLabel(guess.team))}</span><span class="role-pill-edit">${tr('Changer', 'Change')}</span>` : `<span class="role-pill-name">${tr('＋ Choisir un rôle', '＋ Choose a character')}</span>`}</button>
        ${guess && ctx.loc(guess.ability) ? `<details class="sheet-ability"><summary>${tr('Sa capacité', 'Its ability')}</summary><p>${esc(ctx.loc(guess.ability))}</p></details>` : ''}
        ${claimLine}</section>
      <section class="sheet-sec"><h3>${tr('Effets', 'Effects')}</h3><div class="effects">${effectButtons}</div></section>
      <section class="sheet-sec"><h3>${tr('Notes', 'Notes')}</h3>
        ${noteItems ? `<ul class="sheet-notes">${noteItems}</ul>` : `<p class="muted small">${tr('Aucune note pour l’instant.', 'No notes yet.')}</p>`}
        <form id="note-form" class="note-composer">
          <div class="mode-switch" role="radiogroup" aria-label="${esc(tr('Type de note', 'Note type'))}">
            <button type="button" role="radio" aria-checked="${sheet.noteMode === 'about'}" data-action="note-mode" data-mode="about" data-focus="mode-about">${tr('À son sujet', 'About them')}</button>
            <button type="button" role="radio" aria-checked="${sheet.noteMode === 'said'}" data-action="note-mode" data-mode="said" data-focus="mode-said">${tr('Il m’a dit', 'They told me')}</button>
          </div>
          <label class="sr-only" for="note-text">${tr('Nouvelle note', 'New note')}</label>
          <textarea id="note-text" name="text" rows="2" maxlength="2000" placeholder="${esc(sheet.noteMode === 'said' ? tr('Ce qu’il m’a dit : j’ai vu 1, je suis Empathe…', 'What they told me: I saw 1, I am the Empath…') : tr('Une information sur lui : a voté oui, dit avoir été visé…', 'Something about them: voted yes, says they were targeted…'))}">${esc(sheet.draft)}</textarea>
          <div class="row spread"><span class="muted small">${esc(moment({day: game.day, phase: game.phase}))}</span><button type="submit" class="primary">${tr('Ajouter la note', 'Add note')}</button></div>
        </form></section>
      <section class="sheet-sec"><h3>${tr('Liens', 'Links')}</h3>
        ${linkItems ? `<ul class="sheet-links">${linkItems}</ul>` : `<p class="muted small">${tr('Relie ce joueur à d’autres : ses voisins, les joueurs qu’il a désignés, ce que sa capacité lui a appris.', 'Link this player to others: neighbours, players they picked, what their ability told them.')}</p>`}
        <div class="row link-add">${suggested.map(k => `<button type="button" data-action="link-start" data-id="${p.id}" data-kind="${k}">＋ ${esc(tr(LINK_TEMPLATES[k].fr, LINK_TEMPLATES[k].en))}</button>`).join('')}<button type="button" data-action="link-start" data-id="${p.id}" data-kind="">＋ ${tr('Autre lien', 'Other link')}</button></div></section>
      ${ctx.unlocked() ? `<details class="sheet-sec"><summary>${tr('Estimations des rôles déclarés', 'Estimates for claimed characters')}</summary><div data-player-estimate="${p.id}">${ctx.playerPrediction(p.id)}</div></details>` : ''}
      <section class="sheet-sec sheet-state"><h3>${tr('Statut', 'Status')}</h3><div class="row">
        ${ctx.button('life', p.alive ? tr('☠ Noter sa mort', '☠ Record death') : tr('✚ Noter son retour en vie', '✚ Record revival'), '', `data-id="${p.id}"`)}
        ${!p.alive ? ctx.button('ghost', p.ghost ? tr('Vote fantôme utilisé', 'Ghost vote used') : tr('Rendre le vote fantôme', 'Restore ghost vote'), '', `data-id="${p.id}"`) : ''}
        ${ctx.button('execution', tr('⚖ Exécution', '⚖ Execution'), '', `data-id="${p.id}"`)}
        ${ctx.button('player-edit', tr('✎ Nom, voyageur, moi…', '✎ Name, traveller, me…'), '', `data-id="${p.id}"`)}</div></section>
    </div>`;
  }

  function notesOf(id) {
    return g().events.filter(e => (e.type === 'info' || e.type === 'note') && (e.playerIds.includes(id) || e.sourceId === id)).slice().reverse();
  }
  function linksOf(id) {
    return g().links.filter(l => l.from === id || l.to.includes(id)).slice().reverse();
  }

  function noteItemHtml(e, p) {
    const said = e.sourceId === p.id;
    const label = said ? tr('Il m’a dit', 'Told me') : e.type === 'note' ? tr('Note', 'Note') : tr('À son sujet', 'About them');
    if (sheet.editNote === e.id) {
      return `<li class="sheet-note editing"><form id="note-edit-form" data-id="${e.id}"><label class="sr-only" for="note-edit-text">${tr('Modifier la note', 'Edit the note')}</label><textarea id="note-edit-text" name="text" rows="3" maxlength="2000">${esc(e.text)}</textarea><div class="row"><button type="submit" class="primary">${tr('Enregistrer', 'Save')}</button><button type="button" data-action="note-edit-cancel">${tr('Annuler', 'Cancel')}</button></div></form></li>`;
    }
    return `<li class="sheet-note"><div class="sheet-note-text"><small class="muted">${esc(moment(e))} · ${esc(label)}</small><p>${esc(e.text)}</p></div><div class="sheet-note-actions"><button type="button" class="icon-button small-x" data-action="note-edit" data-event="${e.id}" aria-label="${esc(tr('Modifier cette note', 'Edit this note'))}">✎</button><button type="button" class="icon-button small-x" data-action="note-delete" data-event="${e.id}" aria-label="${esc(tr('Supprimer cette note', 'Delete this note'))}">×</button></div></li>`;
  }

  // ---------- choix du rôle ----------
  function roleViewHtml(p) {
    const game = g();
    const who = guessIndex(game);
    const expected = (() => { const n = game.players.filter(x => !x.traveller).length; return n >= 5 && n <= 15 ? normalCounts(n) : null; })();
    const given = guessedByTeam(game, ctx.role);
    const pool = ctx.roles().filter(r => SHEET_TEAMS.includes(r.team));
    const claim = ctx.latestClaim(p.id);
    const claimed = claim ? claim.roleIds.map(ctx.role).filter(r => pool.some(x => x.id === r.id)) : [];
    const option = r => {
      const others = (who.get(r.id) || []).filter(id => id !== p.id).map(ctx.pname);
      return `<button type="button" class="role-opt" data-action="set-guess" data-id="${p.id}" data-role="${esc(r.id)}" aria-pressed="${p.guess === r.id}" data-search="${esc(ctx.fold(`${r.id} ${r.name.fr} ${r.name.en}`))}"><span>${esc(ctx.loc(r.name))}</span>${others.length ? `<small>${esc(others.join(', '))}</small>` : ''}</button>`;
    };
    const groups = SHEET_TEAMS.map(team => {
      const items = pool.filter(r => r.team === team).sort((a, b) => ctx.loc(a.name).localeCompare(ctx.loc(b.name), ctx.lang()));
      if (!items.length) return '';
      const count = team in given && expected ? tr(` · ${given[team]} supposé(s) sur ${expected[team]}`, ` · ${given[team]} assumed of ${expected[team]}`) : '';
      return `<section class="role-pick-group" data-group><h3>${esc(teamLabel(team))}<small>${esc(count)}</small></h3><div class="role-pick-grid">${items.map(option).join('')}</div></section>`;
    }).join('');
    return `<div class="sheet-body">
      <button type="button" class="back-button" data-action="sheet-back" data-id="${p.id}">‹ ${tr('Retour à la fiche', 'Back to the sheet')}</button>
      <h3 class="sheet-title">${esc(tr(`Quel rôle pour ${p.name} ?`, `Which character for ${p.name}?`))}</h3>
      ${claimed.length ? `<section class="role-pick-group"><h3>${tr('Ce qu’il annonce', 'What they claim')}</h3><div class="role-pick-grid">${claimed.map(option).join('')}</div></section>` : ''}
      <label class="search role-search">${tr('Chercher', 'Search')}<input id="role-pick-search" type="search" placeholder="${esc(tr('Nom français ou anglais', 'French or English name'))}" data-focus="role-search"></label>
      ${p.guess ? `<button type="button" class="clear-role" data-action="set-guess" data-id="${p.id}" data-role="">${tr('Aucun rôle supposé', 'No assumed character')}</button>` : ''}
      <div id="role-pick-list">${groups}</div>
      <p id="role-pick-empty" class="muted" hidden>${tr('Aucun rôle trouvé.', 'No character found.')}</p></div>`;
  }

  function setGuess(id, roleId) {
    const p = livePlayer(id);
    if (!p) return;
    const team = roleId ? ctx.role(roleId).team : '';
    const suggestion = p.camp === 'neutral' && roleId ? campForTeam(team) : '';
    ctx.change(game => {
      const q = game.players.find(x => x.id === id);
      q.guess = roleId;
      if (suggestion) q.camp = suggestion;
    }, suggestion ? tr(`${ctx.rname(roleId)} : couleur ${campName(suggestion).toLowerCase()} proposée`, `${ctx.rname(roleId)}: ${campName(suggestion).toLowerCase()} colour suggested`) : '');
    sheet.view = 'main';
    redraw();
  }

  // ---------- liens ----------
  function startLink(id, kind) {
    sheet = {...sheet, id, view: 'link', link: {kind, to: [], result: '', roleId: '', note: ''}};
    redraw();
  }

  function linkViewHtml(p) {
    const game = g();
    const l = sheet.link;
    const guess = p.guess ? ctx.role(p.guess) : null;
    const back = `<button type="button" class="back-button" data-action="sheet-back" data-id="${p.id}">‹ ${tr('Retour à la fiche', 'Back to the sheet')}</button>`;
    if (!l.kind) {
      const first = templatesFor(p.guess, guess?.team);
      const rest = Object.keys(LINK_TEMPLATES).filter(k => !first.includes(k));
      const item = k => `<button type="button" class="menu-item link-kind" data-action="link-kind" data-kind="${k}"><span class="menu-text"><strong>${esc(tr(LINK_TEMPLATES[k].fr, LINK_TEMPLATES[k].en))}</strong><small>${esc(linkHint(k))}</small></span></button>`;
      return `<div class="sheet-body">${back}<h3 class="sheet-title">${esc(tr(`Quel lien pour ${p.name} ?`, `Which link for ${p.name}?`))}</h3>
        ${guess ? `<p class="muted small">${esc(tr(`Proposés d’abord pour ${ctx.loc(guess.name)} :`, `Suggested first for ${ctx.loc(guess.name)}:`))}</p>` : ''}
        <div class="menu-grid">${first.map(item).join('')}</div>
        ${rest.length ? `<details><summary>${tr('Autres types de liens', 'Other link types')}</summary><div class="menu-grid">${rest.map(item).join('')}</div></details>` : ''}</div>`;
    }
    const t = LINK_TEMPLATES[l.kind];
    const others = game.players.filter(x => x.id !== p.id);
    const chips = t.max > 0 ? `<fieldset class="link-targets"><legend>${esc(t.min === t.max ? tr(`Qui est concerné ? Choisis ${t.min}.`, `Who is involved? Choose ${t.min}.`) : tr(`Qui est concerné ? De ${t.min} à ${t.max}.`, `Who is involved? ${t.min} to ${t.max}.`))}</legend><div class="player-picker">${others.map(x => `<button type="button" data-action="link-target" data-id="${x.id}" aria-pressed="${l.to.includes(x.id)}" data-focus="lt-${x.id}">${esc(x.name)}</button>`).join('')}</div></fieldset>`
      : `<p class="notice">${tr('Ses voisins vivants sont recalculés à chaque mort : ', 'Living neighbours are recomputed after each death: ')}<strong>${esc(neighbourIds(game, p.id).map(ctx.pname).join(tr(' et ', ' and ')) || '?')}</strong></p>`;
    let result = '';
    if (t.result === 'yesno') result = `<fieldset><legend>${esc(tr(...t.prompt))}</legend><div class="mode-switch" role="radiogroup">${['yes', 'no'].map(v => `<button type="button" role="radio" aria-checked="${l.result === v}" data-action="link-result" data-value="${v}" data-focus="lr-${v}">${v === 'yes' ? tr('Oui', 'Yes') : tr('Non', 'No')}</button>`).join('')}</div></fieldset>`;
    if (t.result === 'number') result = `<fieldset><legend>${tr('Combien de voisins maléfiques ?', 'How many evil neighbours?')}</legend><div class="mode-switch" role="radiogroup">${['0', '1', '2'].map(v => `<button type="button" role="radio" aria-checked="${l.result === v}" data-action="link-result" data-value="${v}" data-focus="lr-${v}">${v}</button>`).join('')}</div></fieldset>`;
    if (t.result === 'role') {
      const team = l.kind === 'oneof' ? oneofTeam(p.guess) : '';
      const pool = ctx.roles().filter(r => SHEET_TEAMS.includes(r.team) && (!team || r.team === team)).sort((a, b) => ctx.loc(a.name).localeCompare(ctx.loc(b.name), ctx.lang()));
      result = `<label>${l.kind === 'oneof' ? tr('Quel rôle ? (facultatif)', 'Which character? (optional)') : tr('Quel rôle a-t-il vu ? (facultatif)', 'Which character was shown? (optional)')}<select id="link-role"><option value="">${tr('Non précisé', 'Not specified')}</option>${pool.map(r => `<option value="${esc(r.id)}" ${l.roleId === r.id ? 'selected' : ''}>${esc(ctx.loc(r.name))}</option>`).join('')}</select></label>`;
    }
    return `<div class="sheet-body">${back}
      <h3 class="sheet-title">${esc(tr(t.fr, t.en))} <button type="button" class="link-button" data-action="link-restart" data-id="${p.id}">${tr('Changer de type', 'Change type')}</button></h3>
      <form id="link-form">${chips}${result}
        <label>${tr('Précision (facultatif)', 'Detail (optional)')}<input id="link-note" maxlength="300" value="${esc(l.note)}"></label>
        <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer le lien', 'Save link')}</button></div></form></div>`;
  }

  function linkHint(k) {
    const hints = {
      oneof: ['Lavandière, Bibliothécaire, Enquêteur : un des deux joueurs désignés a tel rôle.', 'Washerwoman, Librarian, Investigator: one of two players has that character.'],
      neighbours: ['Empathe : combien de voisins vivants sont maléfiques.', 'Empath: how many living neighbours are evil.'],
      'pick-demon': ['Voyante : deux joueurs désignés, un Démon parmi eux ou non.', 'Fortune Teller: two players picked, a Demon among them or not.'],
      'pick-same': ['Couturière : deux joueurs désignés, du même camp ou non.', 'Seamstress: two players picked, same alignment or not.'],
      learned: ['Fossoyeur, Gardien de corbeau : le rôle appris pour un joueur.', 'Undertaker, Ravenkeeper: the character learned for a player.'],
      protects: ['Moine, Aubergiste : qui est protégé.', 'Monk, Innkeeper: who is protected.'],
      related: ['Un lien libre entre ce joueur et d’autres.', 'A free link between this player and others.'],
      chosen: ['Ce joueur a choisi un ou plusieurs joueurs, la nuit ou le jour.', 'This player chose one or more players, by night or day.']
    };
    return tr(...(hints[k] || ['Un joueur lié à ce joueur par sa capacité.', 'A player linked to this one through their ability.']));
  }

  function saveLink(id) {
    const l = sheet.link;
    const t = LINK_TEMPLATES[l.kind];
    if (l.to.length < t.min || l.to.length > t.max) throw new Error(t.min === t.max ? tr(`Choisis ${t.min} joueur(s).`, `Choose ${t.min} player(s).`) : tr(`Choisis de ${t.min} à ${t.max} joueurs.`, `Choose ${t.min} to ${t.max} players.`));
    ctx.change(game => {
      if (game.links.length >= 400) throw new Error(tr('Trop de liens notés.', 'Too many links.'));
      game.links.push({id: ctx.uid(), kind: l.kind, from: id, to: [...l.to], roleId: l.roleId, result: l.result, note: l.note.trim(), day: game.day, phase: game.phase});
    }, tr('Lien noté', 'Link noted'));
    sheet.view = 'main';
    sheet.link = null;
    redraw();
  }

  // ---------- branchements après chaque dessin ----------
  function bind(d, p) {
    const note = d.querySelector('#note-text');
    if (note) note.oninput = () => { sheet.draft = note.value; };
    const form = d.querySelector('#note-form');
    if (form) form.onsubmit = e => {
      e.preventDefault();
      try {
        const text = note.value.trim();
        if (!text) throw new Error(tr('Écris la note avant de l’ajouter.', 'Write the note before adding it.'));
        const said = sheet.noteMode === 'said';
        ctx.change(game => { ctx.event(game, 'info', text, [p.id], said ? p.id : ''); }, tr('Note ajoutée', 'Note added'));
        sheet.draft = '';
        redraw();
        document.querySelector('#note-text')?.focus();
      } catch (err) { ctx.error(err.message); }
    };
    const edit = d.querySelector('#note-edit-form');
    if (edit) {
      d.querySelector('#note-edit-text').focus();
      edit.onsubmit = e => {
        e.preventDefault();
        try {
          const text = d.querySelector('#note-edit-text').value.trim();
          if (!text) throw new Error(tr('Une note ne peut pas être vide : supprime-la plutôt.', 'A note cannot be empty: delete it instead.'));
          ctx.change(game => { game.events.find(x => x.id === edit.dataset.id).text = text; }, tr('Note modifiée', 'Note edited'));
          sheet.editNote = '';
          redraw();
        } catch (err) { ctx.error(err.message); }
      };
    }
    const search = d.querySelector('#role-pick-search');
    if (search) {
      search.focus();
      search.oninput = () => {
        const q = ctx.fold(search.value);
        let shown = 0;
        for (const group of d.querySelectorAll('[data-group]')) {
          let any = false;
          for (const b of group.querySelectorAll('.role-opt')) { const hit = !q || b.dataset.search.includes(q); b.hidden = !hit; any = any || hit; if (hit) shown++; }
          group.hidden = !any;
        }
        d.querySelector('#role-pick-empty').hidden = shown > 0;
      };
    }
    const link = d.querySelector('#link-form');
    if (link) {
      link.onsubmit = e => { e.preventDefault(); try { saveLink(p.id); } catch (err) { ctx.error(err.message); } };
      const roleSelect = d.querySelector('#link-role');
      if (roleSelect) roleSelect.onchange = () => { sheet.link.roleId = roleSelect.value; };
      const noteInput = d.querySelector('#link-note');
      noteInput.oninput = () => { sheet.link.note = noteInput.value; };
    }
  }

  // ---------- actions ----------
  const actions = {
    brush: el => pickBrush(el.dataset.brush),
    camp: el => cycleCamp(el.dataset.id),
    'set-camp': el => { setCamp(el.dataset.id, el.dataset.camp); redraw(); },
    'toggle-effect': el => {
      const id = el.dataset.id, effect = el.dataset.effect;
      ctx.change(game => {
        const q = game.players.find(x => x.id === id);
        q.effects = q.effects.some(e => e.id === effect) ? q.effects.filter(e => e.id !== effect) : [...q.effects, {id: effect, day: game.day, phase: game.phase}];
      });
      redraw();
    },
    'sheet-role': el => { sheet = {...sheet, id: el.dataset.id, view: 'role'}; redraw(); },
    'set-guess': el => setGuess(el.dataset.id, el.dataset.role),
    'guess-from-claim': el => { const c = ctx.latestClaim(el.dataset.id); if (c?.roleIds.length === 1) setGuess(el.dataset.id, c.roleIds[0]); },
    'sheet-back': el => { sheet = {...sheet, id: el.dataset.id, view: 'main', link: null}; redraw(); },
    'note-mode': el => { const area = document.querySelector('#note-text'); if (area) sheet.draft = area.value; sheet.noteMode = el.dataset.mode; redraw(); },
    'note-edit': el => { sheet.editNote = el.dataset.event; redraw(); },
    'note-edit-cancel': () => { sheet.editNote = ''; redraw(); },
    'note-delete': el => {
      ctx.change(game => { game.events = game.events.filter(e => e.id !== el.dataset.event); }, tr('Note supprimée. ↶ pour annuler.', 'Note deleted. ↶ to undo.'));
      redraw();
    },
    'link-start': el => startLink(el.dataset.id, el.dataset.kind),
    'link-restart': el => startLink(el.dataset.id, ''),
    'link-kind': el => { sheet.link = {kind: el.dataset.kind, to: [], result: '', roleId: '', note: ''}; redraw(); },
    'link-target': el => {
      const l = sheet.link, t = LINK_TEMPLATES[l.kind], id = el.dataset.id;
      l.to = l.to.includes(id) ? l.to.filter(x => x !== id) : [...l.to, id].slice(-t.max);
      redraw();
    },
    'link-result': el => { sheet.link.result = sheet.link.result === el.dataset.value ? '' : el.dataset.value; redraw(); },
    'link-delete': el => {
      ctx.change(game => { game.links = game.links.filter(l => l.id !== el.dataset.link); }, tr('Lien supprimé. ↶ pour annuler.', 'Link deleted. ↶ to undo.'));
      redraw();
    }
  };

  function tapPlayer(id) {
    if (brush) { paint(id); return; }
    openSheet(id);
  }

  function noteEditDialog(eventId) {
    const e = g().events.find(x => x.id === eventId);
    if (!e) return;
    ctx.open(tr('Modifier la note', 'Edit the note'), `<form id="note-dialog-form"><label>${tr('Texte', 'Text')}<textarea name="text" rows="4" maxlength="2000">${esc(e.text)}</textarea></label><div class="dialog-footer">${ctx.button('close', tr('Annuler', 'Cancel'))}<button type="submit" class="primary">${tr('Enregistrer', 'Save')}</button></div></form>`, d => {
      d.querySelector('[name=text]').focus();
      d.querySelector('#note-dialog-form').onsubmit = ev => {
        ev.preventDefault();
        try {
          const text = new FormData(ev.target).get('text').toString().trim();
          if (!text) throw new Error(tr('Une note ne peut pas être vide.', 'A note cannot be empty.'));
          ctx.change(game => { game.events.find(x => x.id === eventId).text = text; }, tr('Note modifiée', 'Note edited'));
          ctx.close();
        } catch (err) { ctx.error(err.message); }
      };
    });
  }

  return {
    actions, brushBarHtml, startLine, seatRowHtml, openSheet, tapPlayer, cycleCamp, noteEditDialog, campDot,
    closeSheet() { sheet = null; document.querySelector('#dialog')?.classList.remove('sheet'); },
    brush: () => brush,
    resetBrush() { brush = ''; }
  };
}
