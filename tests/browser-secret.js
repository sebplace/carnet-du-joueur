async (page) => {
  const c=await page.context().browser().newContext({viewport:{width:390,height:844},colorScheme:'dark'});
  const p=await c.newPage(),checks=[],errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  const check=(v,n)=>{if(!v)throw new Error(n);checks.push(n);};
  const state=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')));
  const closeDialog=async()=>{if(await p.locator('#dialog').evaluate(d=>d.open))await p.locator('#dialog .dialog-head [data-action=close]').click();};
  try{
    await p.goto('http://127.0.0.1:8794/');
    await p.locator('[data-action=new]').first().click();
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma\nFarid\nGaëlle');
    await p.locator('#new-form button[type=submit]').click();
    await closeDialog();

    // VERROUILLE: aucune trace de l'outil nulle part.
    let g=await state();
    check(g.settings.unlocked===false,'une partie neuve demarre verrouillee');
    check(g.settings.claimRoleEnrichment===true,'enrichissement actif par defaut');
    const nav=await p.locator('#nav button').evaluateAll(b=>b.map(x=>x.dataset.view));
    check(!nav.includes('worlds'),'onglet Hypotheses absent de la navigation');
    check(await p.locator('main [data-action=estimate]').count()===0,'aucun bouton de calcul sur la table');

    await p.locator('#nav [data-view=overview]').click();
    await p.locator('#board-root .board-timeline').first().waitFor();
    check(await p.locator('#board-root [data-board-lens][aria-selected=true]').getAttribute('data-board-lens')==='timeline','la vue Enquete ouvre sur la chronologie');
    const boardText=await p.locator('#board-root').innerText();
    check(!/estimation|%/i.test(boardText),'le tableau ne mentionne ni estimation ni pourcentage');
    check(!(await p.locator('#main').innerText()).includes('Ce que le calcul'),'la carte du calcul est absente de la vue Enquete');

    await p.locator('#settings').click();
    const settingsText=await p.locator('#dialog').innerText();
    check(!/calcul|estimation|probabilit/i.test(settingsText),'les reglages ne mentionnent jamais le calcul');
    check(await p.locator('#dialog [data-action=toggle-estimates]').count()===0,'aucun interrupteur visible');

    // Le chemin cache: 7 taps sur la version.
    for(let i=0;i<6;i++)await p.locator('#app-version').click();
    check((await state()).settings.unlocked===false,'six taps ne suffisent pas');
    await p.locator('#app-version').click();
    await p.locator('#dialog').filter({hasText:'Analyse avancée'}).waitFor({timeout:5000});
    check((await state()).settings.unlocked===true,'sept taps deverrouillent');

    // DEVERROUILLE: l'outil reapparait.
    check(await p.locator('#dialog [data-action=toggle-estimates]').count()===1,'l interrupteur apparait une fois deverrouille');
    check(await p.locator('#dialog [data-action=relock]').count()===1,'le reverrouillage est offert');
    await p.locator('#dialog [data-action=toggle-estimates]').click();
    await p.locator('#confirm-action').click();
    check((await state()).settings.showEstimates===true,'le calcul s active apres consentement');
    await closeDialog();
    const navOn=await p.locator('#nav button').evaluateAll(b=>b.map(x=>x.dataset.view));
    check(navOn.includes('worlds'),'onglet Hypotheses present une fois deverrouille');

    // Reverrouillage: tout disparait a nouveau.
    await p.locator('#settings').click();
    await p.locator('#dialog [data-action=relock]').click();
    g=await state();
    check(g.settings.unlocked===false&&g.settings.showEstimates===false,'le reverrouillage coupe tout');
    const navOff=await p.locator('#nav button').evaluateAll(b=>b.map(x=>x.dataset.view));
    check(!navOff.includes('worlds'),'onglet Hypotheses redisparait');
    await closeDialog();

    // Le deverrouillage ne fuit pas vers une nouvelle partie.
    await p.locator('#settings').click();
    await p.locator('#dialog [data-action=new]').click();
    await p.locator('[name=names]').fill('A\nB\nC\nD\nE');
    await p.locator('#new-form button[type=submit]').click();
    await closeDialog();
    check((await state()).settings.unlocked===false,'une nouvelle partie redemarre verrouillee');

    check(errors.length===0,'aucune erreur navigateur: '+errors.join(' | '));
    return {checks:checks.length,passed:checks,errors};
  }finally{await c.close();}
}
