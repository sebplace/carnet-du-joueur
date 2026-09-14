// Verification publique de la 1.8 : cadran, lentilles, version, hors ligne.
async (page) => {
  const out = [];
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const failed = [];
  page.on('requestfailed', r => failed.push(r.url()));
  const clear = async () => {
    for (let i = 0; i < 4; i++) {
      if (await page.locator('#cover[open]').count()) { await page.locator('#uncover').first().click({ force: true }).catch(() => {}); await page.waitForTimeout(350); continue; }
      const c = page.locator('dialog[open] [data-action="close"]').first();
      if (await c.count()) { await c.click({ force: true }).catch(() => {}); await page.waitForTimeout(350); continue; }
      break;
    }
  };

  await page.goto('https://sebplace.github.io/carnet-du-joueur/?t=' + Date.now(), { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.locator('[data-action="demo"]').first().click();
  await page.waitForTimeout(1200);
  await clear();
  out.push({ seatsInList: await page.locator('.player-card').count() });

  // bascule Plan
  await page.locator('[data-action="shape"][data-shape="plan"]').first().click();
  await page.waitForTimeout(900);
  const seats = page.locator('[data-plan-seat]');
  out.push({
    dial: await page.locator('svg.plan-svg').count(),
    seats: await seats.count(),
    listGone: await page.locator('.player-card').count(),
    nameFont: await page.evaluate(() => { const t = document.querySelector('.plan-seat-name'); return t ? getComputedStyle(t).fontSize : null; }),
    hit: await page.evaluate(() => { const h = document.querySelector('.plan-hit'); return h ? Math.round(h.getBoundingClientRect().width) : null; })
  });

  const rest = await page.locator('.plan-chord').count();
  await seats.nth(2).click();
  await page.waitForTimeout(700);
  out.push({
    chordsAtRest: rest,
    chordsAfterSelect: await page.locator('.plan-chord').count(),
    linkList: await page.evaluate(() => { const p = document.querySelector('.plan-link-list'); return p ? p.innerText.trim().slice(0, 80).replace(/\s+/g, ' ') : null; })
  });

  // lentilles
  await page.locator('#nav [data-view="overview"]').first().click();
  await page.waitForTimeout(900);
  const lenses = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('[data-board-lens]')).map(x => x.getAttribute('data-board-lens'));
    const s = document.querySelector('select[data-board-analytic]');
    return b.concat(s ? Array.from(s.options).map(o => o.value).filter(Boolean) : []);
  });
  out.push({ lenses, count: lenses.length, noMatrix: !lenses.includes('matrix'), noRound: !lenses.includes('round') });

  await page.locator('#settings').first().click();
  await page.waitForTimeout(800);
  out.push({
    version: await page.evaluate(() => { const e = document.querySelector('#app-version'); return e ? e.textContent.trim() : 'ABSENT'; }),
    caches: await page.evaluate(() => caches.keys())
  });
  await clear();

  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(e => out.push({ reloadErr: String(e) }));
  await page.waitForTimeout(2200);
  out.push({
    offlineShell: await page.locator('[data-action="demo"]').count() > 0,
    offlineErr: errs.length
  });
  await page.context().setOffline(false);
  out.push({ pageErrors: errs, failedRequests: failed.filter(u => !u.includes('favicon')).length });
  return JSON.stringify(out, null, 1);
}
