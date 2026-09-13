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
    await p.locator('[data-board-row]').first().waitFor();
    check(await p.locator('[data-board-row]').count()===7,'matrix shows every seat without pagination');
    const lenses=await p.locator('[data-board-lens]').evaluateAll(e=>e.map(x=>x.dataset.boardLens));
    check(lenses.join(',')==='matrix,round,timeline','three primary lenses stay reachable');
    const analytic=await p.locator('[data-board-analytic] option').evaluateAll(o=>o.map(x=>x.value).filter(Boolean));
    check(analytic.join(',')==='grille,conflits,links','analytical lenses live behind a secondary control');

    for(const lens of ['matrix','round','timeline','grille','conflits','links']){
      await (['grille','conflits','links'].includes(lens)?p.locator('[data-board-analytic]').selectOption(lens):p.locator(`[data-board-lens="${lens}"]`).click());
      await p.waitForTimeout(120);
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${lens} lens has no page overflow at 390px`);
    }

    await p.locator('[data-board-lens=round]').click();
    check(await p.locator('.board-round-node').count()===7,'round table mirrors the real seating');
    await p.locator('.board-round-node').nth(2).click();
    const selectedId=await p.evaluate(()=>JSON.parse(document.querySelector('[data-board-selected-debug]')?.textContent||'null'));
    check(await p.locator('.board-round-node.selected').count()===1,'selecting a seat highlights exactly one node');
    await p.locator('[data-board-lens=matrix]').click();
    check(await p.locator('[data-board-row].selected').count()===1,'selection is shared across lenses');
    await p.locator('[data-board-reset]').click();
    check(await p.locator('[data-board-row].selected').count()===0,'reset clears the shared selection');

    await p.locator('[data-board-query]').fill('Empathe');
    await p.waitForTimeout(150);
    check(await p.locator('[data-board-row]').count()>0,'query keeps a usable matrix');
    await p.locator('[data-board-reset]').click();

    await p.locator('[data-board-lens=timeline]').click();
    check((await p.locator('#board-root').innerText()).length>40,'timeline lens renders content');
    await p.locator('[data-board-analytic]').selectOption('links');
    check((await p.locator('#board-root').innerText()).length>40,'links lens renders content');
    await p.locator('[data-board-lens=matrix]').click();

    await p.locator('main [data-action=estimate]').first().click();
    await p.locator('#confirm-action').click();
    await p.locator('#overview-estimates').filter({hasText:'%'}).waitFor({timeout:30000});
    const estimates=await p.locator('#overview-estimates').innerText();
    check(estimates.includes('Calcul complet')||estimates.includes('Estimation rapide'),'estimate method is stated in plain language');
    check(!estimates.includes('effectif efficace')&&!estimates.includes('ESS'),'statistical jargon is no longer front and centre');
    check((await p.locator('#board-root').innerText()).includes('%'),'matrix surfaces the model result per seat');

    await p.locator('main [data-action=coverage]').first().click();
    check((await p.locator('#dialog').innerText()).includes('Ce n’est pas une simulation du jeu'),'les limites restent annoncees honnetement');
    await p.locator('#dialog [data-action=close]').click();

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
    return {checks:checks.length,passed:checks,errors,selectedId};
  }finally{await c.close();}
}








