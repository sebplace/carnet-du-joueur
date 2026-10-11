// Composer un scénario à la main : cocher les rôles du catalogue, par type, ou en inventer un.
const GROUPS = [
  ['townsfolk', true], ['outsider', true], ['minion', true], ['demon', true],
  ['traveller', false], ['fabled', false]
];
const slug = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'role';

export function scriptBuilder(root, {catalogue, tr, lang, esc, loc, fold, teamName}) {
  const chosen = new Set();
  const homebrew = [];
  const known = new Set(catalogue.roles.map(r => r.id));
  let query = '';
  root.innerHTML = `
    <label>${tr('Nom du scénario', 'Scenario name')}<input id="sb-name" maxlength="120" value="${esc(tr('Scénario personnalisé', 'Custom scenario'))}"></label>
    <label>${tr('Partir d’un script existant', 'Start from an existing script')}<select id="sb-base"><option value="">${tr('Aucun, je coche moi-même', 'None, I tick them myself')}</option>${catalogue.scripts.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
    <p class="sb-count" aria-live="polite"><strong id="sb-total">0</strong> <span>${tr('rôle(s) choisi(s)', 'character(s) chosen')}</span></p>
    <label class="search">${tr('Chercher un rôle', 'Find a character')}<input id="sb-search" type="search" placeholder="${esc(tr('Nom français ou anglais', 'French or English name'))}"></label>
    <div id="sb-list"></div>
    <details class="sb-home"><summary>${tr('Un rôle absent de la liste ?', 'A character missing from the list?')}</summary>
      <div class="form-grid"><label>${tr('Nom', 'Name')}<input id="sb-home-name" maxlength="100"></label>
      <label>${tr('Type', 'Type')}<select id="sb-home-team">${['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'unknown'].map(t => `<option value="${t}">${esc(teamName(t))}</option>`).join('')}</select></label></div>
      <label>${tr('Capacité (facultatif)', 'Ability (optional)')}<textarea id="sb-home-ability" rows="2" maxlength="600"></textarea></label>
      <button type="button" id="sb-home-add">${tr('Ajouter ce rôle', 'Add this character')}</button>
      <ul id="sb-home-list" class="sb-home-list"></ul></details>`;
  const $ = s => root.querySelector(s);
  const teamRoles = team => catalogue.roles.filter(r => r.team === team).sort((a, b) => loc(a.name).localeCompare(loc(b.name), lang));
  const all = () => [...catalogue.roles, ...homebrew.map(h => ({...h}))];

  function draw() {
    const q = fold(query);
    $('#sb-total').textContent = String(chosen.size);
    const group = (team, open) => {
      const pool = [...teamRoles(team), ...homebrew.filter(h => h.team === team)];
      const shown = pool.filter(r => !q || fold(`${r.id} ${r.name.fr} ${r.name.en}`).includes(q));
      if (q && !shown.length) return '';
      const picked = pool.filter(r => chosen.has(r.id)).length;
      return `<details class="sb-group" ${open || q ? 'open' : ''} data-team="${team}"><summary><span>${esc(teamName(team))}</span><small>${picked}/${pool.length}</small></summary>
        <div class="sb-tools"><button type="button" data-sb-all="${team}">${tr('Tout cocher', 'Tick all')}</button><button type="button" data-sb-none="${team}">${tr('Tout décocher', 'Untick all')}</button></div>
        <div class="sb-grid">${shown.map(r => `<label class="role-check"><input type="checkbox" data-sb-role="${esc(r.id)}" ${chosen.has(r.id) ? 'checked' : ''}><span>${esc(loc(r.name))}</span></label>`).join('')}</div></details>`;
    };
    $('#sb-list').innerHTML = GROUPS.map(([team, open]) => group(team, open)).join('') + (homebrew.some(h => h.team === 'unknown') ? group('unknown', true) : '');
    $('#sb-home-list').innerHTML = homebrew.map(h => `<li><span>${esc(loc(h.name))} <small>${esc(teamName(h.team))}</small></span><button type="button" class="icon-button small-x" data-sb-remove="${esc(h.id)}" aria-label="${esc(tr('Retirer ', 'Remove ') + loc(h.name))}">×</button></li>`).join('');
  }

  root.addEventListener('change', e => {
    const box = e.target.closest('[data-sb-role]');
    if (box) { box.checked ? chosen.add(box.dataset.sbRole) : chosen.delete(box.dataset.sbRole); draw(); root.querySelector(`[data-sb-role="${CSS.escape(box.dataset.sbRole)}"]`)?.focus(); return; }
    if (e.target.id === 'sb-base') {
      const script = catalogue.scripts.find(s => s.id === e.target.value);
      chosen.clear();
      if (script) for (const id of script.roleIds) chosen.add(id);
      draw();
    }
  });
  root.addEventListener('click', e => {
    const all$ = e.target.closest('[data-sb-all]'), none = e.target.closest('[data-sb-none]'), remove = e.target.closest('[data-sb-remove]');
    if (all$ || none) {
      const team = (all$ || none).dataset.sbAll || (all$ || none).dataset.sbNone;
      for (const r of [...teamRoles(team), ...homebrew.filter(h => h.team === team)]) all$ ? chosen.add(r.id) : chosen.delete(r.id);
      draw();
    }
    if (remove) { const id = remove.dataset.sbRemove; homebrew.splice(homebrew.findIndex(h => h.id === id), 1); chosen.delete(id); draw(); }
    if (e.target.id === 'sb-home-add') {
      const name = $('#sb-home-name').value.trim();
      if (!name) { $('#sb-home-name').focus(); return; }
      let id = `x-${slug(name)}`, n = 2;
      while (known.has(id) || homebrew.some(h => h.id === id)) id = `x-${slug(name)}-${n++}`;
      const ability = $('#sb-home-ability').value.trim();
      homebrew.push({id, name: {fr: name, en: name}, team: $('#sb-home-team').value, ability: {fr: ability, en: ability}});
      chosen.add(id);
      $('#sb-home-name').value = ''; $('#sb-home-ability').value = '';
      draw();
    }
  });
  // Entrée dans un champ du constructeur ne doit pas créer la partie : le formulaire parent n'attend que son bouton.
  root.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    e.preventDefault();
    if (e.target.id === 'sb-home-name') $('#sb-home-add').click();
  });
  $('#sb-search').oninput = e => { query = e.target.value; draw(); };
  draw();

  return {
    count: () => chosen.size,
    // Le script produit suit le format du Script Tool : identifiants de rôles, rôles inconnus décrits à part.
    script() {
      const name = $('#sb-name').value.trim() || tr('Scénario personnalisé', 'Custom scenario');
      const order = all().filter(r => chosen.has(r.id));
      const custom = homebrew.filter(h => chosen.has(h.id)).map(h => ({id: h.id, name: h.name, team: h.team, ability: h.ability}));
      return {
        name,
        roleIds: order.map(r => r.id),
        customRoles: custom,
        warnings: custom.length ? [tr(`${custom.length} rôle(s) ajouté(s) à la main : texte descriptif uniquement, mécaniques non vérifiées.`, `${custom.length} character(s) added by hand: descriptive text only, mechanics unverified.`)] : []
      };
    }
  };
}
