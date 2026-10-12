async (page) => {
  const browser = page.context().browser();
  const checks = [];
  for (const width of [320, 360, 390, 430]) {
    const context = await browser.newContext({viewport: {width, height: 844}, colorScheme: 'dark'});
    const p = await context.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    const check = (value, label) => {
      if (!value) throw new Error(`${width}px: ${label}`);
      checks.push(`${width}px: ${label}`);
    };
    const overflow = () => p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    try {
      await p.goto('http://127.0.0.1:8794/');
      await p.locator('[data-action=demo]').first().click();
      await p.locator('[data-action=first-steps-done]').click();
      await p.locator('[data-action=shape][data-shape=plan]').click();
      await p.locator('.cabinet-engraving').waitFor();
      check(!await overflow(), 'plan sans defilement horizontal');
      check(await p.locator('.table-controls .shape-switch button').count() === 3, 'trois volets');
      check(await p.locator('.plan-fx').count() > 0, 'icones d effets conservees');
      for (const id of ['undo', 'privacy', 'settings']) {
        check(await p.locator(`#${id}`).isVisible(), `commande ${id} presente`);
      }
      await p.locator('[data-plan-seat] .plan-disc').nth(1).click();
      check(await p.locator('[data-action=toggle-effect]').count() === 8, 'huit effets dans la fiche');
      check(!await overflow(), 'fiche sans defilement horizontal');
      await p.locator('#dialog [data-action=close]').click();
      for (let i = 0; i < 3; i++) {
        await p.locator('.shape-switch [data-view=journal]').click();
        await p.locator('.cabinet-notes-tabs').waitFor();
        check(await p.locator('.cabinet-notes-tabs button').count() === 3, 'Notes sans doublon');
        check(!await overflow(), 'Notes sans defilement horizontal');
        await p.locator('[data-cabinet-shape=liste]').click();
        await p.locator('.seat-open').first().waitFor();
      }
      check(!await overflow(), 'liste sans defilement horizontal');
      check(errors.length === 0, `aucune erreur : ${errors.join(', ')}`);
    } finally {
      await context.close();
    }
  }
  return {checks: checks.length};
}
