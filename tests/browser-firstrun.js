// Parcours de premier usage 3.0 : ce qu'un joueur qui decouvre l'application voit et comprend.
async (page) => {
  const c = await page.context().browser().newContext({viewport: {width: 390, height: 844}, colorScheme: 'dark'});
  const p = await c.newPage(), checks = [], errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const check = (v, n) => { if (!v) throw new Error(n); checks.push(n); };
  const base = 'http://127.0.0.1:8794/';
  const closeDialog = async () => { if (await p.locator('#dialog').evaluate(d => d.open)) await p.locator('#dialog .dialog-head [data-action=close]').click(); };
  try {
    await p.goto(base);
    // --- accueil ---
    const welcome = await p.locator('#main').innerText();
    check(/Colorie, un tap par joueur/.test(welcome), 'l’accueil promet le geste principal : colorier d’un tap');
    check(/Une fiche par joueur/.test(welcome), 'l’accueil annonce la fiche du joueur');
    check(!/Tableau|Il me parle|⚡|Confiance|Soupçon/.test(welcome), 'l’accueil ne parle d’aucun écran ni bouton disparu');
    check(await p.locator('.hero-shot img').count() === 1, 'l’accueil montre une vraie capture');

    // --- démo ---
    await p.locator('[data-action=demo]').first().click();
    await p.locator('.plan-seat').first().waitFor();
    check(await p.locator('.try-list li').count() === 3, 'la démo propose trois choses à essayer');
    check(await p.locator('.plan-seat').count() === 7, 'la démo s’ouvre sur le plan');
    check((await p.locator('.try-list').innerText()).includes('pinceau rouge'), 'la démo enseigne le pinceau');
    await p.locator('[data-action=first-steps-done]').click();
    check(await p.locator('.first-steps').count() === 0, 'l’aide de la démo se ferme');
    check(await p.evaluate(() => localStorage.getItem('botc-player-first-steps')) === null, 'fermer l’aide de la démo ne touche pas la vraie partie');
    const demoText = await p.locator('#main').innerText();
    check(/Alice[\s\S]*Lavandière/.test(demoText) || await p.locator('.plan-seat-role').count() > 0, 'la démo affiche des rôles supposés');
    check(await p.locator('[data-plan-camp]').count() === 7 && await p.locator('.plan-camp-badge').count() === 7, 'chaque siège a sa pastille de camp');
    // la démo montre un effet et un lien
    check(/🧪/.test(await p.locator('.plan-svg').innerHTML()), 'la démo montre un effet sur le cadran');
    check(await p.locator('.plan-chord.plan-kind-link').count() >= 3, 'la démo dessine des liens de rôle');

    // --- vraie partie ---
    await p.locator('#settings').click();
    await p.locator('#dialog [data-action=leave-demo]').click().catch(() => {});
    await p.goto(base);
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.locator('[data-action=new]').first().click();
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma\nFarid\nGaëlle');
    await p.locator('#new-form button[type=submit]').click();
    await p.waitForTimeout(250);
    await closeDialog();
    check(await p.locator('.first-steps').count() === 1, 'une vraie première partie affiche l’aide de premier usage');
    check(/forme colorée/.test(await p.locator('.first-steps').innerText()), 'l’aide dit d’abord le geste de la couleur');
    check(await p.evaluate(() => document.querySelector('.first-steps').getBoundingClientRect().height) < 175, 'l’aide reste compacte');
    const planTop = await p.evaluate(() => document.querySelector('.plan-svg').getBoundingClientRect().top);
    check(planTop < 480, 'le plan commence dans la moitié haute de l’écran : ' + Math.round(planTop));
    await p.locator('[data-action=first-steps-done]').click();
    await p.reload();
    check(await p.locator('.first-steps').count() === 0, 'l’aide fermée ne revient pas');

    // --- barre de pinceau : texte lisible et décompte ---
    const brush = await p.locator('.brush').innerText();
    check(/Neutre[\s\S]*Bleu[\s\S]*Rouge[\s\S]*Orange[\s\S]*Mort/.test(brush), 'les cinq pinceaux sont nommés en toutes lettres');
    check((await p.locator('.brush-hint').innerText()).length > 20, 'une phrase dit quoi faire du pinceau');

    // --- vocabulaire et mode d'emploi ---
    await p.locator('main [data-action=table-menu]').first().click();
    await p.locator('#dialog [data-action=glossary]').click();
    const glossary = await p.locator('#dialog').innerText();
    for (const mot of ['Pastille de couleur', 'Pinceau', 'Rôle supposé', 'Effets', 'Lien', 'Il m’a dit', 'Scénario personnalisé']) check(glossary.includes(mot), `le vocabulaire explique « ${mot} »`);
    check(!/Tableau|Il me parle|⚡|🗣/.test(glossary), 'le vocabulaire ne décrit aucun bouton disparu');
    await closeDialog();
    await p.locator('main [data-action=table-menu]').first().click();
    await p.locator('#dialog [data-action=summary]').click();
    const summary = await p.locator('#summary-text').inputValue();
    check(summary.split('\n').length === 8 && /01 Alice/.test(summary), 'le résumé donne une ligne par joueur : ' + summary.split('\n').length);
    await closeDialog();

    // --- accueil de la fiche : tout est nommé ---
    await p.locator('[data-plan-seat] .plan-disc').nth(1).click();
    const sheet = await p.locator('#dialog').innerText();
    for (const mot of ['Camp', 'Rôle supposé', 'Effets', 'Notes', 'Liens', 'Statut', 'Neutre', 'Bleu', 'Rouge', 'Orange', 'Empoisonné', 'Hors-la-loi']) check(sheet.includes(mot), `la fiche affiche « ${mot} »`);
    const iconOnly = await p.evaluate(() => [...document.querySelectorAll('#dialog button')].filter(b => b.offsetParent && !(b.textContent || '').trim().replace(/[^\p{L}\p{N}]/gu, '') && !b.getAttribute('aria-label')).length);
    check(iconOnly === 0, 'aucun bouton de la fiche sans mot ni nom accessible');
    await closeDialog();

    // --- aucun tiret cadratin dans les textes visibles ---
    let cadratins = [];
    for (const v of ['table', 'journal', 'script']) {
      await p.locator(`#nav [data-view=${v}]`).click();
      await p.waitForTimeout(150);
      const lines = (await p.locator('#main').innerText()).split('\n').filter(l => /\u2014/.test(l) && l.trim() !== '\u2014');
      cadratins = cadratins.concat(lines);
    }
    check(cadratins.length === 0, 'aucun tiret cadratin dans les écrans : ' + cadratins.join(' | '));

    // --- toute section repliable porte sa flèche ---
    await p.locator('#nav [data-view=table]').click();
    await p.locator('[data-action=new]').count();
    await p.locator('#settings').click();
    await p.locator('#dialog [data-action=new]').click();
    await p.locator('#new-form [name=script]').selectOption('custom');
    const sansFleche = await p.evaluate(() => [...document.querySelectorAll('#dialog summary')].filter(s => s.offsetParent && getComputedStyle(s, '::after').content === 'none').length);
    check(sansFleche === 0, 'les sections repliables du nouveau scénario ont toutes leur flèche');
    await closeDialog();

    check(errors.length === 0, 'aucune erreur navigateur: ' + errors.join(' | '));
    return {checks: checks.length, passed: checks, errors};
  } finally { await c.close(); }
}
