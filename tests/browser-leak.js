async (page) => {
  const c=await page.context().browser().newContext({viewport:{width:390,height:844},colorScheme:'dark'});
  const p=await c.newPage(),checks=[],errors=[],leaks=[];
  p.on('pageerror',e=>errors.push(e.message));
  const check=(v,n)=>{if(!v)throw new Error(n);checks.push(n);};

  // Vocabulaire qui trahirait l'existence de l'outil.
  const BLOCKLIST=/calcul|estimation|estimations|estimé|probabilit|pourcentage|percentage|hypothèse|hypothèses|hypothesis|solveur|solver|statistiq|oracle|modèle|model scope|portée du calcul|monde compatible|répartition initiale/i;
  // Exceptions legitimes: phrases qui NIENT l'existence d'un calcul.
  const ALLOWED=[
    /ne rend aucun verdict/i, /settles no rule/i, /aucune IA/i, /no AI/i
  ];
  const scan=async(where)=>{
    const text=await p.evaluate(()=>{
      const vis=el=>el&&(el.offsetWidth||el.offsetHeight||el.getClientRects().length);
      const parts=[];
      for(const sel of ['header','#main','#nav','#banner','#toast']){
        const el=document.querySelector(sel);
        if(vis(el))parts.push(el.innerText);
      }
      const d=document.querySelector('#dialog');
      if(d?.open)parts.push(d.innerText);
      return parts.join('\n');
    });
    for(const line of text.split('\n')){
      if(!BLOCKLIST.test(line))continue;
      if(ALLOWED.some(rx=>rx.test(line)))continue;
      leaks.push(`${where} :: ${line.trim().slice(0,120)}`);
    }
  };
  const closeDialog=async()=>{if(await p.locator('#dialog').evaluate(d=>d.open))await p.locator('#dialog .dialog-head [data-action=close]').click();};
  const openAndScan=async(selector,label,{required=true}={})=>{
    const loc=p.locator(selector).first();
    if(!await loc.count()){ if(required)throw new Error('Dialogue introuvable, la sonde ne le couvre plus : '+label+' ('+selector+')'); return; }
    await loc.click();
    await p.waitForTimeout(120);
    await scan(label);
    await closeDialog();
  };
  const openViaMenu=async(action,label)=>{
    await p.locator('main [data-action=table-menu]').first().click();
    await p.waitForTimeout(100);
    await scan('menu outils');
    await p.locator(`#dialog [data-action="${action}"]`).first().click();
    await p.waitForTimeout(150);
    await scan(label);
    await closeDialog();
  };

  try{
    await p.goto('http://127.0.0.1:8794/');
    await scan('accueil');
    await p.locator('[data-action=new]').first().click();
    await scan('dialogue nouvelle partie');
    await p.locator('[name=names]').fill('Alice\nBruno\nChloé\nDavid\nEmma\nFarid\nGaëlle');
    await p.locator('#new-form button[type=submit]').click();
    await p.waitForTimeout(150);
    await scan('onboarding');
    await closeDialog();

    check((await p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')).settings.unlocked))===false,'la partie est bien verrouillee');

    // Chaque vue.
    for(const v of ['table','overview','journal','script']){
      await p.locator(`#nav [data-view="${v}"]`).click();
      await p.waitForTimeout(200);
      await scan('vue '+v);
    }

    // Chaque dialogue atteignable depuis la table.
    await p.locator('#nav [data-view=table]').click();
    for(const [sel,label] of [
      ['main [data-action=express]','saisie rapide'],
      ['main [data-action=night]','morts de la nuit'],
      ['main [data-action=round]','execution et votes'],
      ['main [data-action=note]','note libre'],
      ['main [data-action=phase]','phase'],
      ['.player-card [data-action=claim]','declaration'],
      ['.player-card .player-open','fiche joueur'],
    ]) await openAndScan(sel,label);
    // Outils deplaces dans le menu: ils doivent etre couverts la ou ils vivent maintenant.
    for(const [action,label] of [
      ['roster','liste des joueurs'],
      ['mynotes','mon jeu'],
      ['table-card','carte a montrer'],
      ['endgame','fin de partie'],
      ['coverage','ce que le carnet ne fait pas'],
    ]) await openViaMenu(action,label);

    // Dialogues de la vue Enquete.
    await p.locator('#nav [data-view=overview]').click();
    await p.waitForTimeout(200);

    // Reglages et ses sous-dialogues.
    await p.locator('#settings').click();
    await scan('reglages');
    await openAndScan('#dialog [data-action=backup]','copies de secours');
    await p.locator('#settings').click();
    await openAndScan('#dialog [data-action=coverage]','coverage depuis reglages');
    await p.locator('#settings').click();
    await openAndScan('#dialog [data-action=restore]','restauration');
    await closeDialog();

    // Journal: ouvrir le detail d'une entree.
    await p.locator('#nav [data-view=journal]').click();
    await p.waitForTimeout(200);
    await scan('journal apres notes');

    // Script: import.
    await p.locator('#nav [data-view=script]').click();
    await openAndScan('main [data-action=script-import]','import de script');

    check(leaks.length===0,'aucune fuite de vocabulaire. Fuites: '+JSON.stringify(leaks,null,1));
    check(errors.length===0,'aucune erreur navigateur: '+errors.join(' | '));
    return {checks:checks.length,passed:checks,leaks,errors};
  }finally{await c.close();}
}

