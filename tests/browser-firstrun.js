// Parcours de premier usage : ce qu'un joueur qui decouvre l'application voit et comprend.
// Retour utilisateur d'octobre : « pas intuitive au premier abord, j'ai du chercher ou aller ».
async (page) => {
  const base = 'http://127.0.0.1:8794/';
  const c = await page.context().browser().newContext({viewport: {width: 390, height: 844}});
  const p = await c.newPage(), checks = [], errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const check = (v, n) => { if (!v) throw new Error(n); checks.push(n); };
  const BLOCKLIST = /calcul|estimation|estimé|probabilit|pourcentage|percentage|hypothèse|hypothesis|solveur|solver|statistiq|oracle|modèle|monde compatible/i;
  try {
    await p.goto(base + '?fr=' + Date.now(), {waitUntil: 'networkidle'});
    await p.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); localStorage.clear(); });
    await p.goto(base + '?fr2=' + Date.now(), {waitUntil: 'networkidle'});

    // --- Un nouveau joueur cree sa partie ---
    await p.locator('[data-action=new]').first().click();
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma\nFarid\nGaëlle');
    await p.locator('#new-form button[type=submit]').click();
    await p.waitForTimeout(500);
    check(!(await p.locator('#dialog').evaluate(d => d.open)), 'aucune fenetre ne s interpose entre la creation et la table');

    // --- L aide est SUR la table, et compacte ---
    check(await p.locator('.first-steps').count() === 1, 'une aide de premier usage est posee sur la table');
    const aide = await p.evaluate(() => {
      const s = document.querySelector('.first-steps').getBoundingClientRect();
      const nav = document.querySelector('#nav').getBoundingClientRect();
      const j = document.querySelector('.player-card').getBoundingClientRect();
      return {h: Math.round(s.height), premierJoueurVisible: j.top < nav.top - 40};
    });
    check(aide.h <= 220, `l aide reste compacte (${aide.h}px)`);
    check(aide.premierJoueurVisible, 'le premier joueur reste visible au premier ecran malgre l aide');

    // --- Les trois colonnes d icones ont enfin un mot, aligne ---
    const cols = await p.evaluate(() => {
      const mots = [...document.querySelectorAll('.seat-cols span')].map(s => s.textContent.replace(/\s+/g, ' ').trim());
      const entetes = [...document.querySelectorAll('.seat-cols span')].map(s => s.getBoundingClientRect());
      const boutons = [...document.querySelector('.player-card').querySelectorAll('.seat-act')].map(b => b.getBoundingClientRect());
      return {mots, decalage: entetes.map((r, i) => Math.abs(Math.round(r.left + r.width / 2 - (boutons[i].left + boutons[i].width / 2))))};
    });
    check(cols.mots.length === 3, 'trois colonnes sont nommees');
    check(/Parle/.test(cols.mots[0]) && /Rôle/.test(cols.mots[1]) && /Mort/.test(cols.mots[2]), 'les mots sont Parle, Rôle et Mort');
    check(cols.decalage.every(d => d <= 2), 'chaque mot est aligne sur son icone (' + cols.decalage.join(',') + 'px)');
    check(await p.locator('.seat-legend b').count() === 0, 'la legende cachee sous les barres fixes a disparu');

    // --- Une seule appellation pour l action ⚡ ---
    const noms = await p.evaluate(() => ({
      barre: document.querySelector('.thumb-main').textContent.trim(),
      titre: document.querySelector('.player-card [data-action=express]').title,
      aria: document.querySelector('.player-card [data-action=express]').getAttribute('aria-label')
    }));
    check(/Il me parle/.test(noms.barre), 'le grand bouton du bas s appelle Il me parle');
    check(noms.titre === 'Il me parle', 'l info-bulle de la ligne dit Il me parle');
    check(noms.aria.startsWith('Il me parle'), 'le nom accessible commence par Il me parle');
    await p.locator('.player-card [data-action=express]').first().click();
    await p.waitForTimeout(300);
    check((await p.locator('#dialog-title').innerText()) === 'Il me parle', 'la fenetre ouverte porte le meme nom que le bouton');
    await p.locator('#dialog .dialog-head [data-action=close]').click();
    const tout = await p.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.title || '')).join(' '));
    check(!/« ?Me parle ?»|Noter ce que dit|Saisie rapide/.test(tout), 'les anciens noms de cette action ont disparu');

    // --- Le vocabulaire est a portee, de deux endroits ---
    await p.locator('.first-steps [data-action=glossary]').click();
    await p.waitForTimeout(300);
    const gl = await p.evaluate(() => ({titre: document.querySelector('#dialog-title').textContent, termes: [...document.querySelectorAll('#dialog dt')].map(d => d.textContent.trim()), texte: document.querySelector('#dialog').innerText}));
    check(gl.titre === 'Vocabulaire', 'l aide mene au vocabulaire');
    check(gl.termes.length >= 12, `le vocabulaire couvre ${gl.termes.length} termes`);
    for (const mot of ['Conteur', 'Grimoire', 'Siège', 'Script', 'Déclaration', 'Indice', 'Exécution']) check(gl.termes.some(t => t.includes(mot)), `le vocabulaire definit « ${mot} »`);
    check(!BLOCKLIST.test(gl.texte), 'le vocabulaire ne trahit pas l outil prive');
    check(!/\u2014/.test(gl.texte), 'aucun tiret cadratin dans le vocabulaire');
    await p.locator('#dialog .dialog-head [data-action=close]').click();
    await p.locator('main [data-action=table-menu]').first().click();
    check(await p.locator('#dialog [data-action=glossary]').count() === 1, 'le menu Outils garde un acces permanent au vocabulaire');
    await p.locator('#dialog .dialog-head [data-action=close]').click();

    // --- L aide se rejette une fois pour toutes ---
    await p.locator('.first-steps [data-action=first-steps-done]').click();
    await p.waitForTimeout(250);
    check(await p.locator('.first-steps').count() === 0, 'l aide disparait quand on l a comprise');
    check(await p.evaluate(() => document.activeElement && document.activeElement.id === 'main'), 'le focus clavier n est pas perdu quand l aide disparait');
    await p.reload();
    await p.locator('.player-card').first().waitFor();
    check(await p.locator('.first-steps').count() === 0, 'elle ne revient pas apres rechargement');

    // --- Le Tableau d un carnet vierge ne ment plus ---
    await p.locator('#nav [data-view=overview]').click();
    await p.waitForTimeout(400);
    const vierge = await p.locator('#board-root').innerText();
    check(!/filtre/i.test(vierge), 'le Tableau vierge ne parle pas de filtres');
    check(/Rien de noté/.test(vierge), 'il dit que rien n est encore note');
    await p.locator('#board-root [data-view=table]').click();
    await p.waitForTimeout(300);
    check(await p.locator('#player-grid').count() === 1, 'et propose de retourner a la table');

    // --- Mais un vrai filtre sans resultat garde son message ---
    await p.locator('main [data-action=table-menu]').first().click();
    await p.locator('#dialog .dialog-head [data-action=close]').click();
    await p.locator('.player-card [data-action=express]').first().click();
    await p.locator('#dialog [name=text]').fill('Empathe 1');
    await p.locator('#express-form button[type=submit]').click();
    await p.waitForTimeout(300);
    await p.locator('#nav [data-view=overview]').click();
    await p.waitForTimeout(300);
    await p.locator('[data-board-query]').fill('zzzzzz');
    await p.waitForTimeout(300);
    check(/filtre/i.test(await p.locator('#board-root').innerText()), 'un filtre sans resultat garde son vrai message');

    // --- Anglais ---
    await p.locator('#settings').click();
    await p.locator('#language').selectOption('en');
    await p.locator('#dialog .dialog-head [data-action=close]').click();
    await p.locator('#nav [data-view=table]').click();
    await p.waitForTimeout(300);
    const en = await p.evaluate(() => ({barre: document.querySelector('.thumb-main').textContent.trim(), cols: [...document.querySelectorAll('.seat-cols span')].map(s => s.textContent.replace(/\s+/g, ' ').trim()).join('|')}));
    check(/Talks to me/.test(en.barre), 'en anglais le grand bouton dit Talks to me');
    check(/Talks/.test(en.cols) && /Role/.test(en.cols) && /Dead/.test(en.cols), 'en anglais les colonnes sont Talks, Role, Dead');

    // --- Aucun debordement ---
    for (const w of [320, 390]) {
      await p.setViewportSize({width: w, height: 844});
      await p.waitForTimeout(250);
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `la table tient en ${w}px avec ses colonnes nommees`);
    }
    check(errors.length === 0, 'aucune erreur navigateur: ' + errors.join(' | '));
    return {checks: checks.length, passed: checks, errors};
  } finally { await c.close(); }
}
