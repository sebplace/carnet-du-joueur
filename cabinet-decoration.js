// Decorative layer: the application owns every interaction and record.
// SVG ornaments are inert and absent from the accessibility tree.
const NS = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let previousAngle = null;

function group(className, markup) {
  const node = document.createElementNS(NS, 'g');
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('pointer-events', 'none');
  node.innerHTML = markup;
  return node;
}

function engrave(svg) {
  if (svg.querySelector('.cabinet-engraving')) return;
  const ring = svg.querySelector('.plan-ring');
  if (!ring) return;
  const cx = Number(ring.getAttribute('cx'));
  const cy = Number(ring.getAttribute('cy'));
  const radius = Number(ring.getAttribute('r'));
  const maxRadius = Math.min(cx, cy) - 5;
  const outer = Math.min(radius + 20, maxRadius);
  const rim = Math.min(radius + 10, outer - 4);
  const circles = [outer, outer - 3, rim, rim - 3].map((r, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" class="cabinet-ring cabinet-ring-${i}"/>`
  ).join('');
  const ticks = Array.from({length: 60}, (_, i) => {
    const top = cy - outer + 4;
    const length = i % 5 === 0 ? 6 : 3;
    return `<path d="M${cx} ${top}v${length}" transform="rotate(${i * 6} ${cx} ${cy})" class="cabinet-tick"/>`;
  }).join('');
  const corners = [45, 135, 225, 315].map(angle =>
    `<g transform="rotate(${angle} ${cx} ${cy})"><path d="M${cx - 15} ${cy - outer + 12}q-8-25-22-15q-8 9 3 12q8 2 11-7M${cx + 15} ${cy - outer + 12}q8-25 22-15q8 9-3 12q-8 2-11-7" class="cabinet-scroll"/></g>`
  ).join('');
  const cardinal = [0, 90, 180, 270].map(angle =>
    `<path d="M${cx} ${cy - outer - 3}l4 6-4 6-4-6Z" transform="rotate(${angle} ${cx} ${cy})" class="cabinet-scroll"/>`
  ).join('');
  const decor = group('cabinet-engraving', circles + ticks + corners + cardinal);
  svg.prepend(decor);

  const seatCount = svg.querySelectorAll('.plan-seat').length;
  for (const seat of svg.querySelectorAll('.plan-seat')) {
    const disc = seat.querySelector('.plan-disc');
    const r = seatCount <= 10 ? 19 : Number(disc.getAttribute('r'));
    if (seatCount <= 10) {
      disc.setAttribute('r', r);
      const name = seat.querySelector('.plan-seat-name');
      const role = seat.querySelector('.plan-seat-role');
      if (name) { name.setAttribute('x', '0'); name.setAttribute('y', String(r + 12)); }
      if (role) { role.setAttribute('x', '0'); role.setAttribute('y', String(r + 23)); }
    }
    seat.insertBefore(group('cabinet-medallion', `<circle r="${r + 2.5}" class="cabinet-medallion-rim"/><circle r="${r + 4}" class="cabinet-medallion-line"/>`), disc);
  }
  const hub = svg.querySelector('.plan-hub-disc');
  if (hub) {
    const r = Number(hub.getAttribute('r'));
    svg.insertBefore(group('cabinet-hub-engraving',
      `<circle cx="${cx}" cy="${cy}" r="${r + 3}" class="cabinet-ring"/>
       <circle cx="${cx}" cy="${cy}" r="${r + 7}" class="cabinet-ring cabinet-ring-1"/>
       <g class="cabinet-hand" style="transform-origin:${cx}px ${cy}px">
         <path d="M${cx} ${cy - r - 13}l3 8-3-2-3 2Z" class="cabinet-hand-tip"/>
       </g>`), svg.querySelector('.plan-hub'));
    const label = svg.querySelector('.plan-hub-day').textContent;
    const number = Number(label.match(/\d+/)?.[0] || 1);
    const night = /Nuit|Night/.test(label);
    const angle = number * 30 + (night ? 0 : 180);
    const hand = svg.querySelector('.cabinet-hand');
    hand.style.transform = `rotate(${angle}deg)`;
    if (previousAngle !== null && previousAngle !== angle && !reducedMotion.matches) {
      hand.animate([{transform: `rotate(${previousAngle}deg)`}, {transform: `rotate(${angle}deg)`}], {duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)'});
    }
    previousAngle = angle;
  }
}

let queued = false;
function notesTabs() {
  const english = document.documentElement.lang === 'en';
  const switcher = document.querySelector('#main > .table-controls .shape-switch');
  if (switcher && !switcher.querySelector('[data-view="journal"]')) {
    const notes = document.createElement('button');
    notes.type = 'button';
    notes.dataset.action = 'view';
    notes.dataset.view = 'journal';
    notes.textContent = 'Notes';
    notes.setAttribute('aria-pressed', 'false');
    switcher.append(notes);
  }
  if (document.querySelector('#journal-entries') && !document.querySelector('.cabinet-notes-tabs')) {
    const tabs = document.createElement('div');
    tabs.className = 'shape-switch cabinet-notes-tabs';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', english ? 'Display' : 'Affichage');
    tabs.innerHTML = `<button type="button" data-cabinet-shape="plan" aria-pressed="false">Plan</button><button type="button" data-cabinet-shape="liste" aria-pressed="false">${english ? 'List' : 'Liste'}</button><button type="button" class="active" aria-pressed="true">Notes</button>`;
    document.querySelector('#main > .section-head').after(tabs);
  }
}
document.addEventListener('click', event => {
  const tab = event.target.closest('[data-cabinet-shape]');
  if (!tab) return;
  document.querySelector('#nav [data-view="table"]').click();
  document.querySelector(`#main [data-shape="${tab.dataset.cabinetShape}"]`).click();
});
function update() {
  queued = false;
  document.querySelector('#main').classList.toggle('cabinet-table', !!document.querySelector('#main > .table-bar'));
  notesTabs();
  document.querySelectorAll('.plan-svg').forEach(engrave);
}
const observer = new MutationObserver(records => {
  // Decorative insertions must not trigger an observer/render feedback loop.
  const applicationChange = records.some(record => [...record.addedNodes].some(node =>
    node.nodeType === Node.ELEMENT_NODE &&
    !node.matches('.cabinet-engraving,.cabinet-medallion,.cabinet-hub-engraving')
  ));
  if (!applicationChange || queued) return;
  queued = true;
  requestAnimationFrame(update);
});
observer.observe(document.querySelector('#main'), {childList: true, subtree: true});
update();
