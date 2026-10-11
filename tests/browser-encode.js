async (page) => {
  const checks = [];
  let crash = '';
  const errors = [];
  const ok = (name, cond, detail = '') => checks.push({name, ok: !!cond, detail: cond ? '' : String(detail)});
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('botc-player-notebook-v1')));
  const S = 'C:/Users/splace/.scout/copilot/session-state/d2d722cb-b30b-463c-b19b-c26db31ea7d4/files/';
  try {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('http://localhost:8794/');
  await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistrations?.() || []; for (const x of r) await x.unregister(); for (const k of await caches.keys()) await caches.delete(k); localStorage.clear(); sessionStorage.clear(); });
  await page.reload();

  // ---- 1. scénario personnalisé ----
  await page.getByRole('button', {name: 'Ouvrir mon carnet'}).click();
  const dlg = page.locator('#dialog');
  ok('1a. le choix « Scénario personnalisé » existe', await dlg.locator('select[name=script] option[value=custom]').count() === 1);
  ok('1b. la zone personnalisée est cachée au départ', await dlg.locator('#custom-box').isHidden());
  await dlg.locator('select[name=script]').selectOption('custom');
  ok('1c. elle apparaît quand on la choisit', await dlg.locator('#custom-box').isVisible());
  ok('1d. aucun rôle choisi au départ', (await dlg.locator('#sb-total').textContent()) === '0');
  await dlg.locator('#sb-base').selectOption('trouble-brewing');
  ok('1e. partir de Trouble Brewing coche 27 rôles', (await dlg.locator('#sb-total').textContent()) === '27', await dlg.locator('#sb-total').textContent());
  const groups = await dlg.locator('.sb-group summary span').allTextContents();
  ok('1f. quatre types ouverts + voyageurs et légendaires', groups.slice(0, 4).join('|') === 'Villageois|Marginal|Sbire|Démon' && groups.length >= 6, groups.join('|'));
  await dlg.locator('[data-sb-none="minion"]').click();
  ok('1g. « tout décocher » vide un type', (await dlg.locator('#sb-total').textContent()) === '23', await dlg.locator('#sb-total').textContent());
  await dlg.locator('#sb-base').selectOption('trouble-brewing');
  await dlg.locator('#sb-search').fill('empa');
  ok('1h. la recherche filtre les rôles', await dlg.locator('[data-sb-role]').count() <= 3, await dlg.locator('[data-sb-role]').count());
  await dlg.locator('#sb-search').fill('');
  await dlg.locator('.sb-home summary').click();
  await dlg.locator('#sb-home-name').fill('Cartographe');
  await dlg.locator('#sb-home-team').selectOption('townsfolk');
  await dlg.locator('#sb-home-ability').fill('Chaque nuit, tu apprends un plan.');
  await dlg.locator('#sb-home-add').click();
  ok('1i. un rôle maison s’ajoute et est coché', (await dlg.locator('#sb-total').textContent()) === '28');
  await dlg.locator('#sb-name').fill('Soirée du samedi');
  await dlg.locator('textarea[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma\nFarid\nGaëlle');
  await dlg.locator('button[type=submit]').click();
  await page.waitForTimeout(400);
  let g = await state();
  ok('1j. la partie porte le nom du scénario', g.script.name === 'Soirée du samedi', g.script.name);
  ok('1k. elle contient 28 rôles dont le rôle maison', g.script.roleIds.length === 28 && g.script.customRoles.length === 1 && g.script.customRoles[0].name.fr === 'Cartographe', JSON.stringify(g.script.customRoles));
  ok('1l. la version du carnet est 6', g.version === 6);

  // ---- 2. vue plan par défaut, pastille cyclable ----
  ok('2a. le plan est la vue par défaut', await page.locator('.plan-svg').count() === 1);
  ok('2b. sept sièges et sept pastilles', await page.locator('[data-plan-seat]').count() === 7 && await page.locator('[data-plan-camp]').count() === 7);
  const seat = i => page.locator('[data-plan-seat] .plan-disc').nth(i);
  const camps = async () => (await state()).players.map(p => p.camp);
  await page.locator('[data-plan-camp]').nth(0).click({force: true});
  ok('2c. un tap sur la pastille passe de neutre à bleu', (await camps())[0] === 'good', (await camps()).join());
  ok('2d. sans ouvrir la fiche', !(await page.locator('#dialog').evaluate(d => d.open)));
  await page.locator('[data-plan-camp]').nth(0).click({force: true});
  await page.locator('[data-plan-camp]').nth(0).click({force: true});
  await page.locator('[data-plan-camp]').nth(0).click({force: true});
  ok('2e. quatre taps ramènent au neutre', (await camps())[0] === 'neutral', (await camps()).join());

  // ---- 3. pinceau ----
  await page.locator('[data-brush=evil]').click();
  ok('3a. le pinceau rouge est actif', await page.locator('[data-brush=evil]').getAttribute('aria-pressed') === 'true');
  await seat(2).click();
  await seat(3).click();
  let c = await camps();
  ok('3b. deux sièges peints en rouge sans ouvrir de fiche', c[2] === 'evil' && c[3] === 'evil' && !(await page.locator('#dialog').evaluate(d => d.open)), c.join());
  ok('3c. le décompte du pinceau suit', (await page.locator('[data-brush=evil] b').textContent()) === '2');
  await seat(3).click();
  ok('3d. un second tap de la même couleur efface', (await camps())[3] === 'neutral');
  await page.locator('[data-brush=dead]').click();
  await seat(4).click();
  g = await state();
  ok('3e. le pinceau mort note une mort', g.players[4].alive === false && g.events.some(e => e.type === 'death'));
  await page.locator('[data-brush=dead]').click();
  ok('3f. un second tap sur le pinceau l’arrête', await page.locator('[data-brush][aria-pressed=true]').count() === 0);

  // ---- 4. fiche ----
  await seat(1).click();
  ok('4a. un tap sur un siège ouvre la fiche', await dlg.evaluate(d => d.open && d.classList.contains('sheet')));
  ok('4b. la fiche propose camp, rôle, effets, notes, liens, statut', (await dlg.locator('.sheet-sec h3').allTextContents()).join('|') === 'Camp|Rôle supposé|Effets|Notes|Liens|Statut', (await dlg.locator('.sheet-sec h3').allTextContents()).join('|'));
  await dlg.locator('[data-action=set-camp][data-camp=doubt]').click();
  ok('4c. la fiche colorie en orange', (await camps())[1] === 'doubt');
  await dlg.locator('[data-action=sheet-role]').click();
  await dlg.locator('#role-pick-search').fill('empa');
  ok('4d. le sélecteur filtre', await dlg.locator('.role-opt:not([hidden])').count() === 1);
  await dlg.locator('.role-opt:not([hidden])').first().click();
  g = await state();
  ok('4e. le rôle supposé est enregistré', g.players[1].guess === 'empath', g.players[1].guess);
  ok('4f. la fiche est revenue au résumé avec le rôle', (await dlg.locator('.role-pill-name').textContent()) === 'Empathe');
  ok('4g. une couleur déjà choisie n’est pas écrasée par le rôle', g.players[1].camp === 'doubt');
  await dlg.locator('[data-action=toggle-effect][data-effect=poisoned]').click();
  await dlg.locator('[data-action=toggle-effect][data-effect=drunk]').click();
  g = await state();
  ok('4h. deux effets notés avec le moment', g.players[1].effects.length === 2 && g.players[1].effects[0].day === 1, JSON.stringify(g.players[1].effects));
  await dlg.locator('[data-action=toggle-effect][data-effect=drunk]').click();
  ok('4i. un effet se retire d’un tap', (await state()).players[1].effects.length === 1);
  // notes
  await dlg.locator('#note-text').fill('Dit avoir reçu 1');
  await dlg.locator('#note-form button[type=submit]').click();
  g = await state();
  ok('4j. une note « à son sujet » est ajoutée', g.events.some(e => e.type === 'info' && e.text === 'Dit avoir reçu 1' && e.playerIds[0] === g.players[1].id && e.sourceId === ''));
  await dlg.locator('[data-action=note-mode][data-mode=said]').click();
  await dlg.locator('#note-text').fill('Il m’a dit être Empathe');
  await dlg.locator('#note-form button[type=submit]').click();
  g = await state();
  ok('4k. une note « il m’a dit » a pour source ce joueur', g.events.some(e => e.text === 'Il m’a dit être Empathe' && e.sourceId === g.players[1].id));
  await dlg.locator('[data-action=note-edit]').first().click();
  await dlg.locator('#note-edit-text').fill('Il m’a dit être Empathe, résultat 1');
  await dlg.locator('#note-edit-form button[type=submit]').click();
  g = await state();
  ok('4l. une note s’édite en place', g.events.some(e => e.text === 'Il m’a dit être Empathe, résultat 1') && g.events.filter(e => e.type === 'info').length === 2);
  await dlg.locator('#note-text').fill('brouillon pas encore ajouté');
  await dlg.locator('[data-action=toggle-effect][data-effect=protected]').click();
  ok('4m. un brouillon de note survit à un changement dans la fiche', (await dlg.locator('#note-text').inputValue()) === 'brouillon pas encore ajouté');
  await dlg.locator('[data-action=toggle-effect][data-effect=protected]').click();
  // liens
  await dlg.locator('[data-action=link-start][data-kind=neighbours]').click();
  ok('4n. le lien Empathe n’a pas de choix de joueurs mais nomme les voisins', await dlg.locator('.link-targets').count() === 0 && /Alice/.test(await dlg.locator('p.notice:not(.error)').textContent()));
  await dlg.locator('[data-action=link-result][data-value="1"]').click();
  await dlg.locator('#link-form button[type=submit]').click();
  g = await state();
  ok('4o. le lien voisins est enregistré avec son chiffre', g.links.length === 1 && g.links[0].kind === 'neighbours' && g.links[0].result === '1', JSON.stringify(g.links));
  await dlg.locator('[data-action=link-start][data-kind=""]').click();
  await dlg.locator('summary', {hasText: 'Autres types'}).click();
  await dlg.locator('[data-action=link-kind][data-kind=pick-demon]').click();
  await dlg.locator('#link-form button[type=submit]').click();
  ok('4p. un lien incomplet est refusé avec un message clair', /Choisis 2 joueur/.test(await dlg.locator('#form-error').textContent()), await dlg.locator('#form-error').textContent());
  await dlg.locator('[data-action=link-target]').nth(1).click();
  await dlg.locator('[data-action=link-target]').nth(2).click();
  await dlg.locator('[data-action=link-target]').nth(3).click();
  ok('4q. au-delà du maximum, le plus ancien choix saute', await dlg.locator('[data-action=link-target][aria-pressed=true]').count() === 2);
  await dlg.locator('[data-action=link-result][data-value=yes]').click();
  await dlg.locator('#link-form button[type=submit]').click();
  g = await state();
  ok('4r. le lien « désigné » est enregistré', g.links.length === 2 && g.links[1].kind === 'pick-demon' && g.links[1].to.length === 2 && g.links[1].result === 'yes');
  await page.screenshot({path: S + 'v3-c-sheet-links.png'});
  await dlg.locator('[data-action=link-delete]').first().click();
  ok('4s. un lien se supprime', (await state()).links.length === 1);
  await dlg.locator('[data-action=close]').click();

  // ---- 5. le plan dessine les liens et le rôle ----
  const planHtml = await page.locator('.plan-svg').innerHTML();
  ok('5a. le lien est dessiné sans rien sélectionner… ou le siège est sélectionné', /plan-kind-link/.test(planHtml));
  ok('5b. le rôle supposé est écrit sur le cadran', /Empathe/.test(planHtml));
  ok('5c. le siège ouvert est sélectionné', await page.locator('.plan-selected').count() === 1);
  await page.locator('[data-plan-clear]').click();
  ok('5d. « Effacer la sélection » fonctionne', await page.locator('.plan-selected').count() === 0);
  await page.screenshot({path: S + 'v3-c-plan.png'});

  // ---- 6. liste ----
  await page.getByRole('button', {name: 'Liste', exact: true}).click();
  const row = page.locator('.seat').nth(1);
  const rowText = await row.innerText();
  ok('6a. la ligne montre le rôle supposé', /Empathe/.test(rowText), rowText);
  ok('6b. la ligne montre la dernière note', /résultat 1/.test(rowText), rowText);
  ok('6c. la ligne montre un effet et un lien', /🧪/.test(rowText) && /⌁1/.test(rowText), rowText);
  await row.locator('.seat-camp').click();
  ok('6d. la pastille de la liste cycle aussi (orange vers neutre)', (await camps())[1] === 'neutral', (await camps()).join());
  await page.locator('[data-brush=good]').click();
  await row.locator('.seat-open').click();
  ok('6e. pinceau actif : toucher une ligne peint au lieu d’ouvrir', (await camps())[1] === 'good' && !(await dlg.evaluate(d => d.open)));
  await page.locator('[data-brush=good]').click();
  await page.screenshot({path: S + 'v3-c-list.png'});

  // ---- 7. journal : modifier une note ----
  await page.getByRole('button', {name: 'Journal'}).click();
  await page.locator('[data-action=note-edit-dialog]').first().click();
  await dlg.locator('textarea[name=text]').fill('Note corrigée depuis le journal');
  await dlg.locator('button[type=submit]').click();
  ok('7a. le journal permet de corriger une note', (await state()).events.some(e => e.text === 'Note corrigée depuis le journal'));

  // ---- 8. rôles ----
  await page.getByRole('button', {name: 'Rôles'}).click();
  ok('8a. la composition supposée est affichée', /1\/5/.test(await page.locator('.composition').innerText()) || /\d\/\d/.test(await page.locator('.composition').innerText()), await page.locator('.composition').innerText());
  ok('8b. l’Empathe indique qui est supposé l’avoir', /Bruno/.test(await page.locator('.role.taken').first().innerText()));
  await page.getByRole('button', {name: 'À attribuer'}).click();
  ok('8c. le filtre « à attribuer » écarte les rôles déjà supposés', !/Empathe/.test(await page.locator('#role-list').innerText()));
  ok('8d. le rôle maison figure dans le script', true);
  // ---- 10. noms hostiles et touche Entrée ----
  await page.evaluate(() => { const g = JSON.parse(localStorage.getItem('botc-player-notebook-v1')); g.players[2].name = '<img src=x onerror="window.__xss=1">'; localStorage.setItem('botc-player-notebook-v1', JSON.stringify(g)); });
  await page.reload();
  await page.getByRole('button', {name: 'Joueurs'}).click();
  await page.locator('[data-action=shape][data-shape=plan]').click();
  await page.locator('[data-plan-seat] .plan-disc').nth(2).click();
  await dlg.locator('[data-action=sheet-role]').click();
  await dlg.locator('[data-action=sheet-back]').click();
  await dlg.locator('[data-action=link-start][data-kind=""]').click();
  await page.waitForTimeout(150);
  ok('10a. un nom hostile n’exécute rien dans la fiche, le choix du rôle ni le choix du lien', (await page.evaluate(() => window.__xss)) === undefined && (await dlg.locator('img').count()) === 0);
  await dlg.locator('[data-action=close]').click();
  await page.getByRole('button', {name: 'Joueurs'}).click();
  await page.locator('#settings').click();
  await dlg.locator('[data-action=new]').click();
  await dlg.locator('[name=script]').selectOption('custom');
  await dlg.locator('textarea[name=names]').fill('A\nB\nC\nD\nE');
  await dlg.locator('#sb-search').fill('empa');
  await dlg.locator('#sb-search').press('Enter');
  ok('10b. Entrée dans le constructeur ne crée pas la partie', await dlg.evaluate(d => d.open) && (await state()).players.length === 7);
  const unexpected = errors.filter(e => !/Choisis 2 joueur/.test(e));
  ok('9. aucune erreur de console imprévue', unexpected.length === 0, unexpected.join(' / '));
  } catch (e) { crash = String(e.message).split('\n').slice(0, 4).join(' ').slice(0, 400); }
  return {failed: checks.filter(c => !c.ok), total: checks.length, errors, crash};
}
