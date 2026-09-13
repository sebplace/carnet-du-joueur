async (page)=>{
  const c=await page.context().browser().newContext({viewport:{width:390,height:844},colorScheme:'dark'}),p=await c.newPage(),checks=[],errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  const unlock=async()=>{
    await p.locator('#settings').click();
    for(let i=0;i<7;i++)await p.locator('#app-version').click();
    if(await p.locator('#dialog').evaluate(d=>d.open))await p.locator('#dialog .dialog-head [data-action=close]').click();
  };
  const check=(v,n)=>{if(!v)throw new Error(n);checks.push(n);};
  try{
    await p.goto('http://127.0.0.1:8794/');
    await p.locator('[data-action="demo"]').first().click();
    await unlock();
    for(const width of [320,390,768,1440]){
      await p.setViewportSize({width,height:900});
      for(const lang of ['fr','en']){
        await p.locator('#settings').click();await p.locator('#language').selectOption(lang);await p.locator('#dialog [data-action="close"]').click();
        for(const view of ['table','overview','journal','worlds','script']){
          await p.locator(`#nav [data-view="${view}"]`).click();
          check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}/${lang}/${view} fits viewport`);
        }
      }
    }
    await p.setViewportSize({width:390,height:844});
    await p.locator('#settings').click();await p.locator('#language').selectOption('fr');await p.locator('#dialog [data-action="new"]').click();
    await p.locator('[name=title]').fill('Vingt joueurs');
    await p.locator('[name=names]').fill(Array.from({length:20},(_,i)=>`Joueur ${i+1}`).join('\n'));
    await p.locator('#new-form button[type=submit]').click();if(await p.locator('#dialog .onboarding').count()){await p.locator('#dialog .dialog-head [data-action=close]').click();}
    await unlock();
    check(await p.locator('.player-card').count()===20,'twenty seats rendered');
    check(await p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')).players.filter(p=>p.traveller).length)===5,'five travellers automatically marked');
    await p.locator('[data-action="claim"]').first().click();
    await p.locator('[data-checkrole="chef"]').check();
    await p.evaluate(()=>{window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='botc-player-notebook-v1')throw new Error('Quota test');return window.originalSet.call(this,k,v);};});
    await p.locator('#claim-form button[type=submit]').click();
    await p.locator('#form-error:not([hidden])').waitFor();
    check((await p.locator('#form-error').innerText()).includes('Quota test'),'storage failure is visible');
    check(await p.locator('[data-checkrole="chef"]').isChecked(),'failed save retains form input');
    check(await p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')).claims.length)===0,'failed save leaves persisted game untouched');
    await p.evaluate(()=>Storage.prototype.setItem=window.originalSet);
    await p.locator('#claim-form button[type=submit]').click();
    check(await p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-v1')).claims.length)===1,'retained form can save after recovery');
    await p.locator('[data-view="script"]').click();await p.locator('[data-action="script-import"]').first().click();
    await p.locator('#script-json').fill(JSON.stringify([{id:'_meta',name:'Script <img src=x onerror=alert(1)>'},'chef','imp','monk','empath','poisoner','mysteryrole']));
    await p.locator('#script-parse').click();
    check(await p.locator('#dialog img').count()===0,'script metadata inert before import');
    await p.locator('#use-script').click();
    await p.locator('[name=names]').fill('A\nB\nC\nD\nE');
    await p.locator('#new-form button[type=submit]').click();if(await p.locator('#dialog .onboarding').count()){await p.locator('#dialog .dialog-head [data-action=close]').click();}
    await unlock();
    await p.locator('[data-view="script"]').click();
    await p.locator('[data-team="unknown"]').click();
    check((await p.locator('#role-list').innerText()).includes('mysteryrole'),'unknown ID visible after import');
    await p.locator('[data-view="worlds"]').click();
    await p.locator('#solver-confirm').check();await p.locator('[data-action="analyze"]').click();
    await p.locator('#toast').filter({hasText:'inconnus'}).waitFor();
    check(await p.locator('.worlds-number').count()===0,'unknown script disables unsafe partial model');
    check(await p.evaluate(()=>JSON.parse(localStorage.getItem('botc-player-notebook-backup-v1')).players.length)===20,'script replacement backs up previous notebook');
    check(errors.length===0,'no page errors');
    return {checks:checks.length,passed:checks,errors};
  }finally{await c.close();}
}



