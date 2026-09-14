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
  const check=(v,n)=>{if(!v)throw new Error(n);checks.push(n);};
  const state=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')));
  const closeDialog=()=>p.locator('#dialog .dialog-head [data-action=close]').click();
  try{
    await p.goto('http://127.0.0.1:8794/');
    await p.locator('[data-action=new]').first().click();
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma\nFarid\nGaëlle');
    await p.locator('#new-form button[type=submit]').click();
    check((await p.locator('#dialog').innerText()).includes('Soixante secondes'),'first game opens the sixty-second onboarding');
    await closeDialog();

    let g=await state();
    check(g.version===5,'saves migrate to schema 5');
    check(g.settings.showEstimates===false,'the calculation is off by default');
    check(await p.locator('#estimates-summary').count()===0,'no percentages on the table view by default');

    // Express capture must accept a fragment.
    await p.locator('.player-card [data-action=express]').first().click();
    await p.locator('#dialog [name=text]').fill('Empathe 1, dit avoir vu Bruno');
    await p.locator('#express-form button[type=submit]').click();
    g=await state();
    check(g.events.some(e=>e.type==='info'&&e.text.includes('Empathe 1')),'express capture saves with text alone');

    // My own game: what I said, and what I must remember.
    await viaMenu('mynotes');
    await p.locator('#dialog [data-action=self-add]').click();
    await p.locator('#dialog [name=scope]').selectOption('players');
    await p.locator('#self-audience button').first().click();
    await p.locator('#dialog [name=text]').fill('Je leur ai dit Moine');
    await p.locator('#self-form button[type=submit]').click();
    g=await state();
    check(g.selfLog.length===1&&g.selfLog[0].status==='told','my own claim is recorded with its audience');
    check((await p.locator('#dialog').innerText()).includes('Je leur ai dit Moine'),'my own words are listed back to me');
    await p.locator('#dialog [data-action=retain-add]').click();
    await p.locator('#dialog [name=value]').fill('1');
    await p.locator('#retain-form button[type=submit]').click();
    g=await state();
    check(g.retained.length===1&&g.retained[0].value==='1','delayed information is retained per night');
    await closeDialog();

    // Social surfaces.
    await viaMenu('table-card');
    const card=await p.locator('#dialog').innerText();
    check(card.includes('Aucune IA')&&!/calcul|estimation|probabilit/i.test(card),'la carte a montrer affirme l absence d IA sans jamais evoquer un calcul');
    await closeDialog();
    await viaMenu('endgame');
    check((await p.locator('#dialog').innerText()).includes('votes fantômes restants'),'the endgame checklist counts ghost votes');
    await closeDialog();
    await p.locator('[data-action=round]').click();
    check((await p.locator('#dialog').innerText()).includes('seuil usuel'),'the nomination panel shows the usual threshold');
    await closeDialog();

    // Compact history.
    const before=(await state()).retained.length;
    await p.locator('#undo').click();
    check((await state()).retained.length===before-1,'compact undo restores the previous state exactly');

    // Opt-in calculation, desormais derriere le deverrouillage.
    await unlock();
    await p.locator('#settings').click();
    await p.locator('#dialog [data-action=toggle-estimates]').click();
    await p.locator('#confirm-action').click();
    check((await state()).settings.showEstimates===true,'the calculation is enabled only on explicit request');

    // Deux loupes principales en boutons, les loupes analytiques dans un selecteur.
    await p.locator('#nav [data-view=overview]').click();
    check(await p.locator('[data-board-lens]').count()===2,'exactly two primary lenses are offered as buttons');
    check(await p.locator('[data-board-analytic] option').count()===3,'the analytic select holds a neutral option plus two lenses');
    await p.locator('[data-board-lens="grille"]').click();
    await p.waitForTimeout(250);
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the character grid fits a phone');
    await p.locator('[data-board-analytic]').selectOption('conflits');
    await p.waitForTimeout(250);
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the contradiction lens fits a phone');
    await p.locator('[data-board-analytic]').selectOption('links');
    await p.waitForTimeout(250);
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the links lens fits a phone');

    // Printable sheet, without relying on a popup being allowed.
    await p.locator('#nav [data-view=table]').click();
    await viaMenu('print-sheet');
    const sheetHtml=await p.evaluate(async()=>{
      const {printableSheet}=await import('./js/print.js');
      const {default:_}={default:null};
      const game=JSON.parse(localStorage.getItem('botc-player-notebook-v1'));
      const catalogue=await (await fetch('./data/catalogue.json')).json();
      return printableSheet(game,{catalogue,lang:'fr'});
    });
    check(sheetHtml.includes('Alice')&&sheetHtml.includes('Gaëlle'),'the printable sheet lists every real seat');
    check(!/<script/i.test(sheetHtml)&&!/https?:\/\//i.test(sheetHtml),'the printable sheet has no script and no remote resource');
    await closeDialog();

    check(errors.length===0,'no browser errors: '+errors.join(' | '));
    return {checks:checks.length,passed:checks,errors};
  }finally{await c.close();}
}





