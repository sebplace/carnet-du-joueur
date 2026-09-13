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
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma\nFarid\nGaëlle');
    await p.locator('#new-form button[type=submit]').click();
    if(await p.locator('#dialog .onboarding').count())await p.locator('#dialog .dialog-head [data-action=close]').click();
    await unlock();
    await p.evaluate(()=>{
      const g=JSON.parse(localStorage.getItem('botc-player-notebook-v1'));
      const domains=[['washerwoman'],['empath','imp'],['empath','imp'],['chef'],['monk'],['poisoner'],['soldier']];
      g.players.forEach((pl,i)=>g.scenarios[0].domains[pl.id]=domains[i]);
      g.settings=Object.assign({},g.settings,{showEstimates:true});
      g.estimateConsent=true;
      localStorage.setItem('botc-player-notebook-v1',JSON.stringify(g));
    });
    await p.reload();await p.locator('.player-card').first().waitFor();

    // A weighted claim so there is at least one factor to explain.
    await p.locator('.player-card [data-action=claim]').nth(1).click();
    for(const id of ['empath','chef','monk'])await p.locator(`[data-checkrole="${id}"]`).check();
    await p.locator('#dialog [name="weight"]').selectOption('5');
    await p.locator('#claim-form button[type=submit]').click();
    await p.locator('#estimates-summary').filter({hasText:'Calcul complet'}).waitFor({timeout:30000});

    // Presence explanation from the summary.
    check(await p.locator('#estimates-summary [data-action=explain]').count()>0,'every presence line offers an explanation');
    await p.locator('#estimates-summary [data-action=explain]').first().click();
    await p.locator('#explain-body .probability-rows, #explain-body .muted, #explain-body .error').first().waitFor({timeout:60000});
    const presence=await p.locator('#explain-body').innerText();
    check(!presence.includes('Analyse en cours'),'the presence explanation finishes');
    check(!/error/i.test(await p.locator('#explain-body').innerHTML())||!presence.includes('undefined'),'no raw error in the presence explanation');
    await p.locator('#dialog .dialog-head [data-action=close]').click();

    // Per-player explanation, reached from the seat.
    await p.locator('.player-card [data-action=player-probability]').nth(1).click();
    await p.locator('[data-player-estimate] .probability-rows').waitFor();
    check(await p.locator('[data-player-estimate] [data-action=explain]').count()===3,'each claimed character can be explained');
    await p.locator('[data-player-estimate] [data-action=explain]').first().click();
    await p.locator('#explain-body .probability-rows, #explain-body .muted, #explain-body .error').first().waitFor({timeout:60000});
    const body=await p.locator('#explain-body').innerText();
    check(body.includes('%'),'the explanation restates the current percentage');
    check(body.includes('Déclaration de Bruno')||body.includes('témoignage'),'the weighted claim is named in plain language');
    check(body.includes('sensibilité')||body.includes('pas une preuve'),'the explanation refuses to look like proof');
    await p.locator('#dialog .dialog-head [data-action=close]').click();

    // Contradictory assumptions must name what to relax.
    const g=await state();
    await p.evaluate(id=>{
      const saved=JSON.parse(localStorage.getItem('botc-player-notebook-v1'));
      const seats=saved.players.map(pl=>pl.id);
      saved.scenarios[0].constraints=[
        {id:'c1',players:[seats[1]],roleIds:['empath'],min:1,max:1,note:'Test',enabled:true,fragile:false},
        {id:'c2',players:[seats[1]],roleIds:['empath'],min:0,max:0,note:'Test',enabled:true,fragile:false}
      ];
      localStorage.setItem('botc-player-notebook-v1',JSON.stringify(saved));
    },g.players[1].id);
    await p.reload();await p.locator('.player-card').first().waitFor();
    await p.locator('#estimates-summary').filter({hasText:'ne vont pas ensemble'}).waitFor({timeout:30000});
    await p.locator('.player-card [data-action=player-probability]').nth(1).click();
    await p.locator('[data-player-estimate] [data-action=estimate]').waitFor();
    check((await p.locator('[data-player-estimate]').innerText()).includes('ne vont pas ensemble'),'a contradiction is stated instead of a number');
    await p.locator('#dialog .dialog-head [data-action=close]').click();

    check(errors.length===0,'no browser errors: '+errors.join(' | '));
    return {checks:checks.length,passed:checks,errors};
  }finally{await c.close();}
}


