async (page) => {
  const c=await page.context().browser().newContext({viewport:{width:390,height:844},colorScheme:'dark'});
  const p=await c.newPage(),checks=[],errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  const unlock=async()=>{
    await p.locator('#settings').click();
    for(let i=0;i<7;i++)await p.locator('#app-version').click();
    if(await p.locator('#dialog').evaluate(d=>d.open))await p.locator('#dialog .dialog-head [data-action=close]').click();
  };
  const check=(v,n)=>{if(!v)throw new Error(n);checks.push(n);};
  const state=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')));
  try{
    await p.goto('http://127.0.0.1:8794/');
    await p.locator('[data-action=new]').first().click();
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma');
    await p.locator('#new-form button[type=submit]').click();
    if(await p.locator('#dialog .onboarding').count())await p.locator('#dialog .dialog-head [data-action=close]').click();
    await unlock();
    await p.evaluate(()=>{
      const g=JSON.parse(localStorage.getItem('botc-player-notebook-v1'));
      g.settings=Object.assign({},g.settings,{showEstimates:true});
      g.estimateConsent=true;
      localStorage.setItem('botc-player-notebook-v1',JSON.stringify(g));
    });
    await p.reload();await p.locator('.player-card').first().waitFor();

    await p.locator('#nav [data-view=worlds]').click();
    await p.locator('[data-action=constraint]').first().click();

    check(await p.locator('#relation-scope').count()===1,'the idea builder offers a scope');
    check(await p.locator('#relation-anchor-wrap').isHidden(),'the anchor stays hidden for an ordinary group');

    await p.locator('#relation-scope').selectOption('neighbours');
    check(await p.locator('#relation-anchor-wrap').isVisible(),'choosing neighbours reveals the anchor');
    check(await p.locator('#constraint-players').isHidden(),'the manual player list disappears for neighbours');

    const g=await state();
    await p.locator('#relation-anchor').selectOption(g.players[0].id);
    await p.locator('#constraint-roles [data-pick="poisoner"]').click();
    const sentence=await p.locator('#relation-preview').innerText();
    check(sentence.includes('voisins vivants de Alice'),'the preview is a readable sentence about neighbours');
    check(!sentence.includes('Bruno')&&!sentence.includes('Emma'),'the sentence does not freeze who the neighbours are');

    await p.locator('#dialog [name=note]').fill('Empathe annonce 1');
    await p.locator('#constraint-form button[type=submit]').click();

    const saved=(await state()).scenarios[0].constraints[0];
    check(saved.kind==='neighbours'&&saved.anchor===g.players[0].id&&saved.players.length===0,'the neighbourhood idea is stored by anchor');

    check((await p.locator('#worlds-constraints, main').innerText()).includes('voisins vivants de Alice'),'the idea is listed in plain language');

    // It must actually reach the model.
    await p.locator('#nav [data-view=overview]').click();
    await p.locator('#overview-estimates').filter({hasText:'%'}).waitFor({timeout:40000});
    const before=await p.locator('#overview-estimates').innerText();
    check(before.includes('Empoisonneur'),'the estimate still runs with a neighbourhood idea');

    // Reload must preserve it, and the explanation must name it.
    await p.reload();await p.locator('.player-card').first().waitFor();
    check((await state()).scenarios[0].constraints[0].kind==='neighbours','the idea survives a reload');
    await p.locator('#nav [data-view=overview]').click();
    await p.locator('#overview-estimates').filter({hasText:'%'}).waitFor({timeout:40000});
    await p.locator('#overview-estimates [data-action=explain]').first().click();
    await p.locator('#explain-body .probability-rows, #explain-body .muted, #explain-body .error').first().waitFor({timeout:60000});
    const explained=await p.locator('#explain-body').innerText();
    check(!explained.includes('Analyse en cours'),'the explanation completes with a neighbourhood idea');
    await p.locator('#dialog .dialog-head [data-action=close]').click();

    check(errors.length===0,'no browser errors: '+errors.join(' | '));
    return {checks:checks.length,passed:checks,errors};
  }finally{await c.close();}
}



