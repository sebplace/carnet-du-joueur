async(page)=>{
  const c=await page.context().browser().newContext({viewport:{width:390,height:844},colorScheme:'dark'});
  const p=await c.newPage(),checks=[],errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  const unlock=async()=>{
    await p.locator('#settings').click();
    for(let i=0;i<7;i++)await p.locator('#app-version').click();
    if(await p.locator('#dialog').evaluate(d=>d.open))await p.locator('#dialog .dialog-head [data-action=close]').click();
  };
  const viaMenu=async(action)=>{
    await p.locator('main [data-action=table-menu]').first().click();
    await p.locator(`#dialog [data-action="${action}"]`).first().click();
  };
  const check=(v,label)=>{if(!v)throw new Error(label);checks.push(label);};
  const state=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')));
  const view=async v=>p.locator(`#nav [data-view="${v}"]`).click();
  try{
    await p.goto('http://127.0.0.1:8794/');
    await p.locator('[data-action=demo]').first().click();
    await p.locator('.player-card').first().waitFor();
    await unlock();

    check(await p.evaluate(()=>Math.round(document.querySelector('#player-grid').getBoundingClientRect().top+scrollY))<520,'table grid starts high enough on a phone');

    await view('overview');
    await p.locator('[data-board-lens]').first().waitFor();
    const lenses=await p.locator('[data-board-lens]').evaluateAll(e=>e.map(x=>x.dataset.boardLens));
    check(lenses.join(',')==='timeline,grille','le tableau ne garde que deux lentilles primaires');
    const analytic=await p.locator('[data-board-analytic] option').evaluateAll(o=>o.map(x=>x.value).filter(Boolean));
    check(analytic.join(',')==='conflits,links','les analyses restent derriere un controle secondaire');
    check(!lenses.includes('matrix')&&!lenses.includes('round'),'la matrice et la table ronde ont disparu du tableau');

    for(const lens of ['timeline','grille','conflits','links']){
      await (['conflits','links'].includes(lens)?p.locator('[data-board-analytic]').selectOption(lens):p.locator(`[data-board-lens="${lens}"]`).click());
      await p.waitForTimeout(150);
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`la lentille ${lens} ne deborde pas a 390px`);
      check((await p.locator('#board-root').innerText()).length>30,`la lentille ${lens} affiche du contenu`);
    }

    await p.locator('[data-board-query]').fill('Empathe');
    await p.waitForTimeout(200);
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'la recherche du tableau ne casse pas la mise en page');
    await p.locator('[data-board-reset]').click();
    await p.locator('[data-board-lens=timeline]').click();

    await p.locator('main [data-action=estimate]').first().click();
    await p.locator('#confirm-action').click();
    await p.locator('#overview-estimates').filter({hasText:'%'}).waitFor({timeout:30000});
    const estimates=await p.locator('#overview-estimates').innerText();
    check(estimates.includes('Calcul complet')||estimates.includes('Estimation rapide'),'estimate method is stated in plain language');
    check(!estimates.includes('effectif efficace')&&!estimates.includes('ESS'),'statistical jargon is no longer front and centre');
    await p.locator('[data-board-lens=grille]').click();
    await p.waitForTimeout(250);
    check((await p.locator('#board-root').innerText()).includes('%'),'la grille joueur-personnage porte le resultat du modele');
    await p.locator('[data-board-lens=timeline]').click();

    await view('table');
    await viaMenu('coverage');
    check((await p.locator('#dialog').innerText()).includes('Ce n’est pas une simulation du jeu'),'les limites restent annoncees honnetement');
    await p.locator('#dialog [data-action=close]').click();
    await view('overview');

    // Privacy must work while a dialog is open, without losing typed input.
    await view('table');
    await p.locator('[data-action=round]').click();
    await p.locator('.ballot-chip').first().click();
    check((await p.locator('#ballot-summary').innerText()).includes('1 oui'),'un seul tap par main levee suffit');
    await p.locator('#dialog [data-action=mask]').click();
    check(await p.locator('#cover').evaluate(d=>d.open),'screen can be hidden from inside a dialog');
    check(await p.locator('#dialog').evaluate(d=>d.open),'hiding does not discard the open form');
    await p.locator('#uncover').click();
    check(await p.locator('.ballot-row').first().getAttribute('data-choice')==='yes','ballot input survives hiding');
    await p.locator('#dialog [data-action=close]').click();

    // Real notebook: incompatible characters must refuse the calculation.
    await p.locator('#settings').click();
    await p.locator('#dialog [data-action=new]').click();
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma');
    await p.locator('#new-form button[type=submit]').click();if(await p.locator('#dialog .onboarding').count()){await p.locator('#dialog .dialog-head [data-action=close]').click();}
    await unlock();
    await p.evaluate(()=>{
      const g=JSON.parse(localStorage.getItem('botc-player-notebook-v1'));
      g.script.roleIds.push('legion');
      g.estimateConsent=true;g.settings=Object.assign({},g.settings,{showEstimates:true});
      localStorage.setItem('botc-player-notebook-v1',JSON.stringify(g));
    });
    await p.reload();
    await view('overview');
    await p.locator('#overview-estimates').filter({hasText:'Legion'}).waitFor({timeout:20000});
    check(!(await p.locator('#overview-estimates').innerText()).includes('%'),'no percentage is produced for a structurally impossible script');

    // Filters must not survive into a different game.
    await view('table');
    await p.locator('#player-search').fill('Zzzz');
    check(await p.locator('.player-card').count()===0,'search filter applies');
    await p.locator('#settings').click();
    await p.locator('#dialog [data-action=new]').click();
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma');
    await p.locator('#new-form button[type=submit]').click();if(await p.locator('#dialog .onboarding').count()){await p.locator('#dialog .dialog-head [data-action=close]').click();}
    await unlock();
    check(await p.locator('.player-card').count()===5,'a new game is not hidden by the previous filter');

    // Archived seats must not be offered for brand new events.
    await viaMenu('roster');
    const gone=(await state()).players[4].id;
    await p.locator(`[data-remove-seat="${gone}"]`).click();
    await p.locator('#roster-add').click();
    await p.locator('[data-roster-name]').last().fill('Hugo');
    await p.locator('#roster-confirm').check();
    await p.locator('#roster-form button[type=submit]').click();
    await p.locator('[data-action=round]').click();
    const options=await p.locator('#dialog [name=target] option').evaluateAll(o=>o.map(x=>x.value));
    check(!options.includes(gone),'an archived seat is not selectable for a new event');
    await p.locator('#dialog [data-action=close]').click();

    check(errors.length===0,'no browser errors');
    return {checks:checks.length,passed:checks,errors};
  }finally{await c.close();}
}











