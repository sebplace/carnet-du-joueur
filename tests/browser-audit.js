// Sonde d audit : ce que /site a diagnostique en 2.1 doit rester vrai.
// Partage, indexation, repli sans JavaScript, hierarchie des titres, coût clavier.
async (page) => {
  const c = await page.context().browser().newContext({viewport:{width:390,height:844}});
  const p = await c.newPage(), checks = [], errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const check = (v, n) => { if (!v) throw new Error(n); checks.push(n); };
  const base = 'http://127.0.0.1:8794/';
  try {
    await p.goto(base + '?a=' + Date.now(), {waitUntil: 'networkidle'});

    // --- Partage : un lien colle sur Discord doit montrer quelque chose ---
    const meta = await p.evaluate(() => {
      const g = s => document.querySelector(s)?.content || '';
      return {
        ogTitle: g('meta[property="og:title"]'), ogDesc: g('meta[property="og:description"]'),
        ogImage: g('meta[property="og:image"]'), ogUrl: g('meta[property="og:url"]'),
        ogType: g('meta[property="og:type"]'), ogLocale: g('meta[property="og:locale"]'),
        ogW: g('meta[property="og:image:width"]'), ogH: g('meta[property="og:image:height"]'),
        ogAlt: g('meta[property="og:image:alt"]'),
        twCard: g('meta[name="twitter:card"]'), twImage: g('meta[name="twitter:image"]'),
        canonical: document.querySelector('link[rel=canonical]')?.href || ''
      };
    });
    check(meta.ogTitle.length > 10, 'le lien partage porte un titre');
    check(meta.ogDesc.length > 30, 'le lien partage porte une description');
    check(/^https:\/\/.+\.png$/.test(meta.ogImage), 'le lien partage porte une image absolue');
    check(meta.ogW === '1200' && meta.ogH === '630', 'les dimensions de l image sont annoncees');
    check(meta.ogAlt.length > 10, 'l image de partage a une alternative textuelle');
    check(meta.ogType === 'website' && meta.ogLocale === 'fr_FR', 'type et langue sont declares');
    check(meta.twCard === 'summary_large_image' && meta.twImage === meta.ogImage, 'la carte Twitter pointe la meme image');
    check(meta.canonical.startsWith('https://'), 'la page declare son URL canonique');
    // Aucun tiret cadratin dans les textes destines a l utilisateur.
    check(!/\u2014/.test(meta.ogTitle + meta.ogDesc), 'aucun tiret cadratin dans les textes de partage');

    // L image existe vraiment et fait le bon format.
    const img = await p.request.get(base + 'og.png');
    check(img.status() === 200, 'og.png est servie');
    check((await img.body()).length > 10000, 'og.png n est pas un fichier vide');

    // --- Indexation ---
    for (const [f, mot] of [['robots.txt', 'Sitemap'], ['sitemap.xml', '<urlset'], ['404.html', 'existe pas']]) {
      const r = await p.request.get(base + f);
      check(r.status() === 200, `${f} est servi`);
      check((await r.text()).includes(mot), `${f} a bien son contenu`);
    }
    const man = await (await p.request.get(base + 'manifest.webmanifest')).json();
    check(man.screenshots?.length >= 2, 'le manifeste montre des captures a l installation');
    check(man.categories?.length > 0 && man.shortcuts?.length > 0, 'le manifeste a categories et raccourcis');
    for (const s of man.screenshots) {
      const r = await p.request.get(base + s.src);
      check(r.status() === 200, `la capture ${s.src} existe vraiment`);
      check((s.label || '').length > 5, `la capture ${s.src} est decrite`);
    }

    // --- guide.html : 20 000 caracteres de contenu meritent des metadonnees ---
    await p.goto(base + 'guide.html?a=' + Date.now(), {waitUntil: 'networkidle'});
    const guide = await p.evaluate(() => ({
      desc: document.querySelector('meta[name=description]')?.content || '',
      og: document.querySelector('meta[property="og:title"]')?.content || '',
      canonical: document.querySelector('link[rel=canonical]')?.href || ''
    }));
    check(guide.desc.length > 30, 'le guide porte une description');
    check(guide.og.length > 5 && guide.canonical.startsWith('https://'), 'le guide porte partage et canonique');

    // --- Hierarchie des titres : aucun saut de niveau (WCAG 1.3.1) ---
    await p.goto(base + '?a=' + Date.now());
    await p.locator('[data-action=demo]').first().click();
    await p.locator('.player-card').first().waitFor();
    const cl = p.locator('#dialog .dialog-head [data-action=close]');
    if (await cl.count() && await cl.first().isVisible()) await cl.first().click();
    for (const v of ['table', 'journal', 'overview', 'script']) {
      await p.locator(`#nav [data-view="${v}"]`).click();
      await p.waitForTimeout(350);
      const saut = await p.evaluate(() => {
        const n = [...document.querySelectorAll('#main h1,#main h2,#main h3,#main h4')].map(h => +h.tagName[1]);
        for (let i = 1; i < n.length; i++) if (n[i] > n[i - 1] + 1) return `h${n[i - 1]} vers h${n[i]}`;
        return null;
      });
      check(saut === null, `la vue ${v} n enchaine aucun saut de niveau de titre`);
    }

    // --- Repere contentinfo, atteignable et pas enterre sous les barres fixes ---
    await p.locator('#nav [data-view=table]').click();
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(500);
    check(await p.evaluate(() => {
      const f = document.querySelector('footer');
      if (!f) return false;
      const tb = document.querySelector('#thumb-bar');
      const nav = document.querySelector('#nav');
      // Deux barres fixes peuvent recouvrir le bas : on prend la plus haute.
      const plafond = Math.min(
        tb && !tb.hidden ? tb.getBoundingClientRect().top : Infinity,
        nav.getBoundingClientRect().top
      );
      // TOUTES les lignes doivent etre lisibles, pas seulement la premiere.
      return [...f.querySelectorAll('p')].every(x => {
        const r = x.getBoundingClientRect();
        return r.top > 0 && r.bottom <= plafond;
      });
    }), 'le repere de bas de page reste lisible en entier au-dessus des barres fixes');

    // --- Cout clavier : on doit pouvoir sauter la liste des joueurs ---
    await p.locator('body').click({position: {x: 5, y: 5}});
    let rang = -1;
    for (let i = 0; i < 16; i++) {
      await p.keyboard.press('Tab');
      if ((await p.evaluate(() => (document.activeElement?.textContent || '').trim())).includes('Passer la liste')) { rang = i + 1; break; }
    }
    check(rang > 0, 'un lien permet de sauter la liste des joueurs');
    check(await p.evaluate(() => document.activeElement.getBoundingClientRect().left > -1000), 'ce lien devient visible quand il recoit le focus');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(300);
    await p.keyboard.press('Tab');
    check(!(await p.evaluate(() => (document.activeElement?.getAttribute('aria-label') || '').includes('Ouvrir'))), 'l activer fait bien sortir de la liste');

    // --- Cible tactile du lien de marque ---
    check(await p.evaluate(() => document.querySelector('.brand').getBoundingClientRect().height >= 44), 'le lien de marque atteint 44px de haut');

    // --- Repli sans JavaScript ---
    const cNo = await page.context().browser().newContext({viewport: {width: 390, height: 844}, javaScriptEnabled: false});
    const pNo = await cNo.newPage();
    try {
      await pNo.goto(base + '?nojs=' + Date.now());
      await pNo.waitForTimeout(400);
      const t = await pNo.evaluate(() => document.body.innerText);
      check(t.includes('JavaScript'), 'sans JavaScript, la page explique pourquoi elle ne s ouvre pas');
      check(!t.includes('Ouverture du carnet'), 'le message d attente trompeur a disparu');
      check(await pNo.locator('noscript').count() === 1, 'le repli vit dans une balise noscript');
    } finally { await cNo.close(); }

    // --- Economie visuelle : le chrome ne doit pas manger l ecran ---
    // Les eyebrows ALL CAPS au-dessus de chaque titre ne disaient rien
    // d actionnable, et l en-tete du tableau repetait trois fois la meme chose.
    for (const v of ['table', 'journal', 'overview', 'script']) {
      await p.locator(`#nav [data-view="${v}"]`).click();
      await p.waitForTimeout(350);
      check(await p.locator('#main .eyebrow').count() === 0, `la vue ${v} ne porte aucun libelle decoratif en capitales`);
    }
    await p.locator('#nav [data-view=overview]').click();
    await p.waitForTimeout(400);
    const entete = await p.evaluate(() => {
      // .sr-only est en position absolue : offsetParent ne suffit pas a le
      // declarer invisible. On mesure la surface reellement peinte.
      const visuel = el => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && getComputedStyle(el).clipPath === 'none';
      };
      const h1 = document.querySelector('#main h1')?.textContent.trim() || '';
      const actif = document.querySelector('[data-board-lens][aria-selected=true]')?.textContent.trim() || '';
      const h2 = [...document.querySelectorAll('.board-controls h2')];
      return {h1, actif, visibles: h2.filter(visuel).map(h => h.textContent.trim()), tous: h2.map(h => h.textContent.trim())};
    });
    check(!entete.visibles.includes(entete.actif), 'le nom de la lentille n est pas repete a l oeil sous son propre bouton');
    check(entete.tous.includes(entete.actif), 'mais il reste annonce aux lecteurs d ecran comme titre de section');
    check(!entete.visibles.some(t => t.includes(entete.h1)), 'le panneau ne repete pas le titre de la page');
    check(await p.locator('.board-selection').count() === 0, 'aucune pastille de selection tant que rien n est selectionne');
    check(await p.evaluate(() => !/probabilit/i.test(document.querySelector('#board-root')?.innerHTML || '')), 'le jargon retire de l affichage ne traine plus dans le DOM');

    // --- Graisses : 650, 750 et 900 rendaient exactement comme 700 et 800 ---
    check(await p.evaluate(() => {
      const vues = new Set();
      for (const el of document.querySelectorAll('*')) { if (!el.offsetParent) continue; vues.add(getComputedStyle(el).fontWeight); }
      return [...vues].every(w => ['300', '400', '600', '700', '800'].includes(w));
    }), 'la page n emploie que des graisses que la police rend reellement');

    check(errors.length === 0, 'aucune erreur navigateur: ' + errors.join(' | '));
    return {checks: checks.length, passed: checks, errors};
  } finally { await c.close(); }
}
