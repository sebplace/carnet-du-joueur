import {uid,TEAMS,STORAGE_KEY,BACKUP_KEY,LIMITS,newGame,newScenario,normalCounts,validateGame,parseSave,createStorage} from './state.js';
import {parseScript,fold} from './catalogue.js';
import {buildEvidenceModel,lastClaim,ballotSummary,toEngineConstraint,constraintPeople,claimEnrichmentNotices} from './evidence.js';
import {applyRoster,rosterImpact} from './roster.js';
import {buildInvestigation,selectRecords,describeRelation} from './investigation.js';
import {RULES_COVERAGE} from './rules-coverage.js';
import {renderBoard,resetBoard,seatNeighbours} from './board.js';
import {whoKnows,retainedSeries,PUBLIC_AUDIENCE} from './mynotes.js';
import {printableSheet} from './print.js';
import {buildPlanModel,renderPlan} from './plan.js';
import {createHistory} from './history.js';
import {createEstimator,EstimatorSupersededError,EstimatorCancelledError} from './estimator-client.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lang = 'fr', game = null, catalogue, store, demo = false, view = 'table', loadError = '', locked = false;
const history = createHistory({limit:24,snapshotEvery:8});
let estimator = null;
let explainer = null;
let analysis = null, worker = null, requestId = '', analyzing = false, deferredInstall = null, toastTimer, returnFocus;
let bookFilter = '', roleFilter = '', roleTeam = 'all', noteSearch = '';
let tableShape = 'liste', planSeat = '';
function savePrefs(){try{localStorage.setItem('botc-player-preferences',JSON.stringify({lang,theme:document.documentElement.dataset.theme,shape:tableShape}));}catch(e){console.warn(e);}}
let prediction=null,predictionId='',predictionTimer=null,predictionBusy=false,predictionError='';
const investigationView={person:'',phase:'',query:'',type:'all',page:0};
const tr = (fr,en) => lang === 'fr' ? fr : en;
const loc = v => typeof v === 'string' ? v : v?.[lang] || v?.en || v?.fr || '';
const teamNames = {townsfolk:['Villageois','Townsfolk'],outsider:['Marginal','Outsider'],minion:['Sbire','Minion'],demon:['Démon','Demon'],traveller:['Voyageur','Traveller'],fabled:['Légendaire','Fabled'],unknown:['Non documenté','Unknown']};
const teamName = id => tr(...(teamNames[id] || teamNames.unknown));
const trustNames = {unknown:['À découvrir','Unclear'],trusted:['Confiance','Trusted'],watch:['À recouper','Cross-check'],suspect:['Soupçon','Suspect']};
const phaseName = (g=game) => `${tr(g.phase==='day'?'Jour':'Nuit',g.phase==='day'?'Day':'Night')} ${g.day}`;
const player = id => game.players.find(p=>p.id===id)||(game.archivedPlayers||[]).find(p=>p.id===id);
const pname = id => player(id)?.name || tr('Sans source','No source');
const scenario = () => game.scenarios.find(s=>s.id===game.activeScenario);
const role = id => catalogue.roles.find(r=>r.id===id) || game?.script.customRoles.find(r=>r.id===id) || {id,name:{fr:id,en:id},team:'unknown',ability:{fr:'',en:''}};
const rname = id => loc(role(id).name);
const roles = () => game.script.roleIds.map(role);
const modelRoles = () => roles().filter(r=>TEAMS.includes(r.team));
const normalPlayers = () => game.players.filter(p=>!p.traveller);
const roleLabel = ids => ids.map(rname).join(' / ');
const latestClaim = id => lastClaim(game,id);
const byTime = (a,b) => b.day-a.day || (b.phase==='day'?1:0)-(a.phase==='day'?1:0);
function button(action,label,cls='',extra='') { return `<button type="button" data-action="${action}" class="${cls}" ${extra}>${label}</button>`; }
function error(message) {
  console.error(message);
  const el = $('#form-error');
  if ($('#dialog').open && el) { el.textContent=String(message); el.hidden=false; el.scrollIntoView({block:'nearest'}); }
  else toast(String(message),9000);
}
function toast(message,ms=3000) {
  clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').hidden=false;
  toastTimer=setTimeout(()=>$('#toast').hidden=true,ms);
}
function stopStrictSearch() {
  if (worker) worker.terminate();
  worker=null; analyzing=false; analysis=null; requestId='';
}
function invalidate() {
  stopStrictSearch();
  clearTimeout(predictionTimer);
  estimator?.cancel();
  explainer?.cancel();
  predictionId='';prediction=null;predictionBusy=false;predictionError='';
}
function change(mutator, message, backup=false) {
  if (locked && !demo) throw new Error(tr('Partie modifiée ailleurs. Recharge la page.','Game changed elsewhere. Reload the page.'));
  const next = structuredClone(game);
  mutator(next);
  const clean = validateGame(next);
  if (!demo) store.save(clean,{backup});
  history.record(game, clean);
  game=clean; clearDraft(); invalidate(); render();schedulePrediction();
  if (message) toast(message);
}
function replaceGame(next,isDemo=false) {
  const clean=validateGame(next);
  if (!isDemo) store.save(clean,{backup:true});
  game=clean;demo=isDemo;history.clear();locked=false;loadError='';invalidate();
  bookFilter='';roleFilter='';roleTeam='all';noteSearch='';noteType='';
  resetBoard();
  Object.assign(investigationView,{person:'',phase:'',query:'',type:'all',page:0});
  view='table';close();render();schedulePrediction();
}
function event(g,type,text,playerIds=[],sourceId='',value='',roleId='') {
  if (g.events.length>=2000) throw new Error(tr('Journal plein. Exporte ce carnet avant de commencer une nouvelle partie.','Journal full. Export before starting a new game.'));
  g.events.push({id:uid(),type,text,playerIds,sourceId,roleId,value,day:g.day,phase:g.phase,aliveSnapshot:g.players.filter(p=>p.alive).map(p=>p.id)});
}
function harden(root) {
  for (const el of $$('input[type=search],input[type=text],input:not([type]),textarea',root)) {
    el.setAttribute('autocomplete','off');
    el.setAttribute('spellcheck','false');
    el.setAttribute('autocapitalize','off');
    el.setAttribute('autocorrect','off');
  }
}
const DRAFT_KEY='botc-player-draft';
function draftableForm(d) { return $('#express-form',d)||$('#observation-form',d)||$('#self-form',d)||$('#retain-form',d); }
function saveDraft() {
  const d=$('#dialog');if(!d.open)return;
  const form=draftableForm(d);if(!form)return;
  const fields={};
  for(const el of $$('textarea,input[type=text],input[type=search]',form))if(el.value.trim()&&(el.name||el.id))fields[el.name||el.id]=el.value;
  try{Object.keys(fields).length?sessionStorage.setItem(DRAFT_KEY,JSON.stringify({form:form.id,fields})):sessionStorage.removeItem(DRAFT_KEY);}catch{}
}
function restoreDraft(d) {
  const form=draftableForm(d);if(!form)return;
  let draft;try{draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||'null');}catch{return;}
  if(!draft||draft.form!==form.id)return;
  let restored=false;
  for(const [name,value] of Object.entries(draft.fields||{})){
    const el=form.querySelector(`[name="${CSS.escape(name)}"]`)||form.querySelector(`#${CSS.escape(name)}`);
    if(el&&!el.value){el.value=value;restored=true;}
  }
  if(restored)toast(tr('Brouillon récupéré','Draft recovered'));
}
function clearDraft() { try{sessionStorage.removeItem(DRAFT_KEY);}catch{} }
function open(title,html,init) {
  const dialog=$('#dialog');
  if (!dialog.open) returnFocus=document.activeElement;
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><div class="row"><button type="button" class="icon-button" data-action="mask" aria-label="${tr('Masquer l’écran','Hide screen')}" title="${tr('Masquer l’écran','Hide screen')}">◐</button><button type="button" class="icon-button" data-action="close" aria-label="${tr('Fermer','Close')}">×</button></div></div><div class="dialog-body"><p id="form-error" class="notice error" role="alert" hidden></p>${html}</div>`;
  if (!dialog.open) dialog.showModal();
  harden(dialog);
  if (init) init(dialog);
  restoreDraft(dialog);
}
function close() { const d=$('#dialog'); saveDraft(); explainer?.cancel(); if(d.open)d.close(); }
function confirmAction(title,text,action) {
  open(title,`<p class="spaced">${esc(text)}</p><div class="dialog-footer">${button('close',tr('Annuler','Cancel'))}<button id="confirm-action" class="primary">${tr('Confirmer','Confirm')}</button></div>`,d=>{
    $('#confirm-action',d).onclick=()=>{try{action();close();}catch(e){error(e.message);}};
  });
}
function rolePicker(container, selected=[], allowed=roles(),checkboxes=false) {
  const chosen=new Set(selected);
  container.innerHTML=`<label>${tr('Chercher un rôle','Find a character')}<input class="picker-search" type="search" placeholder="${tr('Nom français ou anglais','French or English name')}"></label><div class="picker-count muted"></div><div class="picker"></div>`;
  const draw=()=>{
    const q=fold($('.picker-search',container).value);
    $('.picker-count',container).textContent=tr(`${chosen.size} rôle(s) sélectionné(s)`,`${chosen.size} character(s) selected`);
    $('.picker',container).innerHTML=allowed.filter(r=>fold(`${r.id} ${r.name.fr} ${r.name.en}`).includes(q)).map(r=>checkboxes?`<label class="role-check"><input type="checkbox" data-checkrole="${esc(r.id)}" ${chosen.has(r.id)?'checked':''}><span>${esc(loc(r.name))}<small>${esc(teamName(r.team))}</small></span></label>`:`<button type="button" data-pick="${esc(r.id)}" aria-pressed="${chosen.has(r.id)}">${esc(loc(r.name))}<span>${chosen.has(r.id)?'✓':esc(teamName(r.team))}</span></button>`).join('') || `<p class="muted">${tr('Aucun résultat','No results')}</p>`;
  };
  container.addEventListener('click',e=>{
    const b=e.target.closest('[data-pick]');if(!b)return;
    const id=b.dataset.pick;chosen.has(id)?chosen.delete(id):chosen.add(id);draw();
    $(`[data-pick="${id}"]`,container)?.focus();
  });
  $('.picker-search',container).oninput=draw;draw();
  container.addEventListener('change',e=>{if(!e.target.matches('[data-checkrole]'))return;const id=e.target.dataset.checkrole;e.target.checked?chosen.add(id):chosen.delete(id);draw();$(`[data-checkrole="${id}"]`,container)?.focus();});
  return ()=>[...chosen];
}
function playerPicker(container,selected=[],allowed=game.players) {
  allowed=[...allowed,...(game.archivedPlayers||[]).filter(p=>selected.includes(p.id)&&!allowed.some(x=>x.id===p.id))];
  const chosen=new Set(selected);
  const draw=()=>{container.innerHTML=allowed.map(p=>`<button type="button" data-pickplayer="${p.id}" aria-pressed="${chosen.has(p.id)}">${esc(p.name)}</button>`).join('');};
  container.className='player-picker';
  container.onclick=e=>{const b=e.target.closest('[data-pickplayer]');if(!b)return;const id=b.dataset.pickplayer;chosen.has(id)?chosen.delete(id):chosen.add(id);draw();$(`[data-pickplayer="${id}"]`,container)?.focus();};
  draw();return ()=>[...chosen];
}
function playerOptions(selected='',blank=true,{includeArchived=false}={}) {
  const archived=game.archivedPlayers||[];
  const pool=includeArchived||(selected&&archived.some(p=>p.id===selected))?[...game.players,...archived]:game.players;
  return (blank?`<option value="">${tr('Non précisé','Not specified')}</option>`:'')+pool.map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${esc(p.name)}${game.players.some(x=>x.id===p.id)?'':tr(' (archivé)',' (archived)')}</option>`).join('');
}
function roleOptions(selected='',blank=true) {
  return (blank?`<option value="">${tr('Non précisé','Not specified')}</option>`:'')+roles().map(r=>`<option value="${r.id}" ${r.id===selected?'selected':''}>${esc(loc(r.name))}</option>`).join('');
}
function render() {
  document.documentElement.lang=lang;
  const chrome=[['#skip-link','textContent',tr('Aller au contenu','Skip to content')],
    ['#undo','aria-label',tr('Annuler','Undo')],['#privacy','aria-label',tr('Masquer l’écran','Hide screen')],
    ['#settings','aria-label',tr('Réglages','Settings')],['#nav','aria-label',tr('Navigation principale','Main navigation')],
    ['#cover','aria-label',tr('Écran masqué','Hidden screen')]];
  for(const [selector,attribute,value] of chrome){
    const el=$(selector);if(!el)continue;
    if(attribute==='textContent')el.textContent=value;
    else{el.setAttribute(attribute,value);if(el.hasAttribute('title'))el.setAttribute('title',value);}
  }
  $('#save-status').textContent=demo?tr('Démo non enregistrée','Unsaved demo'):locked?tr('Lecture seule','Read only'):game?tr('Enregistré ici','Saved here'):tr('Carnet privé','Private notebook');
  $('#undo').disabled=!history.canUndo() || locked;
  $('#nav').hidden=!game;
  $('#thumb-bar').hidden=!game;
  $('#banner').hidden=!demo&&!locked&&!loadError&&!updateReady;
  if(demo)$('#banner').textContent=tr('PARTIE FICTIVE • Ton vrai carnet est intact.','FICTIONAL GAME • Your real notebook is untouched.');
  else if(locked)$('#banner').textContent=tr('Cette partie a changé dans une autre fenêtre. Recharge pour reprendre.','This game changed in another window. Reload to resume.');
  else if(loadError)$('#banner').textContent=loadError;
  else if(updateReady)$('#banner').innerHTML=`${esc(tr('Nouvelle version disponible.','New version available.'))} ${button('apply-update',tr('Mettre à jour maintenant','Update now'))}`;
  else $('#banner').textContent='';
  if(!game){renderWelcome();return;}
  if(view==='worlds'&&!unlocked())view='table';
  const nav=[['table','◎','Joueurs','Players'],['overview','⌘','Tableau','Board'],['journal','≡','Journal','Log'],...(unlocked()?[['worlds','◇','Hypothèses','Hypotheses']]:[]),['script','▤','Rôles','Characters']];
  $('#nav').innerHTML=nav.map(([id,icon,fr,en])=>`<button data-action="view" data-view="${id}" class="${view===id?'active':''}" aria-current="${view===id?'page':'false'}"><span class="nav-icon" aria-hidden="true">${icon}</span>${tr(fr,en)}</button>`).join('');
  $('#thumb-bar').innerHTML=`${button('express',tr('⚡ Noter','⚡ Capture'),'primary thumb-main')}<button type="button" class="icon-button thumb-hide" data-action="mask" aria-label="${tr('Masquer l’écran','Hide screen')}" title="${tr('Masquer l’écran','Hide screen')}">◐</button>`;
  ({table:renderTable,overview:renderOverview,journal:renderJournal,worlds:renderWorlds,script:renderScript}[view])();
}
function renderWelcome() {
  $('#main').innerHTML=`
    <section class="hero">
      <div><div class="eyebrow">${tr('Blood on the Clocktower • Compagnon non officiel','Blood on the Clocktower • Unofficial companion')}</div>
      <h1>${tr('Tout le monde<br>a une version.','Everyone has<br>a story.')}<br><span style="color:var(--cp-accent)">${tr('Garde le fil.','Keep the thread.')}</span></h1>
      <p>${tr('Les confidences, les indices, tes intuitions. Un carnet privé qui relie les pièces sans jouer à ta place.','Claims, clues, your hunches. A private notebook that connects the pieces without playing for you.')}</p>
      <div class="row">${button('new',tr('Ouvrir mon carnet','Start my notebook'),'primary')}${button('demo',tr('Explorer une démo','Explore a demo'))}${button('onboarding',tr('Comment ça marche','How it works'))}</div>
      <p class="footer-note">${tr('Sans compte. Sans connexion au Conteur. Utilisable hors ligne après installation du cache.','No account. No connection to the Storyteller. Works offline once cached.')}</p></div>
      <div class="hero-art" aria-hidden="true"><div class="hero-center"><strong>?</strong><span>${tr('plusieurs vérités<br>possibles','many possible<br>truths')}</span></div>${[[50,0,'A'],[93,25,'?'],[93,75,'B'],[50,100,'◇'],[7,75,'C'],[7,25,'!']].map(([x,y,t])=>`<span class="orbit" style="left:${x}%;top:${y}%">${t}</span>`).join('')}</div>
    </section>
    <div class="features">
      <section class="card"><span class="feature-number">01 / ${tr('CAPTURER','CAPTURE')}</span><h2>${tr('Une confidence, trois gestes.','A claim, three taps.')}</h2><p class="muted">${tr('Un joueur, un rôle, enregistrer. Les déclarations multiples et les changements restent dans l’historique.','A player, a character, save. Multiple claims and changes stay in your history.')}</p></section>
      <section class="card"><span class="feature-number">02 / ${tr('RECOUPER','CONNECT')}</span><h2>${tr('Séparer le dit du déduit.','Separate words from deductions.')}</h2><p class="muted">${tr('Ce qui a été annoncé n’est pas ce qui est vrai. Le tableau d’enquête relie tes notes entre elles, sans jamais conclure à ta place.','What was said is not necessarily true. The investigation board connects your notes without ever concluding for you.')}</p></section>
      <section class="card"><span class="feature-number">03 / ${tr('SE SOUVENIR','REMEMBER')}</span><h2>${tr('Ce que toi tu as dit.','What you said yourself.')}</h2><p class="muted">${tr('Note tes propres annonces, à qui et quand, et garde les informations différées nuit après nuit. Le carnet ne joue pas à ta place et ne rend aucun verdict.','Record your own claims, to whom and when, and keep delayed information night after night. The notebook never plays for you and never rules on anything.')}</p></section>
    </div>
    <p class="footer-note">Sébastien Place / @sebplace • <a href="./guide.html">${tr('Guide et limites','Guide and limitations')}</a> • CC BY-NC-SA 4.0 • ${tr('À utiliser avec l’accord de la table.','Use with your table’s agreement.')}</p>`;
}
function renderTable() {
  const alive=game.players.filter(p=>p.alive).length;
  const ghosts=game.players.filter(p=>!p.alive&&p.ghost).length;
  $('#main').innerHTML=`
    <div class="table-bar">
      <div class="table-bar-title"><h1>${esc(game.title)}</h1><p class="muted small">${esc(game.script.name)}</p></div>
      ${button('phase',`${esc(phaseName())} ›`,'phase-pill')}
      ${button('table-menu','⋯','icon-button',`aria-label="${tr('Autres outils','More tools')}"`)}
    </div>
    <p class="table-pulse">${tr(`${alive} en vie sur ${game.players.length}`,`${alive} alive of ${game.players.length}`)}${ghosts?` · ${tr(`${ghosts} vote(s) fantôme(s)`,`${ghosts} ghost vote(s)`)}`:''}</p>
    <div class="row quick-actions">${button('night',tr('☾ Nuit','☾ Night'))}${button('round',tr('⚖ Votes','⚖ Votes'))}${button('note',tr('✎ Note','✎ Note'))}</div>
    <div class="shape-switch" role="group" aria-label="${tr('Forme d’affichage','Display shape')}">
      <button type="button" data-action="shape" data-shape="liste" class="${tableShape==='liste'?'active':''}" aria-pressed="${tableShape==='liste'}">${tr('Liste','List')}</button>
      <button type="button" data-action="shape" data-shape="plan" class="${tableShape==='plan'?'active':''}" aria-pressed="${tableShape==='plan'}">${tr('Plan','Plan')}</button>
    </div>
    <div class="table-layout"><div>
    ${tableShape==='plan'?`<div id="plan-root"></div>`:`
    <label class="search table-search"><span class="sr-only">${tr('Trouver un joueur','Find a player')}</span><input id="player-search" type="search" placeholder="${tr('Chercher un joueur ou un rôle…','Find a player or character…')}" value="${esc(bookFilter)}"></label>
    <div class="player-grid" id="player-grid"></div>
    <p class="seat-legend"><span>⚡ <b>${tr('il me parle','talked to me')}</b></span><span>🗣 <b>${tr('rôle annoncé','claimed role')}</b></span><span>☠ <b>${tr('noter mort','mark dead')}</b></span><span>${tr('touche la ligne pour tout voir','tap the row for everything')}</span></p>`}
    <p class="footer-note">${tr('Confiance et soupçons sont ton appréciation, pas une vérité. Les morts continuent à jouer.','Trust and suspicion are your judgement, not truth. Dead players still play.')}</p></div>
    <aside class="table-aside"><section class="card"><h3>${tr('Derniers échanges','Recent entries')}</h3><div class="mini-timeline">${timeline(game.events.slice(-3).reverse(),true)}</div></section></aside></div>
    ${estimatesOn()?`<section class="card spaced"><h2>${tr('Démons et sbires possibles','Possible Demons and Minions')}</h2><div id="estimates-summary" aria-live="polite">${predictionSummary()}</div></section>`:''}`;
  if(tableShape==='plan')drawPlan();
  else{drawPlayers();$('#player-search').oninput=e=>{bookFilter=e.target.value;drawPlayers();};}
}
function drawPlan() {
  const root=$('#plan-root');
  if(!root)return;
  try{
    const model=buildPlanModel(game,{selectedId:planSeat,size:320});
    root.innerHTML=renderPlan(model,{lang,roleName:rname,selectedId:planSeat,size:320});
    if(planSeat)keepPlanInView(root);
  }catch(e){console.error(e);root.innerHTML=`<p class="notice error">${esc(tr('Le plan n’a pas pu s’afficher : ','The plan could not render: ')+e.message)}</p>`;}
}
// La reponse ne sert a rien sous la ligne de flottaison : on cale le cadran et
// ses liens dans l ecran, et seulement si le panneau depasse vraiment.
function keepPlanInView(root) {
  const panel=$('.plan-connections',root);
  if(!panel||typeof panel.getBoundingClientRect!=='function')return;
  requestAnimationFrame(()=>{
    const box=panel.getBoundingClientRect();
    const limit=window.innerHeight-(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock-h'))||150);
    if(box.bottom<=limit)return;
    const section=root.querySelector('.plan')||root;
    section.scrollIntoView({block:'start',behavior:'smooth'});
  });
}
function drawPlayers() {
  const q=fold(bookFilter);
  $('#player-grid').innerHTML=game.players.filter(p=>fold(p.name+' '+roleLabel(latestClaim(p.id)?.roleIds || [])).includes(q)).map(p=>{
    const c=latestClaim(p.id),index=game.players.indexOf(p)+1;
    const state=p.alive?'':(p.ghost?tr('mort · vote restant','dead · vote left'):tr('mort · vote utilisé','dead · vote used'));
    return `<article class="player-card seat ${p.id===game.myId?'mine':''} ${p.alive?'':'dead'} trust-${p.trust}">
      <button class="player-open seat-open" data-action="player" data-id="${p.id}" aria-label="${esc(tr('Ouvrir ','Open ')+p.name)}">
        <span class="seat-num">${String(index).padStart(2,'0')}</span>
        <span class="seat-body">
          <span class="seat-name">${esc(p.name)}${p.id===game.myId?` <em>${tr('moi','me')}</em>`:''}${p.traveller?` <span class="seat-flag">${tr('voyageur','traveller')}</span>`:''}</span>
          <span class="seat-claim">${c?esc(roleLabel(c.roleIds)):tr('—','—')}</span>
        </span>
        ${state?`<span class="seat-state">${state}</span>`:''}
        <span data-compact-estimate="${p.id}">${compactPrediction(p.id)}</span>
      </button>
      <div class="seat-actions">
        ${button('express','⚡','seat-act',`data-id="${p.id}" aria-label="${esc(tr('Noter ce que dit ','Note what ')+p.name+tr('','  says'))}" title="${tr('Il me parle','Talked to me')}"`)}
        ${button('claim','🗣','seat-act',`data-id="${p.id}" aria-label="${esc(tr('Rôle annoncé par ','Character claimed by ')+p.name)}" title="${tr('Rôle annoncé','Claimed character')}"`)}
        ${button('life',p.alive?'☠':'✚','seat-act',`data-id="${p.id}" aria-label="${esc((p.alive?tr('Noter la mort de ','Mark dead: '):tr('Noter vivant : ','Mark alive: '))+p.name)}" title="${p.alive?tr('Noter mort','Mark dead'):tr('Noter vivant','Mark alive')}"`)}
      </div></article>`;
  }).join('') || `<p class="empty">${tr('Aucun joueur trouvé.','No player found.')}</p>`;
}
function timeline(entries,mini=false) {
  if(!entries.length)return `<p class="muted">${tr('Rien de noté pour le moment.','Nothing noted yet.')}</p>`;
  const labels={claim:['Déclaration','Claim'],info:['Indice','Clue'],note:['Note','Note'],death:['Mort','Death'],revival:['Retour en vie','Revival'],execution:['Exécution','Execution'],vote:['Vote','Vote'],phase:['Phase','Phase'],night:['Bilan de nuit','Night summary']};
  return entries.map(e=>`<article class="timeline-item"><div class="row"><small>${esc(phaseName(e))} · ${tr(...labels[e.type])}</small>${!mini?button('delete-event','×','icon-button',`data-id="${e.id}" aria-label="${tr('Supprimer cette entrée','Delete this entry')}"`):''}</div><h3>${e.playerIds.length?esc(e.playerIds.map(pname).join(' / ')):esc(game.title)}</h3>${e.sourceId?`<small>${tr('Source','Source')} : ${esc(pname(e.sourceId))}</small>`:''}<p>${esc(e.text)}</p>${e.roleId?`<span class="chip">${esc(rname(e.roleId))}</span>`:''}${e.value&&e.type!=='claim'?` <span class="chip accent">${esc(e.value)}</span>`:''}${!mini?eventDetails(e):''}</article>`).join('');
}
function renderJournal() {
  $('#main').innerHTML=`<div class="section-head"><div><div class="eyebrow">${tr('Rien ne se perd','Keep every thread')}</div><h1>${tr('Mon carnet','My notebook')}</h1></div>${button('note',tr('＋ Note','＋ Note'),'primary')}</div>
    <div class="filters">${['', 'claim','info','vote','execution','night','note'].map((v,i)=>button('journal-filter',[tr('Tout','All'),tr('Déclarations','Claims'),tr('Indices','Clues'),tr('Votes','Votes'),tr('Exécutions','Executions'),tr('Nuits','Nights'),tr('Notes','Notes')][i],noteType===v?'selected':'',`data-type="${v}"`)).join('')}</div>
    <label class="search">${tr('Rechercher dans le carnet','Search notebook')}<input id="note-search" type="search" value="${esc(noteSearch)}" placeholder="${tr('Joueur, rôle, mot-clé…','Player, character, keyword…')}"></label><div class="grid"><section class="card" id="journal-entries"></section><aside class="card"><h2>${tr('Pistes à recouper','Threads to cross-check')}</h2>${issues()}<div class="notice">${tr('Deux personnes peuvent honnêtement croire au même rôle. Une contradiction suggère une question, pas un menteur certain.','Two people can honestly believe they are the same character. A contradiction suggests a question, not a proven liar.')}</div></aside></div>`;
  drawJournal();$('#note-search').oninput=e=>{noteSearch=e.target.value;drawJournal();};
}
function recordType(type) {
  const types={claim:['Déclaration','Claim'],info:['Indice','Clue'],note:['Note','Note'],vote:['Vote','Vote'],execution:['Exécution','Execution'],night:['Nuit','Night'],death:['Mort annoncée','Announced death'],revival:['Retour en vie','Revival'],phase:['Moment','Phase'],hypothesis:['Idée à tester','Idea to test']};
  return tr(...(types[type]||types.note));
}
function impactLabel(r) {
  return r.impact==='weight'?tr(`Poids subjectif ×${r.multiplier}`,`Subjective weight ×${r.multiplier}`):r.impact==='strict'?tr('Restriction choisie','Chosen restriction'):r.impact==='conditional'?tr('Filtre sous conditions','Conditional filter'):tr('Noté, non utilisé par le calcul','Recorded, not used by calculation');
}
function renderOverview() {
  $('#main').innerHTML=`<div class="section-head"><div><div class="eyebrow">${tr('Tout ce que tu as noté, relié','Everything you noted, connected')}</div><h1>${tr('Le tableau','The board')}</h1></div></div>
    
    <div id="board-root"></div>
    ${unlocked()?`<section class="card spaced"><h2>${tr('Ce que le calcul en déduit','What the calculation infers')}</h2><div id="overview-estimates" aria-live="polite">${predictionSummary()}</div></section>`:''}`;
  drawOverview();
}
function boardContext() {
  return {game,catalogue,prediction,lang,showModel:unlocked(),playerName:pname,roleName:rname,openPlayer,openRecord:inspectRecord};
}
function drawOverview() {
  const root=$('#board-root');
  if(!root)return;
  try{renderBoard(root,boardContext());}
  catch(e){console.error(e);root.innerHTML=`<p class="notice error">${esc(tr('Le tableau n’a pas pu s’afficher : ','The board could not render: ')+e.message)}</p>`;}
}
function inspectRecord(key) {
  const record=buildInvestigation(game).records.find(r=>r.id===key);
  if(!record){toast(tr('Cette information n’existe plus.','This record no longer exists.'));return;}
  if(record.type==='claim'){
    const c=game.claims.find(c=>c.id===record.ref);
    open(tr('Déclaration reliée','Linked claim'),`<p>${esc(pname(c.playerId))} · ${esc(phaseName(c))}</p><h3>${esc(roleLabel(c.roleIds))}</h3><p>${tr('Source : ','Source: ')}${esc(pname(c.sourceId||c.playerId))}</p><p>${esc(c.note)}</p><p class="notice">${esc(impactLabel(record))}. ${record.latest?tr('Dernière déclaration chronologique.','Chronologically latest claim.'):tr('Ancienne déclaration, non pondérée.','Older claim, not weighted.')}</p><div class="row">${button('edit-claim',tr('Corriger / pondérer','Edit / weight'),'',`data-id="${c.id}"`)}${button('player',tr('Ouvrir la fiche','Open player card'),'',`data-id="${c.playerId}"`)}</div>`);
  }else if(record.relation)open(tr('Une idée imposée au modèle','An idea imposed on the model'),`<h3 class="spaced">${esc(describeRelation(record.relation,pname,rname,lang))}</h3><p>${esc(record.text)}</p><p class="notice">${tr('C’est une supposition de l’utilisateur, pas une règle prouvée par les témoignages.','This is a user assumption, not a rule proven by testimony.')}</p>${button('view',tr('Modifier mes hypothèses','Edit hypotheses'),'',`data-view="worlds"`)}`);
  else{const e=game.events.find(e=>e.id===record.ref);open(recordType(e.type),timeline([e]));}
}
function openCoverage() {
  const labels={recorded:['Suivi enregistré','Recorded bookkeeping'],assumed:['Hypothèse utilisateur','User-assumed model'],partial:['Couverture partielle','Partial coverage'],missing:['Non simulé','Not simulated']};
  open(tr('Ce que le carnet ne fait pas','What the notebook does not do'),`<p class="notice warning"><strong>${tr('Ce n’est pas une simulation du jeu, même pour Trouble Brewing.','This is not a simulation of the game, not even for Trouble Brewing.')}</strong> ${tr('Le carnet enregistre ce que tu notes. Il ne rejoue aucune capacité et ne tranche aucune interaction de règles à ta place.','The notebook records what you write. It replays no ability and settles no rules interaction for you.')}</p>${RULES_COVERAGE.filter(r=>unlocked()||r.status!=='assumed').map(r=>`<section class="coverage-row"><span class="chip ${r.status==='missing'?'warning':''}">${tr(...labels[r.status])}</span><h3>${tr(...r.title)}</h3><p>${tr(...r.detail)}</p><a href="${r.url}" target="_blank" rel="noopener noreferrer">${tr('Source officielle','Official source')} ↗</a></section>`).join('')}<p class="notice">${tr('En cas de doute sur une règle, demande au Conteur : c’est lui qui tranche, jamais ce carnet.','When a rule is unclear, ask the Storyteller: they decide, never this notebook.')}</p>`);
}
let noteType='';
function drawJournal() {
  const q=fold(noteSearch);
  const entries=game.events.filter(e=>(!noteType||(noteType==='vote'?(e.type==='vote'||e.ballot?.length):e.type===noteType))&&fold(e.text+' '+e.playerIds.map(pname).join(' ')+' '+(e.roleId?rname(e.roleId):'')+' '+pname(e.sourceId)+' '+(e.ballot||[]).map(v=>pname(v.playerId)).join(' ')+' '+phaseName(e)).includes(q)).slice().reverse().sort(byTime);
  $('#journal-entries').innerHTML=entries.length?timeline(entries):`<div class="empty"><strong>${tr('Une page encore blanche.','A blank page for now.')}</strong>${tr('Ajoute un indice depuis la table.','Add a clue from the table.')}</div>`;
}
function issues() {
  const result=[];
  for(const p of game.players) {
    const claims=game.claims.filter(c=>c.playerId===p.id);
    if(claims.length>1 && new Set(claims.map(c=>[...c.roleIds].sort().join(','))).size>1) result.push(tr(`${p.name} a donné plusieurs versions. Vérifie à quel moment et à qui.`,`${p.name} gave different versions. Check when and to whom.`));
  }
  const latest=game.players.map(p=>({p,c:latestClaim(p.id)})).filter(x=>x.c?.roleIds.length===1);
  for(const r of roles()){
    const holders=latest.filter(x=>x.c.roleIds[0]===r.id);
    if(holders.length>1)result.push(`${tr('Double déclaration','Double claim')} : ${loc(r.name)} (${holders.map(x=>x.p.name).join(', ')}).`);
  }
  const missing=game.players.filter(p=>!latestClaim(p.id));
  if(missing.length)result.push(tr(`À écouter : ${missing.map(p=>p.name).join(', ')}.`,`Hear from: ${missing.map(p=>p.name).join(', ')}.`));
  if(!result.length)result.push(tr('Demande quand l’information a été reçue, et si elle est directe ou rapportée.','Ask when information was received, and whether it was direct or second-hand.'));
  return result.map(s=>`<div class="issue">${esc(s)}</div>`).join('');
}
function renderScript() {
  $('#main').innerHTML=`<div class="section-head"><div><div class="eyebrow">${tr('Les rôles possibles, pas le sac réel','Possible characters, not the actual bag')}</div><h1>${esc(game.script.name)}</h1></div>${button('script-import',tr('Importer','Import'))}</div>
    <div class="notice">${tr('Le script indique les rôles autorisés. Il ne révèle ni les rôles distribués ni les bluffs. Les capacités ci-dessous sont des aides non officielles ; le Conteur tranche les règles.','The script lists allowed characters, not dealt characters or bluffs. These are unofficial reminders; the Storyteller resolves the rules.')}</div>
    ${game.script.warnings.length?`<details><summary>${tr('Remarques sur cet import','Import warnings')} (${game.script.warnings.length})</summary>${game.script.warnings.map(w=>`<p class="muted">${esc(w)}</p>`).join('')}</details>`:''}
    <label class="search">${tr('Chercher un rôle ou une capacité','Find a character or ability')}<input type="search" id="role-search" value="${esc(roleFilter)}" placeholder="${tr('Empathe, poison, nuit…','Empath, poison, night…')}"></label>
    <div class="filters">${['all',...TEAMS,'traveller','fabled','unknown'].map(t=>button('role-team',t==='all'?tr('Tous','All'):teamName(t),roleTeam===t?'selected':'',`data-team="${t}"`)).join('')}</div><div id="role-list" class="role-list"></div>
    <div class="card spaced"><h2>${tr('Trouver d’autres scripts','Find more scripts')}</h2><p>${tr('Crée ou récupère un fichier JSON, puis importe-le ici. La bibliothèque en ligne n’est pas copiée et peut limiter l’accès automatique. Un import ne change pas un carnet en cours : il prépare une nouvelle partie.','Create or download a JSON file, then import it here. The online directory is not mirrored and may restrict automated access. Importing a script prepares a new game rather than changing your current notebook.')}</p><div class="row"><a href="https://script.bloodontheclocktower.com/" target="_blank" rel="noopener noreferrer">Script Tool</a> · <a href="https://botcscripts.com/" target="_blank" rel="noopener noreferrer">BOTC Scripts</a> · <a href="https://bloodontheclocktower.com/teensyville" target="_blank" rel="noopener noreferrer">Teensyville</a></div></div>`;
  drawRoles();$('#role-search').oninput=e=>{roleFilter=e.target.value;drawRoles();};
}
function drawRoles() {
  const q=fold(roleFilter);
  $('#role-list').innerHTML=roles().filter(r=>(roleTeam==='all'||r.team===roleTeam)&&fold(`${r.id} ${r.name.fr} ${r.name.en} ${r.ability.fr} ${r.ability.en}`).includes(q)).map(r=>`<article class="card role"><span class="eyebrow">${esc(teamName(r.team))}</span><h3>${esc(loc(r.name))}</h3><div class="role-id">${esc(r.id)}</div><p>${esc(loc(r.ability)||tr('Pas de fiche intégrée. Consulte le script fourni par le Conteur.','No bundled reminder. Consult your Storyteller’s script.'))}</p><a href="https://wiki.bloodontheclocktower.com/${encodeURIComponent(r.name.en.replaceAll(' ','_'))}" target="_blank" rel="noopener noreferrer">${tr('Wiki officiel ↗','Official wiki ↗')}</a></article>`).join('')||`<p class="empty">${tr('Aucun rôle trouvé.','No character found.')}</p>`;
}
function renderWorlds() {
  const s=scenario();
  const modelWarning=tr('Modèle de répartition INITIALE : un rôle différent par joueur, catégories et effectifs fixés par toi. Il ne simule pas les capacités, l’ivresse, le poison, les enregistrements trompeurs, les changements de rôle ou d’alignement, les jinxes ni les décisions du Conteur. Une catégorie de rôle n’est pas l’alignement du joueur.','INITIAL assignment model: one distinct character per player, with categories and counts set by you. It does not simulate abilities, drunkenness, poison, misregistration, character/alignment changes, jinxes or Storyteller decisions. A character category is not a player’s alignment.');
  $('#main').innerHTML=`<div class="section-head"><div><div class="eyebrow">${tr('Un atelier de déduction, pas un verdict','A deduction workbench, not a verdict')}</div><h1>${tr('Et si…','What if…')}</h1></div>${button('clone-scenario',tr('Dupliquer','Duplicate'))}</div>
    <div class="row"><label style="flex:1">${tr('Scénario de réflexion','Hypothesis branch')}<select id="scenario-select">${game.scenarios.map(x=>`<option value="${x.id}" ${x.id===s.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>${button('scenario-settings',tr('Réglages','Settings'))}</div>
    ${unlocked()?`<section class="card"><div class="row spread"><h2>${tr('Estimations avec déclarations et événements','Estimates from claims and events')}</h2>${button('estimate',tr('Calculer / actualiser','Calculate / refresh'),'primary')}</div><div id="world-estimates">${predictionSummary()}</div></section>`:''}
    <p class="notice warning">${modelWarning}</p>
    <div class="grid"><section class="card"><h2>${tr('1. Mes suppositions de départ','1. My starting assumptions')}</h2><p class="muted">${tr('Un choix vide laisse tous les rôles du script possibles. Ni les déclarations ni le rôle qui t’a été montré ne sont imposés au calcul.','An empty choice leaves every script character possible. Neither claims nor your shown character are imposed on the calculation.')}</p>
    ${normalPlayers().map(p=>`<div class="domain-row"><div class="avatar">${game.players.indexOf(p)+1}</div><div class="grow"><strong>${esc(p.name)}</strong><div class="muted">${s.domains[p.id]?.length?esc(roleLabel(s.domains[p.id])):tr('Tous les rôles restent possibles','All characters remain possible')}</div></div>${button('domain',tr('Choisir','Choose'),'',`data-id="${p.id}"`)}</div>`).join('')}
    <p class="footer-note">${tr('Les Voyageurs sont exclus du calcul. Les morts restent dans la répartition initiale.','Travellers are excluded. Dead players remain part of the initial assignment.')}</p></section>
    <section class="card"><h2>${tr('2. Tester une idée sur les rôles','2. Test an idea about characters')}</h2><p>${tr('Exemple : « Parmi Alice et Bruno, exactement un était l’Empathe au départ. » Tu demandes au calcul de ne garder que les répartitions qui respectent cette idée. Cela ne prouve pas que ton idée est vraie.','Example: “Among Alice and Bruno, exactly one initially was the Empath.” You ask the calculation to keep only assignments fitting that idea. This does not prove your idea is true.')}</p>
      ${s.constraints.map(c=>`<div class="issue"><label class="check"><input type="checkbox" data-constraint="${c.id}" ${c.enabled?'checked':''}><span>${esc(describeRelation(c,pname,rname,lang))}</span></label><p class="muted">${tr('Je le suppose parce que : ','I assume this because: ')}${esc(c.note)}</p>${c.fragile?`<span class="chip warning">${tr('Information peut-être fausse','Information may be false')}</span>`:''}${button('delete-constraint',tr('Retirer cette idée','Remove this idea'),'',`data-id="${c.id}"`)}</div>`).join('')||`<p class="empty">${tr('Facultatif : laisse vide si tu veux seulement conserver les témoignages, sans imposer d’idée au calcul.','Optional: leave empty to keep testimony without imposing an idea on the calculation.')}</p>`}
      ${button('constraint',tr('＋ Construire une phrase « Et si… »','＋ Build a “What if…” sentence'),'full spaced')}
      <details class="spaced"><summary>${tr('Pourquoi pas de déduction automatique depuis un indice ?','Why not automatically infer from a clue?')}</summary><p>${tr('Un « oui » de Voyante peut venir du leurre ou d’une Recluse. Une Empathe empoisonnée peut recevoir une information vraie ou fausse. Une information sur une nuit passée ne décrit pas forcément les rôles de départ. Seule ta supposition explicite entre dans ce modèle.','A Fortune Teller yes can come from the red herring or a Recluse. A poisoned Empath may receive true or false information. Information about a later night may not describe starting characters. Only your explicit assumption enters this model.')}</p></details></section></div>
    <section class="card spaced"><div class="section-head"><div><h2>${tr('3. Explorer les mondes compatibles','3. Explore compatible worlds')}</h2><p class="muted">${tr('Recherche locale bornée, sans envoyer les notes.','Bounded local search; no notes are sent.')}</p></div></div>
      <label class="check"><input type="checkbox" id="solver-confirm"><span>${tr('Je veux tester ces suppositions, sans les considérer comme des faits ni comme une simulation complète du jeu.','I want to test these assumptions, not treat them as facts or a complete game simulation.')}</span></label>
      <div class="row">${button('analyze',analyzing?tr('Recherche…','Searching…'):tr('Explorer cette hypothèse','Explore this hypothesis'),'primary',analyzing?'disabled':'')}${analyzing?button('stop-analysis',tr('Arrêter','Stop')):''}</div><div id="analysis-result">${analysisHTML()}</div></section>
    <section class="card spaced"><h2>${tr('Et les chances de victoire ?','What about chances of winning?')}</h2><p>${tr('Non estimables de façon fiable à partir de ce carnet. Les choix du Démon, les bluffs, les protections, les transformations et les décisions futures changent l’issue. Un « 70 % pour le bien » ici serait trompeur.','Not reliably estimable from this notebook. Demon choices, bluffs, protections, transformations and future decisions change the outcome. A “70% chance for good” here would be misleading.')}</p><div class="stats"><div class="stat"><strong>${normalPlayers().filter(p=>p.alive).length}</strong>${tr('non-Voyageurs en vie','living non-Travellers')}</div><div class="stat"><strong>${game.players.filter(p=>!p.alive&&p.ghost).length}</strong>${tr('votes fantômes notés','noted ghost votes')}</div></div><p class="muted">${tr('Ces compteurs décrivent tes notes, pas une condition de victoire automatique. Consulte les exceptions du script et le Conteur.','These counters describe your notes, not an automatic win condition. Consult script exceptions and the Storyteller.')}</p></section>`;
  $('#scenario-select').onchange=e=>change(g=>g.activeScenario=e.target.value);
  $$('[data-constraint]').forEach(el=>el.onchange=()=>{try{change(g=>g.scenarios.find(s=>s.id===g.activeScenario).constraints.find(c=>c.id===el.dataset.constraint).enabled=el.checked);}catch(e){error(e.message);}});
}
function analysisHTML() {
  if(!analysis)return '';
  const {result:r}=analysis;
  const complete=r.complete;
  if(complete&&!r.worlds)return `<div class="notice error"><h3>${tr('Aucun monde compatible avec ces suppositions.','No world fits these assumptions.')}</h3><p>${tr('Cela invalide leur combinaison dans ce modèle, pas un joueur. Relâche une relation, élargis les rôles ou corrige les effectifs, puis compare une copie.','This invalidates their combination in this model, not a player. Relax a relationship, widen candidate sets or correct counts, then compare a copy.')}</p><details><summary>${tr('Diagnostic du moteur','Engine diagnostics')}</summary>${r.contradictions.map(c=>`<p>${esc(c)}</p>`).join('')}</details></div>`;
  const title=complete?tr('mondes compatibles dénombrés','compatible worlds counted'):tr('mondes trouvés avant la limite','worlds found before the limit');
  return `<div class="spaced"><div class="worlds-number">${r.worlds.toLocaleString(lang)}</div><p>${title}</p>
    <div class="notice ${complete?'':'warning'}">${complete?tr('Les parts ci-dessous sont des fréquences parmi les répartitions dénombrées, chacune comptée une fois. Elles ne sont PAS des probabilités réelles : les choix du Conteur et les stratégies ne sont pas équiprobables.','Shares below are frequencies among counted assignments, each counted once. They are NOT real probabilities: Storyteller choices and strategies are not equally likely.'):tr('Recherche incomplète. Aucun pourcentage ni rôle impossible n’est déduit de ce sous-ensemble. Réduis les candidats ou ajoute des relations pour finir le dénombrement.','Incomplete search. No percentage or impossible character is inferred from this subset. Narrow candidates or add relationships to complete enumeration.')}</div>
    ${complete?`<div class="result-grid">${normalPlayers().map(p=>{
      const values=Object.entries(r.marginals[p.id]||{}).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
      return `<div class="card quiet-card"><h3>${esc(p.name)}</h3>${values.map(([rid,n])=>`<div class="issue"><div class="row spread"><span>${esc(rname(rid))}</span><strong>${(100*n/r.worlds).toLocaleString(lang,{maximumFractionDigits:1})} %</strong></div><div class="meter"><span style="width:${100*n/r.worlds}%"></span></div></div>`).join('')}<small>${tr('Parts de mondes, rôle initial.','World shares, initial character.')}</small></div>`;
    }).join('')}</div>`:''}
    ${r.examples.length?`<details class="spaced"><summary>${tr('Voir des exemples de mondes, sans classement de plausibilité','See example worlds, not ranked by likelihood')}</summary>${r.examples.slice(0,3).map((w,i)=>`<h3>${tr('Exemple','Example')} ${i+1}</h3><p>${normalPlayers().map(p=>`${esc(p.name)} : ${esc(rname(w[p.id]))}`).join(' · ')}</p>`).join('')}</details>`:''}
    <p class="footer-note">${r.nodes.toLocaleString(lang)} ${tr('nœuds explorés','nodes explored')} · ${complete?tr('Dénombrement complet dans le modèle','Complete enumeration within the model'):tr('Limite atteinte','Limit reached')}</p></div>`;
}
function startAnalysis() {
  if(game.rosterReviewRequired){openScenarioSettings();return;}
  if(!$('#solver-confirm').checked){toast(tr('Confirme les limites du modèle avant de lancer.','Confirm the model limitations first.'));return;}
  if(roles().some(r=>r.team==='unknown'))throw new Error(tr('Ce script contient des rôles inconnus. Le carnet fonctionne, mais ce calcul est désactivé pour ne pas les exclure silencieusement.','This script has unknown characters. Notes work, but analysis is disabled rather than silently excluding them.'));
  const s=scenario(), ps=normalPlayers();
  if(Object.values(s.counts).reduce((a,b)=>a+b,0)!==ps.length)throw new Error(tr('Les effectifs supposés ne correspondent pas aux non-Voyageurs. Corrige-les dans Réglages.','Assumed counts do not match non-Travellers. Adjust Settings.'));
  if(s.constraints.some(c=>c.enabled&&constraintPeople(c).some(id=>player(id)?.traveller)))throw new Error(tr('Une relation active inclut un Voyageur. Retire-la du modèle.','An active relationship includes a Traveller. Remove it from the model.'));
  stopStrictSearch();analyzing=true;requestId=uid();const expected=requestId;
  worker=new Worker('./js/inference-worker.js',{type:'module'});
  worker.onmessage=({data})=>{
    if(data.id!==expected||requestId!==expected)return;
    worker.terminate();worker=null;analyzing=false;
    if(data.error){error(data.error);render();return;}
    analysis={result:data.result,scenario:s.id};
    if(view==='worlds')renderWorlds();
    else toast(tr('Exploration terminée. Résultats dans Hypothèses.','Exploration finished. Results in Hypotheses.'));
  };
  worker.onerror=e=>{stopStrictSearch();error(tr('Le calcul a échoué : ','Analysis failed: ')+e.message);render();};
  worker.postMessage({id:expected,input:{players:ps.map(p=>({id:p.id,candidates:s.domains[p.id]||[]})),roles:modelRoles().map(r=>({id:r.id,team:r.team})),counts:s.counts,constraints:s.constraints.filter(c=>c.enabled).map(c=>toEngineConstraint(c,{deadIds:game.players.filter(p=>!p.alive&&!p.traveller).map(p=>p.id)}))},options:{maxNodes:350000,timeMs:1200,maxWorlds:50000}});
  renderWorlds();
}
function weightOptions(value=1) {
  return [1,2,5,20].map(n=>`<option value="${n}" ${n===value?'selected':''}>${n===1?tr('Neutre : aucune influence','Neutral: no influence'):`${n}× ${tr('plus de poids','more weight')}`}</option>`).join('');
}
const unlocked = () => !!game?.settings?.unlocked;
const estimatesOn = () => unlocked() && !!game?.settings?.showEstimates;
let knocks=[];
function knock() {
  if(!game)return;
  const now=Date.now();
  knocks=knocks.filter(t=>now-t<4000);knocks.push(now);
  if(unlocked()||knocks.length<7)return;
  knocks=[];
  try{change(g=>{g.settings.unlocked=true;},tr('Analyse avancée déverrouillée pour cette partie.','Advanced analysis unlocked for this game.'));openSettings();}catch(e){error(e.message);}
}
function relock() {
  try{change(g=>{g.settings.unlocked=false;g.settings.showEstimates=false;},tr('Reverrouillé. Aucune trace visible.','Re-locked. No visible trace.'));openSettings();}catch(e){error(e.message);}
}
function schedulePrediction() {
  if(!estimatesOn()||locked)return;
  clearTimeout(predictionTimer);predictionBusy=true;
  predictionTimer=setTimeout(runPrediction,250);
  updatePredictionUI();
}
function runPrediction() {
  let model;
  try{model=buildEvidenceModel(game,catalogue,{claimRoleEnrichment:game?.settings?.claimRoleEnrichment!==false});}catch(e){predictionBusy=false;predictionError=e.message;updatePredictionUI();return;}
  if(!estimator)estimator=createEstimator({workerUrl:new URL('./inference-worker.js',import.meta.url),debounceMs:0});
  const gameId=game.id;
  predictionBusy=true;predictionId=uid();const expected=predictionId;
  const hidden=document.visibilityState==='hidden';
  estimator.request(model.input,{mode:'estimate',maxNodes:60000,timeMs:400,maxWorlds:12000,maxSamples:hidden?4000:20000,sampleTimeMs:hidden?300:1400,deadlineMs:hidden?300:400,seed:41721})
    .then(result=>{
      if(expected!==predictionId||game.id!==gameId)return;
      predictionBusy=false;prediction={result,audit:model.audit,skipped:model.skipped};predictionError='';updatePredictionUI();
    })
    .catch(e=>{
      if(e instanceof EstimatorSupersededError||e instanceof EstimatorCancelledError)return;
      if(expected!==predictionId||game.id!==gameId)return;
      predictionBusy=false;predictionError=e.message;updatePredictionUI();
    });
  updatePredictionUI();
}
function updatePredictionUI() {
  $$('#estimates-summary, #world-estimates, #overview-estimates').forEach(el=>el.innerHTML=predictionSummary());
  $$('[data-player-estimate]').forEach(el=>el.innerHTML=playerPrediction(el.dataset.playerEstimate));
  $$('[data-compact-estimate]').forEach(el=>el.innerHTML=compactPrediction(el.dataset.compactEstimate));
  if(view==='overview')drawOverview();
}
function compactPrediction(id) {
  if(!estimatesOn())return '';
  const c=latestClaim(id),r=prediction?.result,row=r?.probabilities?.[id];
  if(!c||!r?.reliable||!row||predictionBusy||predictionError)return '';
  return `<span class="compact-probability">${c.roleIds.slice(0,3).map(rid=>`<span>${esc(rname(rid))}<b>${probabilityNumber(row[rid]||0)}</b></span>`).join('')}<small>${tr('Sous hypothèses','Under assumptions')}</small></span>`;
}
function probabilityNumber(v,hw=0) {
  if(prediction?.result.method==='importance'&&v===0)return tr('non rencontré','not sampled');
  const value=`${(100*v).toLocaleString(lang,{maximumFractionDigits:1})} %`;
  return hw>0?`${value} <small>±${(100*hw).toLocaleString(lang,{maximumFractionDigits:1})}</small>`:value;
}
function halfWidthFor(playerId,roleId) {
  const h=prediction?.result.halfWidth;
  if(!h)return 0;
  return (playerId?h.probabilities?.[playerId]?.[roleId]:h.presence?.[roleId])||0;
}
function predictionStatus() {
  if(!unlocked())return '';
  if(!estimatesOn())return `<p class="muted">${tr('Le calcul est masqué. Le carnet fonctionne entièrement sans lui.','The calculation is hidden. The notebook works fully without it.')}</p>${button('estimate',tr('Afficher le calcul','Show the calculation'))}`;
  if(game.rosterReviewRequired)return `<p class="notice warning">${tr('Liste de joueurs modifiée : le calcul est en pause. Vérifie qui joue et la composition supposée avant de reprendre.','Player list changed: calculation is paused. Check who is playing and the assumed setup before resuming.')}</p>${button('scenario-settings',tr('Revoir la composition','Review setup'))}`;
  if(predictionError)return `<p class="notice error">${esc(predictionError)}</p>`;
  if(predictionBusy)return `<p class="notice" role="status">${tr('Calcul en cours…','Calculating…')}</p>`;
  if(!prediction)return `<p class="muted">${tr('Active le calcul pour croiser les rôles annoncés, la composition supposée et les événements que tu as choisi de faire peser.','Turn on the calculation to combine claimed characters, the assumed setup and the events you chose to weight.')}</p>`;
  const r=prediction.result;
  if(!r.reliable){
    if(r.complete)return `<p class="notice warning">${tr('Tes hypothèses ne vont pas ensemble : aucune répartition ne les respecte toutes. Relâche une idée ou élargis les rôles possibles.','Your assumptions conflict: no assignment satisfies all of them. Relax an idea or widen the possible characters.')}</p>`;
    if(r.reason==='precision')return `<p class="notice warning">${tr('Résultat trop imprécis pour être affiché. Réduis les rôles possibles d’un ou deux joueurs, ou baisse les poids extrêmes.','Result too imprecise to display. Narrow the possible characters for one or two players, or lower extreme weights.')}</p>`;
    return `<p class="notice warning">${tr('Pas assez de tirages stables. Les pourcentages sont masqués plutôt qu’inventés.','Not enough stable draws. Percentages are hidden rather than invented.')}</p>`;
  }
  const chip=r.method==='exact'
    ? `<span class="chip accent">${tr('Calcul complet','Complete')}</span>`
    : `<span class="chip accent">${tr('Estimation rapide','Fast estimate')}</span> <span class="chip">${tr('marge','margin')} ±${(100*(r.precision||0)).toLocaleString(lang,{maximumFractionDigits:1})}</span>`;
  return `<div class="chips">${chip}<span class="chip warning">${tr('Calcul partiel des règles','Partial rules model')}</span></div>
    <details class="small"><summary>${tr('Que veulent dire ces chiffres ?','What do these numbers mean?')}</summary><p>${tr('Ce sont des estimations du rôle reçu au début, selon tes propres suppositions. Ce ne sont pas des certitudes sur le rôle actuel, ni des fréquences de mensonge mesurées. Le carnet ne simule pas toutes les règles du jeu.','These estimate the character received at the start, under your own assumptions. They are not certainty about the current character, nor measured lying frequencies. The notebook does not simulate every rule of the game.')}</p>${r.method==='importance'?`<p>${tr(`Tirage aléatoire : ${r.accepted} répartitions retenues. « Non rencontré » ne veut pas dire impossible.`,`Random draw: ${r.accepted} assignments kept. "Not sampled" does not mean impossible.`)}</p>`:''}${button('coverage',tr('Ce que le carnet ne fait pas','What it does not do'))}</details>`;
}
function explainFactorLabel(impact) {
  if(impact.kind==='factor'){
    const a=prediction?.audit?.find(entry=>entry.id===impact.id||entry.factorId===impact.id);
    if(a?.kind==='claim')return tr(`Déclaration de ${pname(a.playerId)} (${roleLabel(a.roleIds)})`,`${pname(a.playerId)}'s claim (${roleLabel(a.roleIds)})`);
    if(a?.kind==='night')return tr(`Bilan de la nuit ${a.day}`,`Night ${a.day} summary`);
    if(a?.kind==='event')return tr('Ta pondération d’un événement','Your weighting of an event');
    return tr('Un témoignage pondéré','A weighted testimony');
  }
  const c=scenario()?.constraints?.find(x=>x.id===impact.id);
  if(c)return describeRelation(c,pname,rname,lang);
  if(String(impact.id).startsWith('night-'))return tr('Filtre expérimental des morts nocturnes','Experimental night-death filter');
  return tr('Une de tes idées enregistrées','One of your recorded ideas');
}
function explainBody(data,roleId,playerId) {
  const pct=v=>`${(100*v).toLocaleString(lang,{maximumFractionDigits:1})} %`;
  const signed=v=>`${v>=0?'+':'−'}${(100*Math.abs(v)).toLocaleString(lang,{maximumFractionDigits:1})} pts`;
  const subject=playerId?tr(`${pname(playerId)} a reçu ${rname(roleId)} au départ`,`${pname(playerId)} started as ${rname(roleId)}`):tr(`${rname(roleId)} est en jeu au départ`,`${rname(roleId)} is in play at the start`);
  let html=`<p class="notice">${tr('Chaque ligne montre ce que deviendrait ce pourcentage si tu retirais UNIQUEMENT cet élément. C’est une sensibilité à tes propres hypothèses, pas une preuve.','Each line shows what this percentage becomes if you remove ONLY that element. It is a sensitivity to your own assumptions, not proof.')}</p>
    <p class="spaced"><strong>${esc(subject)}</strong> : ${data.baseline.reliable?pct(data.baseline.probability):tr('résultat non fiable','unreliable result')}</p>`;
  if(data.greedySufficientConflict?.constraintIds?.length){
    html+=`<p class="notice warning">${tr('Aucune répartition ne respecte tout. Retirer ces éléments suffirait à rendre tes hypothèses compatibles (ce n’est pas forcément le plus petit ensemble possible) :','No assignment satisfies everything. Removing these would be enough to make your assumptions compatible (not necessarily the smallest possible set):')}</p>
      <ul class="spaced">${data.greedySufficientConflict.constraintIds.map(id=>`<li>${esc(explainFactorLabel({kind:'constraint',id}))}</li>`).join('')}</ul>`;
  }
  const useful=data.impacts.filter(i=>Math.abs(i.delta)>=0.0005);
  html+=useful.length
    ? `<div class="probability-rows">${useful.slice(0,10).map(i=>`<div class="probability-row"><span>${esc(explainFactorLabel(i))}</span><strong>${i.reliable?`${pct(i.probability)} <small>${signed(-i.delta)}</small>`:tr('non fiable sans lui','unreliable without it')}</strong></div>`).join('')}</div>
       <p class="muted">${tr('Écart affiché = ce que cet élément apporte aujourd’hui à ce pourcentage.','Shown gap = what this element currently contributes to this percentage.')}</p>`
    : `<p class="muted">${tr('Aucun élément enregistré ne change ce pourcentage de façon visible : il vient surtout de la composition supposée.','No recorded element visibly changes this percentage: it comes mostly from the assumed setup.')}</p>`;
  if(data.truncated)html+=`<p class="notice warning">${tr('Analyse interrompue par le budget de calcul : certains éléments n’ont pas été testés.','Analysis stopped by the calculation budget: some elements were not tested.')}</p>`;
  return html;
}
function openExplain(playerId,roleId) {
  if(!estimatesOn()){requestEstimates();return;}
  const title=playerId?tr('Pourquoi ce pourcentage ?','Why this percentage?'):tr('Pourquoi ce rôle ?','Why this character?');
  open(title,`<div id="explain-body"><p class="notice" role="status">${tr('Analyse en cours… cela teste tes hypothèses une par une.','Analysing… this tests your assumptions one by one.')}</p></div>`,d=>{
    let model;
    try{model=buildEvidenceModel(game,catalogue,{claimRoleEnrichment:game?.settings?.claimRoleEnrichment!==false});}catch(e){$('#explain-body',d).innerHTML=`<p class="notice error">${esc(e.message)}</p>`;return;}
    if(!explainer)explainer=createEstimator({workerUrl:new URL('./inference-worker.js',import.meta.url),debounceMs:0});
    const gameId=game.id;
    explainer.request(model.input,{mode:'explain',budget:24,deadlineMs:2000,minimalConflict:true,target:playerId?{scope:'player',playerId,roleId}:{scope:'presence',roleId},maxNodes:60000,timeMs:400,maxWorlds:12000,maxSamples:6000,sampleTimeMs:600,seed:41721})
      .then(data=>{
        const body=$('#explain-body');
        if(!body||game.id!==gameId)return;
        body.innerHTML=explainBody(data,roleId,playerId);
      })
      .catch(e=>{
        if(e instanceof EstimatorSupersededError||e instanceof EstimatorCancelledError)return;
        const body=$('#explain-body');
        if(body)body.innerHTML=`<p class="notice error">${esc(e.message)}</p>`;
      });
  });
}
function playerPrediction(id) {
  const c=latestClaim(id),p=player(id);
  if(p.traveller)return `<p class="muted">${tr('Voyageur : hors de ce modèle.','Traveller: outside this model.')}</p>`;
  const r=prediction?.result,row=r?.probabilities?.[id];
  let html=predictionStatus();
  if(!predictionBusy&&!predictionError&&r?.reliable&&row){
    const selected=c?.roleIds||[];
    const entries=selected.length?selected.map(rid=>[rid,row[rid]||0]):Object.entries(row).sort((a,b)=>b[1]-a[1]).slice(0,6);
    html+=`<div class="probability-rows">${entries.map(([rid,n])=>`<div class="probability-row"><span>${esc(rname(rid))}</span><strong>${probabilityNumber(n,halfWidthFor(id,rid))}</strong>${button('explain',tr('Pourquoi ?','Why?'),'ghost',`data-id="${id}" data-role="${rid}"`)}</div>`).join('')}</div>`;
    if(selected.length)html+=`<div class="probability-row outside"><span>${tr('Un autre rôle que ceux annoncés','A character outside the claim')}</span><strong>${probabilityNumber(Math.max(0,1-entries.reduce((sum,[,v])=>sum+v,0)))}</strong></div>`;
    html+=`<p class="muted">${c?tr(`Dernier groupe déclaré : poids ${c.weight??1}×. Les autres rôles ne sont pas exclus par la déclaration.`,`Latest claimed group: weight ${c.weight??1}×. Other characters are not excluded by the claim.`):tr('Aucun groupe déclaré ; principaux rôles affichés.','No claimed group; showing leading characters.')}</p>`;
  }
  return html;
}
function predictionSummary() {
  let html=predictionStatus();
  const r=prediction?.result;
  if(!predictionBusy&&!predictionError&&r?.reliable){
    html+=`<div class="grid">${['demon','minion'].map(team=>`<div><h3>${team==='demon'?tr('Type de Démon au départ','Starting Demon type'):tr('Sbires présents au départ','Starting Minion presence')}</h3>${modelRoles().filter(r=>r.team===team).sort((a,b)=>(r.presence[b.id]||0)-(r.presence[a.id]||0)).map(role=>`<div class="probability-row"><span>${esc(loc(role.name))}</span><strong>${probabilityNumber(r.presence[role.id]||0,halfWidthFor("",role.id))}</strong>${button('explain',tr('Pourquoi ?','Why?'),'ghost',`data-role="${role.id}"`)}</div>`).join('')}</div>`).join('')}</div><p class="muted">${tr('Plusieurs sbires peuvent coexister : leurs probabilités de présence ne totalisent pas forcément 100 %.','Several Minions can coexist: their presence probabilities need not add to 100%.')}</p>`;
  }
  if(prediction)html+=`<details><summary>${tr('Ce qui influence ces estimations','What affects these estimates')} (${prediction.audit.length})</summary>${claimEnrichmentNotices(prediction.audit,lang).map(n=>`<p class="notice">${esc(n)}</p>`).join('')}${prediction.audit.map(a=>`<p class="muted">${a.kind==='claim'?`${esc(pname(a.playerId))} : ${esc(roleLabel(a.roleIds))} ×${a.multiplier}`:a.kind==='night'?tr(`Nuit ${a.day}, ${a.count} décès attribués au seul Démon. Types écartés sous cette supposition : ${esc(roleLabel(a.roleIds))||'aucun'}.`,`Night ${a.day}, ${a.count} deaths attributed solely to the Demon. Excluded under this assumption: ${esc(roleLabel(a.roleIds))||'none'}.`):`${tr('Pondération manuelle d’un événement','Manual event weight')} : ${esc(roleLabel(a.roleIds))} ×${a.multiplier}`}</p>`).join('')||`<p>${tr('Aucun témoignage pondéré. Répartition uniforme des mondes de base.','No weighted testimony. Uniform prior over base worlds.')}</p>`}${prediction.skipped.length?`<p class="notice warning">${tr('Certaines observations ne sont pas exploitées (rôle non couvert ou plusieurs Démons). Elles ne sont pas des preuves d’exclusion.','Some observations are not used (unsupported role or multiple Demons). They do not prove exclusions.')}</p>`:''}<p>${tr('Une seule déclaration, la plus récente par joueur, est pondérée. Les événements sont multipliés comme des indices indépendants : laisse neutres les doublons ou informations corrélées. Les votes seuls n’ont aucune influence morale.','Only each player’s chronologically latest claim is weighted. Events multiply as independent clues: keep duplicates or correlated information neutral. Votes alone imply no alignment.')}</p></details>`;
  return html;
}
function requestEstimates() {
  if(!unlocked())return;
  if(game.rosterReviewRequired){openScenarioSettings();return;}
  if(estimatesOn()){prediction=null;predictionError='';schedulePrediction();return;}
  const enable=()=>change(g=>{g.estimateConsent=true;g.settings.showEstimates=true;},tr('Calcul activé. Il reste désactivé par défaut dans les nouvelles parties.','Calculation enabled. It stays off by default in new games.'));
  if(game.estimateConsent){enable();return;}
  confirmAction(tr('Activer le calcul d’hypothèses ?','Enable the hypothesis calculation?'),
    tr('Ce calcul est désactivé par défaut, volontairement : beaucoup de tables acceptent la prise de notes mais pas l’assistance au calcul. Il suppose des rôles de départ distincts et les effectifs de ton hypothèse. Les pondérations sont les tiennes, les capacités ne sont pas simulées, et un pourcentage ne garantit rien. Parles-en à ta table.',
       'This calculation is off by default, on purpose: many tables accept note-taking but not calculation assistance. It assumes distinct starting characters and your hypothesis counts. Weights are yours, abilities are not simulated, and a percentage guarantees nothing. Mention it to your table.'),
    enable);
}
function disableEstimates() {
  change(g=>g.settings.showEstimates=false,tr('Calcul masqué. Tes notes sont intactes.','Calculation hidden. Your notes are untouched.'));
}
function eventDetails(e) {
  let html='';
  if(e.type==='execution')html+=`<p><strong>${tr('Issue','Outcome')} :</strong> ${e.outcome==='died'?tr('décès constaté','observed death'):e.outcome==='survived'?tr('a survécu','survived'):tr('inconnue','unknown')}</p>`;
  if(e.ballot?.length){
    const b=ballotSummary(e.ballot);
    html+=`<details><summary>${tr('Votes individuels','Individual votes')} : ${b.yes} ${tr('oui','yes')}, ${b.no} ${tr('non','no')}, ${b.unknown} ?</summary>${e.ballot.map(v=>`<div class="probability-row"><span>${esc(pname(v.playerId))}</span><span>${v.choice==='yes'?`${tr('Oui','Yes')} (${v.weight})`:v.choice==='no'?tr('Non','No'):tr('Non noté','Not recorded')}</span></div>`).join('')}<p>${tr('Total pondéré noté','Recorded weighted total')} : ${b.knownWeight}. ${tr('Les pondérations spéciales et le total annoncé priment sur ce relevé partiel.','Special weights and announced totals take precedence over this partial record.')}</p></details>`;
  }
  if(e.type==='night')html+=`<p class="muted">${e.complete?tr('Bilan annoncé complet','Reported complete summary'):tr('Bilan partiel, autres décès possibles','Partial summary, other deaths possible')}</p>`;
  if(['night','execution','vote'].includes(e.type))html+=button('edit-round',tr('Corriger ce relevé','Edit record'),'',`data-id="${e.id}"`);
  if(unlocked())html+=button('event-influence',tr('Influence sur les estimations','Effect on estimates'),'',`data-id="${e.id}"`);
  return html;
}
function openNew(imported=null) {
  const scripts=catalogue.scripts;
  open(tr('Une nouvelle histoire','A new story'),`
    ${game?`<p class="notice">${tr('Ton carnet actuel sera remplacé. S’il est enregistré, une copie de secours sera conservée sur cet appareil ; exporte-le pour le garder durablement.','Your current notebook will be replaced. If saved, a backup is kept on this device; export it for a durable archive.')}</p>`:''}
    <form id="new-form"><label>${tr('Nom de la partie','Game title')}<input name="title" maxlength="120" value="${tr('Ma partie','My game')}" required></label>
    <label>Script<select name="script">${imported?`<option value="import">${esc(imported.name)}</option>`:scripts.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
    <label>${tr('Joueurs, un prénom par ligne, dans l’ordre des sièges','Players, one name per line, in seating order')}<textarea name="names" rows="7" placeholder="Alice&#10;Bruno&#10;Chloé&#10;David&#10;Emma" required></textarea></label>
    <p class="muted">${tr('5 à 20 joueurs. Au-delà de 15, les sièges supplémentaires sont des Voyageurs. Le premier siège te représente ; modifiable dans sa fiche.','5 to 20 players. Beyond 15, extra seats are Travellers. The first seat represents you; change it in the player card.')}</p>
    <div class="dialog-footer">${button('script-import',tr('Autre script JSON','Other JSON script'))}<button type="submit" class="primary">${tr('Créer le carnet','Create notebook')}</button></div></form>`,d=>{
    $('#new-form',d).onsubmit=e=>{e.preventDefault();try{
      const form=new FormData(e.target);const names=String(form.get('names')).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      const s=imported || {...scripts.find(s=>s.id===form.get('script')),customRoles:[],warnings:[]};
      replaceGame(newGame({name:s.name,roleIds:s.roleIds,customRoles:s.customRoles||[],warnings:s.warnings||[]},names,String(form.get('title')).trim()));
      if(!localStorage.getItem('botc-player-onboarded')){localStorage.setItem('botc-player-onboarded','1');openOnboarding();}
    }catch(err){error(err.message);}};
  });
}
function openRoster() {
  let draft=game.players.map(({id,name,traveller})=>({id,name,traveller}));
  const available=new Map([...game.players,...(game.archivedPlayers||[])].map(p=>[p.id,{id:p.id,name:p.name,traveller:p.traveller}]));
  open(tr('Modifier les joueurs en cours de partie','Edit players during a game'),`<p class="notice">${tr('Renommer ou déplacer garde les notes reliées à la bonne personne. Retirer un siège l’archive, sans effacer ses déclarations ni ses votes. Ce n’est pas une façon de noter une mort ou un départ réel : utilise les événements pour cela.','Renaming or moving preserves each person’s notes. Removing a seat archives it without deleting claims or votes. This is not how to record a death or actual departure: use events for those.')}</p>
    <form id="roster-form"><div id="roster-rows"></div><div class="row"><button type="button" id="roster-add">${tr('＋ Ajouter un joueur','＋ Add player')}</button><span id="roster-count" class="muted"></span></div><details class="spaced"><summary>${tr('Sièges retirés : restaurer sans perdre l’historique','Removed seats: restore with history')}</summary><div id="roster-archived"></div></details><div id="roster-impact" class="notice warning"></div>
    <label class="check"><input id="roster-confirm" type="checkbox" required>${tr('Je confirme ces corrections de liste et les conséquences affichées.','I confirm these roster corrections and their stated effects.')}</label><div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer les joueurs','Save players')}</button></div></form>`,d=>{
      const sync=()=>{for(const row of $$('[data-roster-row]',d)){const p=draft.find(p=>p.id===row.dataset.rosterRow);p.name=$('[data-roster-name]',row).value;p.traveller=$('[data-roster-traveller]',row).checked;available.set(p.id,{...p});}};
      const impact=()=>{
        const m=rosterImpact(game,draft);
        $('#roster-count',d).textContent=tr(`${draft.length} sièges, ${draft.filter(p=>!p.traveller).length} non-Voyageurs`,`${draft.length} seats, ${draft.filter(p=>!p.traveller).length} non-Travellers`);
        $('#roster-impact',d).textContent=m.membershipChanged?tr(`${m.added.length} ajout(s), ${m.removed.length} archive(s), ${m.changedType.length} changement(s) de type. Les effectifs de base seront recalculés et ${m.affected} règle(s) manuelle(s) désactivée(s). Les calculs sont suspendus jusqu’à révision de la composition initiale.`,`${m.added.length} additions, ${m.removed.length} archives, ${m.changedType.length} type changes. Base counts will reset and ${m.affected} manual rules will be disabled. Calculation is suspended until starting composition is reviewed.`):tr('Les identifiants, l’historique, les effectifs supposés et les liens sont conservés.','Identifiers, history, assumed counts and links are preserved.');
      };
      const draw=()=>{
        $('#roster-rows',d).innerHTML=draft.map((p,i)=>`<div class="roster-row" data-roster-row="${p.id}"><span class="avatar">${i+1}</span><label class="roster-name"><span class="sr-only">${tr('Prénom du siège','Seat name')} ${i+1}</span><input data-roster-name maxlength="60" value="${esc(p.name)}" required></label><div class="roster-controls"><label class="check"><input type="checkbox" data-roster-traveller ${p.traveller?'checked':''}>${tr('Voyageur','Traveller')}</label><button type="button" data-move="-1" data-roster-id="${p.id}" ${i===0?'disabled':''} aria-label="${esc(tr('Monter ','Move up ')+p.name)}">↑</button><button type="button" data-move="1" data-roster-id="${p.id}" ${i===draft.length-1?'disabled':''} aria-label="${esc(tr('Descendre ','Move down ')+p.name)}">↓</button><button type="button" data-remove-seat="${p.id}">${tr('Retirer','Remove')}</button></div></div>`).join('');
        const ids=new Set(draft.map(p=>p.id));
        $('#roster-archived',d).innerHTML=[...available.values()].filter(p=>!ids.has(p.id)).map(p=>`<div class="row spread issue"><span>${esc(p.name)}</span><button type="button" data-restore-seat="${p.id}">${tr('Restaurer','Restore')}</button></div>`).join('')||`<p class="muted">${tr('Aucun siège archivé.','No archived seat.')}</p>`;
        $('#roster-add',d).disabled=draft.length>=20;impact();
      };
      $('#roster-rows',d).oninput=()=>{sync();impact();$('#roster-confirm',d).checked=false;};
      $('#roster-form',d).addEventListener('click',e=>{
        const b=e.target.closest('[data-move],[data-remove-seat],[data-restore-seat]');if(!b)return;
        sync();
        if(b.dataset.move){const i=draft.findIndex(p=>p.id===b.dataset.rosterId),j=i+Number(b.dataset.move);if(j>=0&&j<draft.length)[draft[i],draft[j]]=[draft[j],draft[i]];}
        if(b.dataset.removeSeat)draft=draft.filter(p=>p.id!==b.dataset.removeSeat);
        if(b.dataset.restoreSeat){if(draft.length>=20){error(tr('20 sièges maximum.','Maximum 20 seats.'));return;}draft.push({...available.get(b.dataset.restoreSeat)});}
        $('#roster-confirm',d).checked=false;draw();
      });
      $('#roster-add',d).onclick=()=>{sync();const p={id:uid(),name:tr('Nouveau joueur','New player'),traveller:draft.filter(p=>!p.traveller).length>=15};draft.push(p);available.set(p.id,p);$('#roster-confirm',d).checked=false;draw();$$('[data-roster-name]',d).at(-1).focus();$$('[data-roster-name]',d).at(-1).select();};
      $('#roster-form',d).onsubmit=e=>{e.preventDefault();try{sync();change(g=>{const changed=applyRoster(g,draft);Object.assign(g,changed);event(g,'note',tr('Liste des joueurs corrigée. Les sièges retirés et leur historique sont archivés.','Player list corrected. Removed seats and their history are archived.'));},tr('Liste enregistrée, historique conservé','Roster saved, history preserved'));close();}catch(err){error(err.message);}};
      draw();
    });
}
function roundSummary() {
  const alive=game.players.filter(p=>p.alive);
  const ghosts=game.players.filter(p=>!p.alive&&p.ghost);
  const threshold=Math.ceil(alive.length/2);
  return `<div class="stats"><div class="stat"><strong>${alive.length}</strong>${tr('en vie','alive')}</div><div class="stat"><strong>${ghosts.length}</strong>${tr('votes fantômes restants','ghost votes left')}</div><div class="stat"><strong>${threshold}</strong>${tr('voix, seuil usuel','usual threshold')}</div></div>
    <p class="muted small">${tr('Seuil indicatif : la moitié de tous les joueurs vivants, Voyageurs compris, arrondie au supérieur. Les capacités spéciales et les annonces du Conteur peuvent le changer.','Indicative threshold: half of all living players, Travellers included, rounded up. Special abilities and Storyteller announcements can change it.')}</p>`;
}
function openEndgame() {
  const ordinary=normalPlayers();
  const alive=ordinary.filter(p=>p.alive);
  const noClaim=game.players.filter(p=>!latestClaim(p.id));
  const kept=game.retained.filter(r=>!r.shared);
  open(tr('Derniers instants','Final moments'),`<p class="notice">${tr('Une liste de vérification, pas un conseil de jeu. Le carnet ne te dit pas qui exécuter.','A checklist, not game advice. The notebook does not tell you whom to execute.')}</p>
    ${roundSummary()}
    <h3>${tr('Avant la dernière exécution','Before the last execution')}</h3>
    <ul>
      <li>${alive.length?tr('Encore en vie : ','Still alive: ')+esc(alive.map(p=>p.name).join(', ')):tr('Aucun non-Voyageur en vie dans tes notes.','No living non-Traveller in your notes.')}</li>
      <li>${noClaim.length?tr('Personne n’a noté de rôle pour : ','No character recorded for: ')+esc(noClaim.map(p=>p.name).join(', ')):tr('Chaque joueur a au moins une déclaration notée.','Every player has at least one recorded claim.')}</li>
      <li>${kept.length?tr('Tu gardes encore ','You are still holding ')+kept.length+tr(' information(s) non partagée(s).',' unshared piece(s) of information.'):tr('Tu n’as pas d’information gardée pour toi.','You have no information held back.')}</li>
      <li>${tr('Les morts votent encore une fois. Vérifie qui a encore son vote fantôme.','Dead players still vote once. Check who still has a ghost vote.')}</li>
      <li>${tr('Des conditions spéciales peuvent changer l’issue : Saint, Maire, Cerveau, Vortox… Consulte le script.','Special conditions can change the outcome: Saint, Mayor, Mastermind, Vortox… Check the script.')}</li>
    </ul>
    <div class="row">${button('view',tr('Ouvrir le tableau','Open the board'),'primary',`data-view="overview"`)}</div>`);
}
function neighbourLabel(id) {
  const n=seatNeighbours(game.players)[id];
  const left=n?.left?.name||'',right=n?.right?.name||'';
  return left||right?`${esc(left||'?')} ← → ${esc(right||'?')}`:tr('inconnus','unknown');
}
function openExpress(id='') {
  open(tr('Saisie rapide','Quick entry'),`<p class="notice">${tr('Tout est facultatif. Enregistre même si tu n’as qu’un morceau : tu compléteras plus tard.','Everything is optional. Save even a fragment: you can complete it later.')}</p>
    <form id="express-form">
    <label>${tr('Qui te parle ?','Who is talking to you?')}<select name="source">${playerOptions(id||'',true)}</select></label>
    <details ${id?'open':''}><summary>${tr('Il annonce un ou plusieurs rôles','They claim one or more characters')}</summary><div id="express-roles"></div></details>
    <label>${tr('Ce qu’il dit','What they say')}<textarea name="text" maxlength="2000" rows="3" placeholder="${tr('Empathe 1 · a vu X ou Y · dit avoir été empoisonné…','Empath 1 · saw X or Y · says they were poisoned…')}"></textarea></label>
    <details><summary>${tr('Ça concerne d’autres joueurs','It involves other players')}</summary><div id="express-players"></div></details>
    <div class="form-grid"><label>${tr('Jour / nuit n°','Day / night number')}<input type="number" name="day" min="1" max="99" value="${game.day}" required></label><label>${tr('Moment','Phase')}<select name="phase"><option value="day" ${game.phase==='day'?'selected':''}>${tr('Jour','Day')}</option><option value="night" ${game.phase==='night'?'selected':''}>${tr('Nuit','Night')}</option></select></label></div>
    <label class="check"><input type="checkbox" name="ask">${tr('À redemander plus tard','Ask about this later')}</label>
    <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer','Save')}</button></div></form>`,d=>{
      const roles=rolePicker($('#express-roles',d),[],modelRoles(),true);
      const about=playerPicker($('#express-players',d),[],game.players);
      $('[name=text]',d).focus();
      $('#express-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),source=String(f.get('source')||''),chosen=roles(),subjects=about(),body=String(f.get('text')).trim();
        const day=Number(f.get('day')),phase=f.get('phase');
        if(!source&&!chosen.length&&!subjects.length&&!body)throw new Error(tr('Ajoute au moins une information.','Add at least one piece of information.'));
        change(g=>{
          if(chosen.length&&source){
            const c={id:uid(),playerId:source,roleIds:chosen,sourceId:source,visibility:'private',note:body.slice(0,2000),day,phase,weight:1};
            g.claims.push(c);
            event(g,'claim',tr('Rôles annoncés : ','Claimed characters: ')+roleLabel(chosen)+(body?'\n'+body:''),[source],source);
            const ev=g.events.at(-1);ev.day=day;ev.phase=phase;ev.value=c.id;
          }
          if(body||subjects.length){
            event(g,'info',body||tr('Information rapportée','Reported information'),subjects,source);
            const ev=g.events.at(-1);ev.day=day;ev.phase=phase;
          }
          if(f.has('ask')){
            event(g,'note',tr('À redemander : ','Ask later: ')+(body||roleLabel(chosen)||tr('point à clarifier','point to clarify')),subjects,source);
            const ev=g.events.at(-1);ev.day=day;ev.phase=phase;
          }
        },tr('Noté','Saved'));close();
      }catch(err){error(err.message);}};
    });
}
function menuItem(action,icon,titleFr,titleEn,helpFr,helpEn,attrs='') {
  return `<button type="button" class="menu-item" data-action="${action}" ${attrs}><span class="menu-icon" aria-hidden="true">${icon}</span><span class="menu-text"><strong>${tr(titleFr,titleEn)}</strong><small>${tr(helpFr,helpEn)}</small></span></button>`;
}
function openTableMenu() {
  open(tr('Outils','Tools'),`<div class="menu-grid">
    ${menuItem('roster','👥','Corriger la liste des joueurs','Fix the player list','Renommer, changer l’ordre des sièges, retirer ou remettre quelqu’un.','Rename, reorder seats, remove or restore someone.')}
    ${menuItem('mynotes','🕮','Ce que moi j’ai annoncé','What I claimed myself','Garder trace de mes propres versions, à qui je les ai dites, et des infos à retenir pour plus tard.','Track my own versions, who I told, and information to remember for later.')}
    ${menuItem('table-card','☉','Rassurer la table','Reassure the table','Un texte à montrer si quelqu’un s’inquiète de ce que tu fais sur ton téléphone.','A text to show if someone worries about what you are doing on your phone.')}
    ${menuItem('print-sheet','🖶','Imprimer une feuille','Print a sheet','Une version papier vierge, adaptée au nombre de joueurs, si tu préfères ranger le téléphone.','A blank paper version sized to your table, if you would rather put the phone away.')}
    ${menuItem('endgame','⌛','Récapitulatif de fin','Endgame recap','À la dernière journée : qui est vivant, combien de votes restent, ce qui peut changer l’issue.','On the last day: who is alive, how many votes remain, what can change the outcome.')}
    ${menuItem('coverage','⚠','Ce que le carnet ne fait pas','What the notebook does not do','Ses limites honnêtes : il ne simule pas le jeu et ne tranche aucune règle.','Its honest limits: it does not simulate the game and settles no rule.')}
  </div>`);
}
function openTableCard() {
  open(tr('À montrer à ta table','Show this to your table'),`<div class="table-card">
    <p class="eyebrow">${tr('Carnet du Joueur','Player Notebook')}</p>
    <h3 style="margin-top:0">${tr('Ce que j’utilise, en cinq lignes','What I am using, in five lines')}</h3>
    <ul>
      <li>${tr('C’est un carnet de notes privé, comme du papier.','It is a private notebook, like paper.')}</li>
      <li>${tr('Il ne lit rien du Conteur et ne voit aucun grimoire.','It reads nothing from the Storyteller and sees no grimoire.')}</li>
      <li>${tr('Aucune IA, aucun serveur, rien n’est envoyé nulle part.','No AI, no server, nothing is sent anywhere.')}</li>
      <li>${tr('Il ne tranche aucune règle et ne désigne personne.','It settles no rule and points at nobody.')}</li>
      ${unlocked()&&estimatesOn()?`<li>${tr('J’ai activé une aide au raisonnement ; je peux la couper si vous préférez.','I turned on a reasoning aid; I can switch it off if you prefer.')}</li>`:''}
    </ul>
    <p>${tr('Et si la table ou le Conteur préfère sans téléphone, je range.','And if the table or the Storyteller prefers no phone, I put it away.')}</p>
    </div>
    ${unlocked()&&estimatesOn()?`<div class="row">${button('toggle-estimates',tr('Couper l’aide','Switch the aid off'))}</div>`:''}`);
}
function openOnboarding() {
  open(tr('Soixante secondes avant le jour 1','Sixty seconds before day one'),`
    <ol class="onboarding">
      <li><strong>${tr('Préviens ta table.','Tell your table.')}</strong><br>${tr('Une phrase suffit : « je prends des notes sur mon téléphone, comme sur papier ».','One sentence is enough: "I take notes on my phone, like on paper."')} ${button('table-card',tr('Carte à montrer','Card to show'))}</li>
      <li><strong>${tr('Entre les joueurs dans l’ordre des sièges.','Enter the players in seating order.')}</strong><br>${tr('Le premier siège, c’est toi. Tu pourras tout corriger en cours de partie.','The first seat is you. You can correct everything mid-game.')}</li>
      <li><strong>${tr('Ton premier geste en partie.','Your first move in play.')}</strong><br>${tr('« Me parle » sur la carte d’un joueur, puis tu notes ce qu’il dit. Enregistre même si c’est incomplet.','"Talked to me" on a player card, then note what they say. Save even if incomplete.')}</li>
      <li><strong>${tr('Reste dans la conversation.','Stay in the conversation.')}</strong><br>${tr('Le carnet sert à se souvenir, pas à réfléchir à ta place. Note vite, relève la tête, écoute.','The notebook is for remembering, not for thinking in your place. Note fast, look up, listen.')}</li>
    </ol>
    <div class="dialog-footer">${button('close',tr('Je suis à table, aller vite','I am at the table, go fast'),'primary')}</div>`);
}
function openPrintSheet() {
  open(tr('Feuille papier','Paper sheet'),`<p class="notice">${tr('Une feuille vierge adaptée au nombre réel de joueurs, à imprimer pour les tables qui préfèrent le papier. Tes notes ne sont pas incluses par défaut.','A blank sheet matching your real player count, to print for tables that prefer paper. Your notes are not included by default.')}</p>
    <label class="check"><input type="checkbox" id="print-include">${tr('Inclure ce que j’ai déjà noté','Include what I already recorded')}</label>
    <div class="dialog-footer"><button id="print-open" class="primary">${tr('Ouvrir la feuille','Open the sheet')}</button></div>`,d=>{
    $('#print-open',d).onclick=()=>{try{
      const html=printableSheet(game,{catalogue,lang,includeRecorded:$('#print-include',d).checked});
      const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));
      const opened=window.open(url,'_blank','noopener');
      if(!opened){
        const a=document.createElement('a');a.href=url;a.download=`carnet-feuille-${game.players.length}.html`;a.click();
        toast(tr('Feuille téléchargée : ouvre-la pour imprimer.','Sheet downloaded: open it to print.'),6000);
      }
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      close();
    }catch(err){error(err.message);}};
  });
}
function openMyNotes() {
  const me=game.myId?player(game.myId):null;
  const known=whoKnows(game.selfLog);
  const series=retainedSeries(game.retained,{roleName:rname,lang});
  const audienceLabel=a=>a===PUBLIC_AUDIENCE?tr('à toute la table','to the whole table'):(a.length?a.map(pname).join(', '):tr('sans destinataire noté','no audience recorded'));
  open(tr('Mon jeu','My own game'),`<p class="notice">${tr('Ce que TU as dit, et ce que tu dois retenir. Strictement privé. Le carnet ne juge jamais tes propres paroles : il te les rappelle.','What YOU said, and what you must remember. Strictly private. The notebook never judges your own words: it reminds you of them.')}</p>
    ${me?`<p class="muted">${tr('Je suis','I am')} ${esc(me.name)}${game.myRole?` · ${tr('rôle reçu','character received')} : ${esc(rname(game.myRole))}`:''}</p>`:`<p class="notice warning">${tr('Aucun siège n’est marqué comme toi. Ouvre ta fiche et coche « C’est moi ».','No seat is marked as you. Open your card and tick "This is me".')}</p>`}
    <h3>${tr('Ce que j’ai dit','What I said')}</h3>
    <div class="row">${button('self-add',tr('＋ J’ai dit quelque chose','＋ I said something'),'primary')}</div>
    ${game.selfLog.length?game.selfLog.slice().reverse().map(entry=>`<div class="issue"><small>${esc(phaseName(entry))} · ${entry.status==='public'?tr('public','public'):entry.status==='told'?tr('confié','told'):tr('gardé pour moi','kept')}</small><p><strong>${esc(audienceLabel(entry.audience))}</strong></p>${entry.roleIds.length?`<p>${tr('Rôle annoncé','Claimed character')} : ${esc(roleLabel(entry.roleIds))}</p>`:''}<p class="muted">${esc(entry.text)}</p>${button('self-delete',tr('Retirer','Remove'),'',`data-id="${entry.id}"`)}</div>`).join(''):`<p class="empty">${tr('Rien de noté. Dès que tu annonces un rôle ou donnes une info, note-le ici pour rester cohérent.','Nothing recorded. As soon as you claim a character or give information, note it here to stay consistent.')}</p>`}
    ${Object.keys(known).length?`<details><summary>${tr('Qui sait quoi','Who knows what')}</summary>${Object.entries(known).map(([pid,items])=>`<p><strong>${esc(pname(pid))}</strong> : ${esc(items.map(i=>[roleLabel(i.roleIds||[]),i.text].filter(Boolean).join(' — ')).join(' · '))}</p>`).join('')}</details>`:''}
    <h3>${tr('À retenir nuit après nuit','To remember night after night')}</h3>
    <p class="muted">${tr('Pour les rôles dont l’information arrive plus tard : Crieur public, Fleuriste, Érudit, Commère, Jongleur, Amnésique…','For characters whose information arrives later: Town Crier, Flowergirl, Savant, Gossip, Juggler, Amnesiac…')}</p>
    <div class="row">${button('retain-add',tr('＋ Noter une info à retenir','＋ Record something to remember'),'primary')}</div>
    ${series.length?series.map(s=>`<div class="issue"><strong>${esc(s.roleName||s.label||'')}</strong><p>${esc(s.series||s.text||'')}</p></div>`).join(''):''}
    ${game.retained.length?game.retained.slice().reverse().map(r=>`<div class="issue"><small>${tr('Nuit','Night')} ${r.night}${r.roleId?' · '+esc(rname(r.roleId)):''}${r.shared?' · '+tr('partagée','shared'):''}</small><p>${esc([r.value,r.text].filter(Boolean).join(' — '))}</p>${button('retain-delete',tr('Retirer','Remove'),'',`data-id="${r.id}"`)}</div>`).join(''):`<p class="empty">${tr('Rien à retenir pour l’instant.','Nothing to remember yet.')}</p>`}`);
}
function openSelfEntry() {
  open(tr('J’ai dit quelque chose','I said something'),`<form id="self-form">
    <label>${tr('À qui ?','To whom?')}<select name="scope"><option value="players">${tr('À une ou plusieurs personnes','To one or more people')}</option><option value="public">${tr('À toute la table','To the whole table')}</option></select></label>
    <div id="self-audience"></div>
    <details><summary>${tr('J’ai annoncé un rôle','I claimed a character')}</summary><div id="self-roles"></div></details>
    <label>${tr('Ce que j’ai dit','What I said')}<textarea name="text" maxlength="2000" rows="3" placeholder="${tr('Empathe, 1 voisin maléfique · j’ai dit avoir vu X…','Empath, 1 evil neighbour · I said I saw X…')}"></textarea></label>
    ${timeFields()}
    <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer','Save')}</button></div></form>`,d=>{
      const audience=playerPicker($('#self-audience',d),[],game.players.filter(p=>p.id!==game.myId));
      const roles=rolePicker($('#self-roles',d),[],modelRoles(),true);
      $('#self-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),isPublic=f.get('scope')==='public',people=audience(),chosen=roles(),body=String(f.get('text')).trim();
        if(!body&&!chosen.length)throw new Error(tr('Indique au moins ce que tu as dit ou le rôle annoncé.','State at least what you said or the character claimed.'));
        if(!isPublic&&!people.length)throw new Error(tr('Choisis au moins une personne, ou passe en public.','Choose at least one person, or switch to public.'));
        change(g=>g.selfLog.push({id:uid(),day:Number(f.get('day')),phase:f.get('phase'),audience:isPublic?PUBLIC_AUDIENCE:people,roleIds:chosen,text:body,status:isPublic?'public':'told'}),tr('Noté dans mon jeu','Saved in my own game'));
        close();openMyNotes();
      }catch(err){error(err.message);}};
    });
}
function openRetainEntry() {
  open(tr('Info à retenir','Information to remember'),`<form id="retain-form">
    <div class="form-grid"><label>${tr('Nuit n°','Night number')}<input type="number" name="night" min="1" max="99" value="${game.day}" required></label><label>${tr('De quel rôle','From which character')}<select name="roleId">${roleOptions(game.myRole)}</select></label></div>
    <label>${tr('La valeur reçue','The value received')}<input name="value" maxlength="80" placeholder="${tr('0 · 1 · oui · non · Empathe…','0 · 1 · yes · no · Empath…')}"></label>
    <label>${tr('Détail','Detail')}<textarea name="text" maxlength="2000" rows="2"></textarea></label>
    <label class="check"><input type="checkbox" name="shared">${tr('Je l’ai déjà partagée','I have already shared it')}</label>
    <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer','Save')}</button></div></form>`,d=>{
      $('#retain-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),value=String(f.get('value')).trim(),body=String(f.get('text')).trim();
        if(!value&&!body)throw new Error(tr('Note au moins la valeur reçue.','Record at least the value received.'));
        change(g=>g.retained.push({id:uid(),night:Number(f.get('night')),roleId:f.get('roleId')||'',value,text:body,shared:f.has('shared')}),tr('Info conservée','Information kept'));
        close();openMyNotes();
      }catch(err){error(err.message);}};
    });
}
function openPlayer(id) {
  const p=player(id), claims=game.claims.filter(c=>c.playerId===id).slice().reverse();
  if(!game.players.some(p=>p.id===id)){
    open(tr('Siège archivé : ','Archived seat: ')+p.name,`<p class="notice">${tr('Ses informations sont conservées, mais ce siège n’appartient plus à la liste active. Cela ne signifie pas que ce joueur est mort.','Information is preserved, but this seat is not in the active roster. This does not mean the player is dead.')}</p>${claims.map(c=>`<p>${esc(phaseName(c))} : ${esc(roleLabel(c.roleIds))}</p>`).join('')}${button('roster',tr('Restaurer depuis la liste','Restore from roster'))}`);
    return;
  }
  open(p.name,`<div class="row spaced">${button('claim',tr('Déclaration','Claim'),'primary',`data-id="${id}"`)}${button('observe',tr('Indice','Clue'),'',`data-id="${id}"`)}${button('domain',tr('Rôles supposés','Assumed characters'),'',`data-id="${id}"`)}</div>
    <form id="player-form"><div class="form-grid"><label>${tr('Prénom','Name')}<input name="name" maxlength="60" value="${esc(p.name)}" required></label><label>${tr('Mon appréciation','My judgement')}<select name="trust">${Object.entries(trustNames).map(([key,names])=>`<option value="${key}" ${p.trust===key?'selected':''}>${tr(...names)}</option>`).join('')}</select></label></div>
    <div class="row"><label class="check"><input type="checkbox" name="me" ${game.myId===id?'checked':''}>${tr('C’est moi','This is me')}</label><label class="check"><input type="checkbox" name="traveller" ${p.traveller?'checked':''}>${tr('Voyageur','Traveller')}</label></div>
    ${game.myId===id?`<label>${tr('Rôle qui m’a été montré au début','Character I was shown at the start')}<select name="myRole">${roleOptions(game.myRole)}</select></label>`:''}
    <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer','Save')}</button></div></form>
    ${unlocked()?`<details class="spaced"><summary>${tr('Estimations des rôles déclarés','Estimates for claimed characters')}</summary><div data-player-estimate="${id}">${playerPrediction(id)}</div></details>`:''}
    <p class="muted small">${tr('Voisins de siège actuels','Current seat neighbours')} : ${esc(neighbourLabel(id))}</p>
    <h3>${tr('État noté','Recorded state')}</h3><div class="row">${button('life',p.alive?tr('Noter sa mort','Record death'):tr('Noter son retour en vie','Record revival'),'',`data-id="${id}"`)}${!p.alive?button('ghost',p.ghost?tr('Vote fantôme utilisé','Ghost vote used'):tr('Rendre le vote fantôme','Restore ghost vote'),'',`data-id="${id}"`):''}${button('execution',tr('Noter une exécution','Record execution'),'',`data-id="${id}"`)}</div>
    <p class="notice">${tr('Exécution ≠ mort. Les deux événements sont notés séparément.','Execution ≠ death. Record the two events separately.')}</p>
    <h3>${tr('Historique des déclarations','Claim history')}</h3>${claims.map(c=>`<div class="issue"><small>${esc(phaseName(c))} · ${c.visibility==='private'?tr('Privé','Private'):tr('Public','Public')} · ${c.weight??1}×</small><p>${esc(roleLabel(c.roleIds))}</p><p class="muted">${esc(c.note)}</p><div class="row">${button('edit-claim',tr('Corriger / pondérer','Edit / weight'),'',`data-id="${c.id}"`)}${button('assume-claim',tr('Imposer au modèle','Restrict model'),'',`data-id="${c.id}"`)}${button('delete-claim',tr('Supprimer','Delete'),'',`data-id="${c.id}"`)}</div></div>`).join('')||`<p class="muted">${tr('Aucune déclaration.','No claims.')}</p>`}`,d=>{
      $('#player-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),traveller=f.has('traveller'),wasTraveller=p.traveller;
        const apply=()=>{change(g=>{const q=g.players.find(x=>x.id===id);q.name=String(f.get('name')).trim();q.trust=f.get('trust');
          if(f.has('me')){if(g.myId!==id)g.myRole='';g.myId=id;}else if(g.myId===id){g.myId='';g.myRole='';}
          if(f.has('myRole')&&g.myId===id)g.myRole=f.get('myRole');
          if(wasTraveller!==traveller)Object.assign(g,applyRoster(g,g.players.map(x=>({id:x.id,name:x.id===id?String(f.get('name')).trim():x.name,traveller:x.id===id?traveller:x.traveller}))));
        },tr('Fiche enregistrée','Player saved'));close();};
        if(wasTraveller===traveller){apply();return;}
        const impact=rosterImpact(game,game.players.map(x=>({id:x.id,name:x.name,traveller:x.id===id?traveller:x.traveller})));
        confirmAction(traveller?tr('Marquer ce joueur comme Voyageur ?','Mark this player as a Traveller?'):tr('Retirer le statut Voyageur ?','Remove Traveller status?'),
          tr(`Les Voyageurs sont hors du modèle initial. Les effectifs de base seront recalculés et ${impact.affected} idée(s) touchée(s) seront désactivée(s). Le calcul restera suspendu jusqu’à ce que tu revoies la composition. L’historique est conservé.`,
             `Travellers are outside the initial model. Base counts will be recalculated and ${impact.affected} affected idea(s) disabled. Calculation stays paused until you review the setup. History is preserved.`),
          apply);
      }catch(err){error(err.message);}};
    });
}
function openClaim(id,existing=null) {
  open(tr('1 rôle, 3 pour 3, ou plusieurs','1 character, 3-for-3, or several'),`<p class="notice">${tr('Coche tous les rôles que cette personne dit pouvoir incarner. La déclaration ne devient pas une certitude : un rôle extérieur au groupe reste toujours possible.','Check every character this person says they might be. A claim is not certainty: a character outside the group always remains possible.')}</p>
    <form id="claim-form"><label>${tr('Qui revendique ces rôles ?','Who claims these characters?')}<select name="player">${playerOptions(id||game.myId,false)}</select></label><div id="claim-picker"></div>
    ${unlocked()?`<label>${tr('Poids subjectif de ce groupe','Subjective weight of this group')}<select name="weight">${weightOptions(existing?.weight??1)}</select></label><p class="muted">${tr('5× donne à chaque rôle coché cinq fois le poids d’un rôle non coché. Ce n’est pas 80 % de sincérité. Seule la dernière déclaration par joueur est utilisée.','5× gives each checked character five times the weight of an unchecked one. This does not mean 80% honesty. Only the latest claim per player is used.')}</p>`:`<input type="hidden" name="weight" value="${existing?.weight??1}">`}
    <details><summary>${tr('Source, moment et précision','Source, time and details')}</summary><div class="form-grid"><label>${tr('Je l’ai entendu de','I heard it from')}<select name="source">${playerOptions(id)}</select></label><label>${tr('Échange','Conversation')}<select name="visibility"><option value="private">${tr('Privé','Private')}</option><option value="public">${tr('Public','Public')}</option></select></label></div>${timeFields()}<label>${tr('Précision facultative','Optional detail')}<textarea name="note" maxlength="2000" placeholder="${tr('3 pour 3, bluff annoncé, changement de version…','3-for-3, announced bluff, changed story…')}"></textarea></label></details>
    <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer la déclaration','Save claim')}</button></div></form>`,d=>{
      const selection=rolePicker($('#claim-picker',d),existing?.roleIds||[],roles(),true);
      if(existing)for(const [key,value] of Object.entries({source:existing.sourceId,day:existing.day,phase:existing.phase,note:existing.note,visibility:existing.visibility}))$(`[name="${key}"]`,d).value=value;
      $('#claim-form',d).onsubmit=e=>{e.preventDefault();try{
        const selected=selection();if(!selected.length||selected.length>10)throw new Error(tr('Choisis entre 1 et 10 rôles.','Choose 1 to 10 characters.'));
        const f=new FormData(e.target),p=f.get('player'),c={id:existing?.id||uid(),playerId:p,roleIds:selected,sourceId:f.get('source'),visibility:f.get('visibility'),note:String(f.get('note')),day:Number(f.get('day')),phase:f.get('phase'),weight:Number(f.get('weight'))};
        change(g=>{if(existing){g.claims[g.claims.findIndex(c=>c.id===existing.id)]=c;g.events=g.events.filter(e=>!(e.type==='claim'&&e.value===c.id));}else g.claims.push(c);
          event(g,'claim',tr('Rôles déclarés : ','Claimed characters: ')+roleLabel(selected)+(c.note?'\n'+c.note:''),[p],c.sourceId);const ev=g.events.at(-1);ev.day=c.day;ev.phase=c.phase;ev.value=c.id;
        },tr('Déclaration notée.','Claim recorded.'));close();
      }catch(err){error(err.message);}};
    });
}
function timeFields() {return `<div class="form-grid"><label>${tr('Jour / nuit n°','Day / night number')}<input type="number" name="day" min="1" max="99" value="${game.day}" required></label><label>${tr('Moment','Phase')}<select name="phase"><option value="day" ${game.phase==='day'?'selected':''}>${tr('Jour','Day')}</option><option value="night" ${game.phase==='night'?'selected':''}>${tr('Nuit','Night')}</option></select></label></div>`;}
function openRound(target='',existing=null,defaultOutcome='unknown') {
  const ballotPlayers=existing?.ballot?.length?existing.ballot.map(v=>player(v.playerId)):game.players;
  open(tr('Exécution, nomination et votes','Execution, nomination and votes'),`<form id="round-form">
    ${roundSummary()}
    <div class="form-grid"><label>${tr('Jour n°','Day number')}<input name="day" type="number" min="1" max="99" value="${existing?.day||game.day}" required></label><label>${tr('Qui a nommé ?','Who nominated?')}<select name="source">${playerOptions(existing?.sourceId||'')}</select></label></div>
    <label>${tr('Personne nommée / exécutée','Nominated / executed player')}<select name="target">${playerOptions(existing?.playerIds[0]||target)}</select></label>
    <label>${tr('Issue observée','Observed outcome')}<select name="outcome">${[['none','Pas d’exécution, vote seulement','No execution, vote only'],['unknown','Exécution, décès non confirmé','Execution, death unconfirmed'],['survived','Exécuté mais a survécu','Executed but survived'],['died','Exécuté et décès constaté','Executed and observed dead']].map(([value,fr,en])=>`<option value="${value}" ${(existing?(existing.type==='execution'?existing.outcome:'none'):defaultOutcome)===value?'selected':''}>${tr(fr,en)}</option>`).join('')}</select></label>
    <div class="ballot-quick" role="group" aria-label="${tr('Pointage rapide des mains levées','Quick tally of raised hands')}"><p class="muted small">${tr('Un tap par main levée. Le reste est facultatif.','One tap per raised hand. The rest is optional.')}</p><div class="ballot-chips">${ballotPlayers.filter(p=>p.alive||existing?.ballot?.some(v=>v.playerId===p.id)).map(p=>{const v=existing?.ballot?.find(v=>v.playerId===p.id);return `<button type="button" class="ballot-chip" data-quickvote="${p.id}" aria-pressed="${v?.choice==='yes'}">${esc(p.name)}${p.alive?'':' ◇'}</button>`;}).join('')}</div><p id="ballot-summary" class="notice" role="status"></p></div>
    <details><summary>${tr('Détail des votes (facultatif)','Vote detail (optional)')}</summary><p class="muted">${tr('? signifie non noté, pas non. Indique les voix spéciales si elles sont connues.','? means not recorded, not no. Enter special vote weights if known.')}</p>
    <div class="row ballot-bulk">${button('ballot-all',tr('Tous « non »','All "no"'),'','data-choice="no"')}${button('ballot-all',tr('Tous « ? »','All "?"'),'','data-choice="unknown"')}</div>
    <div class="ballot-list">${ballotPlayers.map(p=>{const v=existing?.ballot?.find(v=>v.playerId===p.id);const choice=v?.choice||'unknown';const weight=v?.choice==='yes'?v.weight:1;return `<div class="ballot-row" data-voter="${p.id}" data-choice="${choice}" data-weight="${weight}"><span>${esc(p.name)}</span><div class="ballot-choice" role="group" aria-label="${esc(tr('Vote de ','Vote by ')+p.name)}">${[['yes',tr('Oui','Yes')],['no',tr('Non','No')],['unknown','?']].map(([value,label])=>`<button type="button" data-vote="${value}" aria-pressed="${choice===value}">${label}</button>`).join('')}</div><input data-voteweight type="number" min="-9" max="9" value="${weight}" aria-label="${esc(tr('Voix de ','Vote weight for ')+p.name)}" ${choice==='yes'?'':'hidden'}></div>`;}).join('')}</div></details>
    <label>${tr('Total annoncé par le Conteur (facultatif)','Total announced by Storyteller (optional)')}<input name="value" type="number" min="-999" max="999" value="${esc(existing?.value||'')}"></label>
    <label class="check"><input name="applyState" type="checkbox" ${existing?'':'checked'}>${tr('Si le décès est confirmé, marquer cette personne morte maintenant','If death is confirmed, mark this player dead now')}</label>
    <label class="check"><input name="applyGhost" type="checkbox">${tr('Reporter les votes des morts comme votes fantômes utilisés','Mark votes by currently dead players as used ghost votes')}</label>
    <label>${tr('Note','Note')}<textarea name="text" maxlength="4000">${esc(existing?.text||'')}</textarea></label>
    <p class="muted">${tr('Une correction du relevé ne ressuscite personne et ne rend aucun vote automatiquement. Les états actuels se corrigent dans les fiches. Les votes ne prouvent pas l’alignement.','Editing the record does not automatically revive anyone or restore votes. Edit current states in player cards. Votes do not prove alignment.')}</p>
    <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer le relevé','Save record')}</button></div></form>`,d=>{
      const readBallot=()=>$$('[data-voter]',d).map(row=>{const choice=row.dataset.choice;return{playerId:row.dataset.voter,choice,weight:choice==='unknown'?null:choice==='no'?0:Number(row.dataset.weight||1)};});
      const paint=row=>{
        const choice=row.dataset.choice;
        for(const b of $$('[data-vote]',row))b.setAttribute('aria-pressed',String(b.dataset.vote===choice));
        const weight=$('[data-voteweight]',row);
        weight.hidden=choice!=='yes';
        weight.value=row.dataset.weight||1;
      };
      const syncQuick=()=>{for(const chip of $$('[data-quickvote]',d)){const row=$(`[data-voter="${chip.dataset.quickvote}"]`,d);chip.setAttribute('aria-pressed',String(row?.dataset.choice==='yes'));}};
      const update=()=>{const b=ballotSummary(readBallot());$('#ballot-summary',d).textContent=tr(`${b.yes} oui (total ${b.knownWeight}) · ${b.no} non · ${b.unknown} non noté(s)`,`${b.yes} yes (total ${b.knownWeight}) · ${b.no} no · ${b.unknown} not recorded`);syncQuick();};
      $('.ballot-quick',d).addEventListener('click',e=>{
        const chip=e.target.closest('[data-quickvote]');if(!chip)return;
        const row=$(`[data-voter="${chip.dataset.quickvote}"]`,d);if(!row)return;
        row.dataset.choice=row.dataset.choice==='yes'?'unknown':'yes';paint(row);update();
      });
      $('.ballot-list',d).addEventListener('click',e=>{
        const vote=e.target.closest('[data-vote]');if(!vote)return;
        const row=vote.closest('[data-voter]');row.dataset.choice=vote.dataset.vote;paint(row);update();
      });
      $('.ballot-list',d).addEventListener('input',e=>{
        const weight=e.target.closest('[data-voteweight]');if(!weight)return;
        weight.closest('[data-voter]').dataset.weight=weight.value;update();
      });
      $('.ballot-bulk',d).addEventListener('click',e=>{
        const bulk=e.target.closest('[data-choice]');if(!bulk)return;
        for(const row of $$('[data-voter]',d)){row.dataset.choice=bulk.dataset.choice;paint(row);}
        update();
      });
      update();
      $('[name=day]',d).onchange=()=>{if(Number($('[name=day]',d).value)!==game.day){$('[name=applyState]',d).checked=false;$('[name=applyGhost]',d).checked=false;}};
      $('#round-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),target=f.get('target'),outcome=f.get('outcome'),ballot=readBallot(),day=Number(f.get('day'));
        if(!target)throw new Error(tr('Choisis la personne nommée ou exécutée.','Select the nominee or executed player.'));
        change(g=>{
          const text=String(f.get('text')).trim()||tr('Relevé de nomination et de scrutin','Nomination and ballot record');
          const record={id:existing?.id||uid(),type:outcome==='none'?'vote':'execution',text,playerIds:[target],sourceId:f.get('source'),roleId:'',value:String(f.get('value')),day,phase:'day',aliveSnapshot:existing?.aliveSnapshot||g.players.filter(p=>p.alive).map(p=>p.id),ballot,outcome:outcome==='none'?'unknown':outcome,complete:ballot.every(v=>v.choice!=='unknown'),influence:existing?.influence||{roleIds:[],multiplier:1,demonOnly:false,stable:false}};
          if(existing)g.events[g.events.findIndex(e=>e.id===existing.id)]=record;else g.events.push(record);
          if(outcome==='died'&&f.has('applyState')){const p=g.players.find(p=>p.id===target);if(p)p.alive=false;else throw new Error(tr('Ce siège est archivé : désactive la mise à jour de l’état actuel.','This seat is archived: disable current-state updates.'));}
          if(f.has('applyGhost'))for(const v of ballot){const p=g.players.find(p=>p.id===v.playerId);if(p&&!p.alive&&v.choice==='yes'&&!record.aliveSnapshot.includes(p.id))p.ghost=false;}
        },tr('Exécution et votes enregistrés','Execution and votes recorded'));close();
      }catch(err){error(err.message);}};
    });
}
function openNight(existing=null) {
  open(tr('Qui est mort cette nuit ?','Who died this night?'),`<form id="night-form">
    <label>${tr('Nuit n° (nuit 1 = début de partie)','Night number (night 1 = game opening)')}<input name="day" type="number" min="1" max="99" value="${existing?.day||game.day}" required></label>
    <fieldset><legend>${tr('Coche les décès annoncés pour cette nuit','Select deaths announced for this night')}</legend><div id="night-victims"></div></fieldset>
    <label class="check"><input name="complete" type="checkbox" ${existing?.complete?'checked':''}>${tr('C’est le bilan complet (aucune case = aucune mort annoncée)','This is the complete summary (nothing selected = no announced deaths)')}</label>
    <label class="check"><input name="applyState" type="checkbox" ${existing?'':'checked'}>${tr('Marquer ces joueurs morts dans l’état actuel','Mark these players dead in the current state')}</label>
    ${unlocked()?`<details><summary>${tr('Utiliser la nuit pour comparer les Démons','Use the night to compare Demons')}</summary>
    <p class="notice warning">${tr('Hypothèse simplifiée : un seul Démon, même rôle depuis le départ, ses attaques ordinaires sont l’unique source de ces morts. N’active pas si Assassin, Commère, Parieur, Grand-Mère, Tinker ou une autre cause peut ajouter des morts. Cela peut écarter à tort la vraie solution si ta supposition est fausse.','Simplified assumption: one Demon, unchanged starting character, with ordinary attacks as the sole source of these deaths. Do not enable if Assassin, Gossip, Gambler, Grandmother, Tinker or another cause may add deaths. A false assumption can exclude the real solution.')}</p>
    <label class="check"><input name="demonOnly" type="checkbox" ${existing?.influence?.demonOnly?'checked':''}>${tr('Je suppose ces morts causées uniquement par le Démon','I assume these deaths are caused only by the Demon')}</label>
    <label class="check"><input name="stable" type="checkbox" ${existing?.influence?.stable?'checked':''}>${tr('Je suppose un unique Démon au rôle initial inchangé, sans capacité supplémentaire','I assume one unchanged initial Demon with no extra ability')}</label>
    <label class="check"><input name="demonCapacityOptIn" type="checkbox" ${(existing?.demonCapacityOptIn||existing?.influence?.demonCapacityOptIn)?'checked':''}>${tr('Expérimental : appliquer quand même ce filtre aux estimations','Experimental: apply this filter to the estimates anyway')}</label>
    <p class="notice">${tr('Sans cette dernière case, l’hypothèse est notée mais n’élimine aucun Démon. C’est volontaire : c’est la déduction la plus fragile de l’application.','Without this last box the assumption is recorded but eliminates no Demon. This is deliberate: it is the most fragile deduction in the app.')}</p>
    <p class="muted">${tr('Comparaison par plafonds seulement : jusqu’à 1 mort pour les Démons simples couverts, 2 pour Shabaloth, 3 pour Po. Nuit 1 : pas de décès par ces capacités ordinaires ; le Pukka empoisonne pourtant dès cette nuit. Aucun minimum n’est imposé : protections et cibles mortes peuvent réduire le bilan. Les types catalogués sans plafond sont ignorés par ce filtre ; un personnage inconnu ou de catégorie inconnue désactive tout le calcul.','Upper bounds only: up to 1 death for covered single-kill Demons, 2 for Shabaloth, 3 for Po. Night 1: no death from these ordinary abilities, although Pukka already poisons that night. No minimum is imposed: protection and dead targets can reduce deaths. Catalogued types without a bound are ignored by this filter; an unknown character or category disables the entire calculation.')}</p></details>`:''}
    <label>${tr('Précisions','Details')}<textarea name="text" maxlength="4000">${esc(existing?.text||'')}</textarea></label>
    <div class="dialog-footer"><button type="submit" class="primary">${tr('Enregistrer la nuit','Save night')}</button></div></form>`,d=>{
      const selected=playerPicker($('#night-victims',d),existing?.playerIds||[]);
      $('[name=day]',d).onchange=()=>{if(Number($('[name=day]',d).value)!==game.day)$('[name=applyState]',d).checked=false;};
      $('#night-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),ids=selected(),day=Number(f.get('day'));
        if(!ids.length&&!f.has('complete'))throw new Error(tr('Sélectionne les morts ou confirme explicitement une nuit sans mort.','Select deaths or explicitly confirm a no-death night.'));
        if(game.events.some(e=>e.type==='night'&&e.day===day&&e.id!==existing?.id))throw new Error(tr('Cette nuit possède déjà un bilan. Corrige-le depuis le Carnet plutôt que le compter deux fois.','This night already has a summary. Edit it in Notebook rather than counting it twice.'));
        change(g=>{
          const record={id:existing?.id||uid(),type:'night',text:String(f.get('text')).trim()||tr('Décès nocturnes annoncés','Announced night deaths'),playerIds:ids,sourceId:'',roleId:'',value:String(ids.length),day,phase:'night',aliveSnapshot:existing?.aliveSnapshot||g.players.filter(p=>p.alive).map(p=>p.id),ballot:[],outcome:'unknown',complete:f.has('complete'),demonCapacityOptIn:f.has('demonCapacityOptIn'),influence:{roleIds:existing?.influence?.roleIds||[],multiplier:existing?.influence?.multiplier||1,demonOnly:f.has('demonOnly'),stable:f.has('stable'),demonCapacityOptIn:f.has('demonCapacityOptIn')}};
          if(existing)g.events[g.events.findIndex(e=>e.id===existing.id)]=record;else g.events.push(record);
          if(f.has('applyState'))for(const p of g.players)if(ids.includes(p.id))p.alive=false;
        },tr('Bilan de nuit enregistré','Night summary recorded'));close();
      }catch(err){error(err.message);}};
    });
}
function openEventInfluence(id) {
  const e=game.events.find(e=>e.id===id);
  open(tr('Interpréter cet événement','Interpret this event'),`<p class="notice">${tr('Pondération manuelle, pas une déduction de règle automatique. Choisis les rôles dont tu penses que la présence rend cet événement plus plausible. Les corrélations ou répétitions ne doivent pas être comptées plusieurs fois.','Manual weighting, not automatic rules inference. Select characters whose presence you think makes this event more plausible. Do not count correlations or repetitions multiple times.')}</p><p>${esc(phaseName(e))} · ${esc(e.text)}</p><div id="influence-roles"></div><label>${tr('Poids si au moins un rôle sélectionné était présent','Weight if at least one selected character was present')}<select id="influence-weight">${weightOptions(e.influence?.multiplier||1)}</select></label><p class="muted">${tr('Sans rôle sélectionné ou avec poids neutre, cet événement n’influence pas les estimations. Les votes ne donnent aucune certitude sur les camps.','No selected role or neutral weight means no effect on estimates. Votes give no certainty about teams.')}</p><div class="dialog-footer"><button id="influence-save" class="primary">${tr('Appliquer mon interprétation','Apply my interpretation')}</button></div>`,d=>{
    const selection=rolePicker($('#influence-roles',d),e.influence?.roleIds||[],modelRoles(),true);
    $('#influence-save',d).onclick=()=>{try{change(g=>{const record=g.events.find(x=>x.id===id);record.influence.roleIds=selection();record.influence.multiplier=Number($('#influence-weight',d).value);});close();}catch(err){error(err.message);}};
  });
}
function openObservation(source='',type='info') {
  const isVote=type==='vote',isNote=type==='note';
  open(isVote?tr('Nomination et vote','Nomination and vote'):isNote?tr('Une note pour plus tard','A note for later'):tr('Un nouvel indice','A new clue'),`
    <form id="observation-form"><label>${isVote?tr('Qui a nommé ?','Who nominated?'):tr('Source de l’information','Information source')}<select name="source">${playerOptions(source)}</select></label>
    ${!isVote&&!isNote?`<label>${tr('Format rapide','Quick format')}<select name="template" id="info-template"><option value="free">${tr('Libre','Freeform')}</option><option value="number">${tr('Un nombre reçu','A number received')}</option><option value="yesno">${tr('Oui / non sur des joueurs','Yes / no about players')}</option><option value="character">${tr('Un rôle parmi des joueurs','A character among players')}</option></select></label>`:''}
    <fieldset><legend>${isVote?tr('Joueur nommé','Nominee'):tr('Joueurs concernés','Players involved')}</legend><div id="observation-players"></div></fieldset>
    <div class="form-grid" ${isNote?'hidden':''}><label>${isVote?tr('Nombre de voix (si connu)','Vote total (if known)'):tr('Résultat reçu','Received result')}<input name="value" maxlength="100" placeholder="${isVote?'4':tr('0, 1, 2, oui, non…','0, 1, 2, yes, no…')}"></label>${!isVote?`<label>${tr('Rôle mentionné','Character mentioned')}<select name="role">${roleOptions()}</select></label>`:''}</div>
    <label>${tr('Détail','Detail')}<textarea name="text" maxlength="4000" ${isNote?'required':''} placeholder="${tr('Ce qui a réellement été dit ou observé…','What was actually said or observed…')}"></textarea></label><details><summary>${tr('Changer le moment','Change time')}</summary>${timeFields()}</details>
    <p class="muted">${tr('Les joueurs en vie maintenant sont mémorisés comme contexte de saisie. Pour un indice ancien, précise les voisins de l’époque.','Currently living players are saved as entry context. For older clues, specify the neighbours at that time.')}</p>
    <div class="dialog-footer"><button class="primary" type="submit">${tr('Noter','Save note')}</button></div></form>`,d=>{
      const selection=playerPicker($('#observation-players',d));
      const template=$('#info-template',d);
      if(template)template.onchange=()=>{$('[name=value]',d).placeholder=template.value==='yesno'?tr('Oui / Non','Yes / No'):template.value==='number'?'0, 1, 2…':'';};
      $('#observation-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),ids=selection(),value=String(f.get('value')||'').trim(),text=String(f.get('text')).trim(),rid=f.get('role')||'';
        if(!text&&!value&&!rid)throw new Error(tr('Ajoute un résultat, un rôle ou une note.','Add a result, character or note.'));
        if(isVote&&(ids.length!==1|| (value && !/^\d{1,3}$/.test(value))))throw new Error(tr('Choisis un seul nommé et un total entier si connu.','Select one nominee and an integer total if known.'));
        change(g=>{event(g,type,text || (isVote?tr('Vote observé','Observed vote'):tr('Information rapportée','Reported information')),ids,f.get('source'),value,rid);const ev=g.events.at(-1);ev.day=Number(f.get('day'));ev.phase=f.get('phase');},tr('Noté dans le carnet','Saved in notebook'));close();
      }catch(err){error(err.message);}};
    });
}
function openDomain(id) {
  const p=player(id);if(p.traveller)throw new Error(tr('Les Voyageurs ne sont pas inclus dans ce modèle.','Travellers are not included in this model.'));
  open(tr('Rôles initiaux supposés : ','Assumed initial characters: ')+p.name,`<p class="notice">${tr('Tu restreins volontairement le modèle, pas la réalité. Un rôle montré ou déclaré peut masquer l’Ivrogne, le Lunatique ou un bluff.','You are deliberately restricting the model, not reality. A shown or claimed character can conceal the Drunk, Lunatic or a bluff.')}</p><div id="domain-picker"></div><p class="muted">${tr('Ne rien sélectionner = tous les rôles possibles.','Select nothing = all characters possible.')}</p><div class="dialog-footer"><button id="domain-save" class="primary">${tr('Appliquer la supposition','Apply assumption')}</button></div>`,d=>{
    const selection=rolePicker($('#domain-picker',d),scenario().domains[id]||[],modelRoles());
    $('#domain-save',d).onclick=()=>{try{change(g=>g.scenarios.find(s=>s.id===g.activeScenario).domains[id]=selection());close();}catch(e){error(e.message);}};
  });
}
function openConstraint() {
  open(tr('Construire une idée à tester','Build an idea to test'),`<form id="constraint-form"><p class="notice warning">${tr('C’est ta supposition sur les rôles de départ, pas une vérité extraite d’une déclaration. Une capacité peut montrer un rôle différent du rôle réel.','This is your assumption about starting characters, not truth extracted from a claim. An ability can show a character different from the actual character.')}</p>
    <fieldset><legend>${tr('1. Parmi ces joueurs…','1. Among these players…')}</legend><label>${tr('Portée','Scope')}<select id="relation-scope"><option value="group">${tr('Des joueurs que je choisis','Players I choose')}</option><option value="neighbours">${tr('Les deux voisins vivants d’un joueur','The two living neighbours of a player')}</option></select></label><div id="constraint-players"></div><label id="relation-anchor-wrap" hidden>${tr('Le joueur dont on regarde les voisins','The player whose neighbours we look at')}<select id="relation-anchor">${normalPlayers().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><p class="muted" id="relation-anchor-note" hidden>${tr('Les voisins sont recalculés depuis l’ordre des sièges actuel, en sautant les morts. Utile pour l’Empathe ou un témoignage sur ses voisins.','Neighbours are recomputed from the current seating order, skipping the dead. Useful for the Empath or testimony about neighbours.')}</p></fieldset><label>${tr('2. Combien auraient le rôle ?','2. How many would have the character?')}<select id="relation-template"><option value="one">${tr('Exactement un','Exactly one')}</option><option value="none">${tr('Aucun','None')}</option><option value="atleast">${tr('Au moins un','At least one')}</option><option value="all">${tr('Tous','All')}</option><option value="custom">${tr('Autre nombre (avancé)','Other count (advanced)')}</option></select></label><div class="form-grid" id="relation-bounds" hidden><label>${tr('Au minimum','At least')}<input name="min" type="number" min="0" max="20" value="1" required></label><label>${tr('Au maximum','At most')}<input name="max" type="number" min="0" max="20" value="1" required></label></div>
    <p>${tr('…avaient un de ces rôles au départ :','…started as one of these characters:')}</p><div id="constraint-roles"></div>
    <label>${tr('D’où vient cette idée ?','Where does this idea come from?')}<select name="provenance">${[['hunch','Mon intuition','My hunch'],['claim','Ce qu’un joueur m’a dit','What a player told me'],['ability','Une information de capacité','Information from an ability'],['public','Une annonce publique','A public announcement'],['deduction','Ma déduction','My deduction']].map(([value,fr,en])=>`<option value="${value}">${tr(fr,en)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="fragile">${tr('Cette information pourrait être fausse (poison, ivresse, Vortox, enregistrement trompeur…)','This information could be false (poison, drunkenness, Vortox, misregistration…)')}</label>
    <label>${tr('Pourquoi je le suppose','Why I assume this')}<textarea name="note" maxlength="500" required placeholder="${tr('Si Alice dit vrai, était sobre et sans enregistrement trompeur…','If Alice is truthful, sober and without misregistration…')}"></textarea></label>
    <div id="relation-preview" class="notice" role="status"></div><div class="dialog-footer"><button type="submit" class="primary">${tr('Tester cette idée','Test this idea')}</button></div></form>`,d=>{
      const ps=playerPicker($('#constraint-players',d),[],normalPlayers()),rs=rolePicker($('#constraint-roles',d),[],modelRoles());
      const neighbourMode=()=>$('#relation-scope',d).value==='neighbours';
      const preview=()=>{
        const neighbours=neighbourMode();
        const n=neighbours?2:ps().length,type=$('#relation-template',d).value;
        $('#constraint-players',d).hidden=neighbours;
        $('#relation-anchor-wrap',d).hidden=!neighbours;
        $('#relation-anchor-note',d).hidden=!neighbours;
        $('#relation-bounds',d).hidden=type!=='custom';
        if(type!=='custom'){const values={one:[1,1],none:[0,0],atleast:[1,n],all:[n,n]}[type];$('[name=min]',d).value=values[0];$('[name=max]',d).value=values[1];}
        const draft=neighbours
          ?{kind:'neighbours',anchor:$('#relation-anchor',d).value,players:[],roleIds:rs(),min:Number($('[name=min]',d).value),max:Number($('[name=max]',d).value)}
          :{kind:'group',players:ps(),roleIds:rs(),min:Number($('[name=min]',d).value),max:Number($('[name=max]',d).value)};
        const ready=rs().length&&(neighbours?draft.anchor:ps().length);
        $('#relation-preview',d).textContent=ready?describeRelation(draft,pname,rname,lang):tr('Choisis des joueurs et un rôle pour voir la phrase complète.','Choose players and a character to see the full sentence.');
      };
      $('#constraint-form',d).addEventListener('click',preview);$('#constraint-form',d).addEventListener('input',preview);$('#constraint-form',d).addEventListener('change',preview);preview();
      $('#constraint-form',d).onsubmit=e=>{e.preventDefault();try{
        const f=new FormData(e.target),neighbours=neighbourMode();
        const c={id:uid(),kind:neighbours?'neighbours':'group',players:neighbours?[]:ps(),anchor:neighbours?$('#relation-anchor',d).value:'',roleIds:rs(),min:Number(f.get('min')),max:Number(f.get('max')),note:String(f.get('note')).trim(),enabled:true,provenance:f.get('provenance'),fragile:f.has('fragile')};
        if(!c.roleIds.length||c.min>c.max)throw new Error(tr('Choisis les rôles, avec des bornes cohérentes.','Select characters with consistent bounds.'));
        if(neighbours?(!c.anchor||c.max>2):(!c.players.length||c.max>c.players.length))throw new Error(tr('Choisis les joueurs et rôles, avec des bornes cohérentes.','Select players and characters with consistent bounds.'));
        change(g=>g.scenarios.find(s=>s.id===g.activeScenario).constraints.push(c));close();
      }catch(err){error(err.message);}};
    });
}
function openScenarioSettings() {
  const s=scenario();
  open(tr('Réglages de l’hypothèse','Hypothesis settings'),`<form id="scenario-form"><label>${tr('Nom','Name')}<input name="name" maxlength="80" value="${esc(s.name)}" required></label><p>${tr('Effectifs de départ supposés, hors Voyageurs. Ajuste les modificateurs de composition (Baron, etc.) toi-même, éventuellement dans plusieurs copies.','Assumed starting counts, excluding Travellers. Adjust setup modifiers (Baron, etc.) yourself, using separate copies if needed.')}</p><div class="count-grid">${TEAMS.map(t=>`<label>${esc(teamName(t))}<input name="${t}" type="number" min="0" max="20" value="${s.counts[t]}" required></label>`).join('')}</div><label>${tr('Raisonnement / exceptions assumées','Reasoning / assumed exceptions')}<textarea name="notes" maxlength="4000">${esc(s.notes)}</textarea></label>${game.rosterReviewRequired?`<p class="notice warning">${tr('La liste active doit représenter les participants initiaux pour ce modèle. Si un véritable participant est simplement parti, restaure son siège plutôt que de le retirer des hypothèses initiales. Les effectifs des autres branches ont été réinitialisés ; leurs anciennes idées restent à revoir.','The active list must represent initial participants for this model. If a real participant merely left, restore their seat rather than removing them from initial assumptions. Other branches had their counts reset; their old ideas still need review.')}</p><label class="check"><input name="reviewRoster" type="checkbox" required>${tr('Je confirme la liste initiale corrigée et j’ai revu les effectifs et les idées conservées.','I confirm the corrected initial roster and have reviewed counts and retained assumptions.')}</label>`:''}<div class="dialog-footer">${button('delete-scenario',tr('Supprimer','Delete'),'danger',game.scenarios.length<=1?'disabled':'')}<button type="submit" class="primary">${tr('Enregistrer','Save')}</button></div></form>`,d=>{
    $('#scenario-form',d).onsubmit=e=>{e.preventDefault();try{const f=new FormData(e.target);change(g=>{const q=g.scenarios.find(x=>x.id===g.activeScenario);q.name=String(f.get('name')).trim();q.notes=String(f.get('notes'));q.counts=Object.fromEntries(TEAMS.map(t=>[t,Number(f.get(t))]));if(g.rosterReviewRequired){if(!f.has('reviewRoster')||Object.values(q.counts).reduce((a,b)=>a+b,0)!==normalPlayers().length)throw new Error(tr('Confirme la liste et des effectifs cohérents.','Confirm the roster and consistent counts.'));g.rosterReviewRequired=false;}});close();}catch(err){error(err.message);}};
  });
}
function openScriptImport() {
  open(tr('Importer un script JSON','Import a JSON script'),`<p>${tr('Fichier du Script Tool officiel, IDs de rôles ou script personnalisé. Aucun dessin ni lien distant n’est chargé. Les rôles inconnus restent signalés.','Official Script Tool file, character IDs or custom script. No artwork or remote assets are loaded. Unknown characters remain flagged.')}</p><label>${tr('Choisir un fichier .json','Choose a .json file')}<input id="script-file" type="file" accept=".json,application/json"></label><label>${tr('Ou coller le JSON','Or paste JSON')}<textarea id="script-json" rows="6" maxlength="250000" placeholder='[{"id":"_meta","name":"Mon script"},{"id":"washerwoman"}]'></textarea></label><p class="muted">${tr('L’import sera proposé pour une nouvelle partie. Ton carnet actuel ne change pas tant que tu ne la crées pas.','The import will be offered for a new game. Your current notebook stays unchanged until you create it.')}</p><div class="dialog-footer"><button id="script-parse" class="primary">${tr('Lire le script','Read script')}</button></div>`,d=>{
      $('#script-file',d).onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>250000)throw new Error(tr('Maximum 250 Ko.','Maximum 250 KB.'));$('#script-json',d).value=await f.text();}catch(err){error(err.message);}};
      $('#script-parse',d).onclick=()=>{try{
        const s=parseScript($('#script-json',d).value,catalogue);
        if(s.warnings.length){open(tr('Script lu avec remarques','Script read with warnings'),`<h3 class="spaced">${esc(s.name)}</h3>${s.warnings.map(w=>`<p class="notice">${esc(w)}</p>`).join('')}<p>${s.roleIds.length} ${tr('rôles reconnus ou conservés','characters recognized or preserved')}</p><div class="dialog-footer"><button id="use-script" class="primary">${tr('Préparer la partie','Prepare game')}</button></div>`,d=>$('#use-script',d).onclick=()=>openNew(s));}
        else openNew(s);
      }catch(err){error(err.message);}};
    });
}
function download(name,content) {
  const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function openSettings() {
  open(tr('Ton carnet, tes réglages','Your notebook, your settings'),`
    <div class="form-grid"><label>${tr('Langue','Language')}<select id="language"><option value="fr" ${lang==='fr'?'selected':''}>Français</option><option value="en" ${lang==='en'?'selected':''}>English</option></select></label><label>${tr('Apparence','Appearance')}<select id="theme"><option value="dark" ${document.documentElement.dataset.theme==='dark'?'selected':''}>${tr('Nuit','Dark')}</option><option value="light" ${document.documentElement.dataset.theme==='light'?'selected':''}>${tr('Papier','Light')}</option></select></label></div>
    ${unlocked()?`<h3>${tr('Analyse avancée','Advanced analysis')}</h3><p class="muted">${tr('Outil privé, invisible tant qu’il n’est pas déverrouillé. Beaucoup de tables acceptent la prise de notes mais pas l’assistance au calcul : n’active ceci qu’avec leur accord.','Private tool, invisible until unlocked. Many tables accept note-taking but not calculation assistance: only enable it with their agreement.')}</p><div class="quick-actions">${button('toggle-estimates',estimatesOn()?tr('Masquer le calcul','Hide the calculation'):tr('Afficher le calcul','Show the calculation'))}${button('relock',tr('Reverrouiller et oublier','Re-lock and forget'))}</div><label class="check"><input type="checkbox" id="enrichment" ${game?.settings?.claimRoleEnrichment!==false?'checked':''}>${tr('Inclure automatiquement l’Ivrogne et le Lunatique dans les déclarations compatibles','Automatically include the Drunk and Lunatic in compatible claims')}</label>`:''}
    <h3>${tr('Sur cet appareil','On this device')}</h3><div class="quick-actions">${game?button('export',tr('Exporter mon carnet privé (.json)','Export my private notebook (.json)')):''}${button('restore',tr('Restaurer un carnet (.json)','Restore a notebook (.json)'))}${button('backup',tr('Copies de secours et stockage','Backups and storage'))}${button('new',tr('Nouvelle partie','New game'))}${demo?button('leave-demo',tr('Quitter la démo','Leave demo')):button('demo',tr('Ouvrir la démo sans toucher au carnet','Open demo without touching notebook'))}</div>
    <h3>${tr('Installation et hors-ligne','Install and offline')}</h3><p id="offline-status" class="muted">${offlineText()}</p>${deferredInstall?button('install',tr('Installer l’application','Install app'),'primary'):''}${updateReady?button('apply-update',tr('Mettre à jour maintenant','Update now'),'primary'):''}${button('force-update',tr('Forcer la mise à jour (vider le cache)','Force update (clear cache)'))}<p class="muted">${tr('Sur iPhone : Safari → Partager → Sur l’écran d’accueil. Sur ordinateur / Android : menu du navigateur → Installer. Une première ouverture connectée est nécessaire.','On iPhone: Safari → Share → Add to Home Screen. Desktop / Android: browser menu → Install. A first online visit is required.')}</p>
    <p class="notice">${tr('Aucune donnée envoyée au Conteur ni à un service IA. Le stockage navigateur n’est pas chiffré par l’application ; le rideau masque l’écran mais ne verrouille pas l’appareil. Un export contient tes notes secrètes.','No data is sent to the Storyteller or an AI service. Browser storage is not encrypted by the app; the cover hides the screen but does not lock the device. Exports contain your secret notes.')}</p>
    <p><a href="./guide.html" target="_blank" rel="noopener">${tr('Guide d’utilisation et limites','User guide and limitations')}</a></p><p class="footer-note"><span id="app-version">Carnet du Joueur 2.0</span> • Sébastien Place / @sebplace<br>CC BY-NC-SA 4.0 · ${tr('Indépendant de The Pandemonium Institute.','Independent of The Pandemonium Institute.')}</p>`,d=>{
    $('#language',d).onchange=e=>{lang=e.target.value;savePrefs();render();openSettings();};
    $('#theme',d).onchange=e=>{document.documentElement.dataset.theme=e.target.value;savePrefs();};
    $('#enrichment',d)?.addEventListener('change',e=>{try{change(g=>{g.settings.claimRoleEnrichment=e.target.checked;});}catch(err){error(err.message);}});
    $('#app-version',d).addEventListener('click',knock);
  });
}
let offlineReady=false,offlineError='',updateReady=false,reloadingForUpdate=false;
async function applyUpdate() {
  const go=async()=>{
    reloadingForUpdate=true;
    const registration=await navigator.serviceWorker?.getRegistration();
    if(registration?.waiting){
      navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
      registration.waiting.postMessage('SKIP_WAITING');
      setTimeout(()=>location.reload(),1500);
    } else location.reload();
  };
  if(game&&!demo)confirmAction(tr('Mettre à jour maintenant ?','Update now?'),tr('La page va se recharger. Tes notes enregistrées sont conservées ; une saisie ouverte et non enregistrée serait perdue.','The page will reload. Your saved notes are kept; an open unsaved form would be lost.'),go);
  else go();
}
async function forceUpdate() {
  reloadingForUpdate=true;
  try{
    const registrations=await navigator.serviceWorker?.getRegistrations?.()??[];
    for(const registration of registrations)await registration.unregister();
    for(const key of await caches.keys())await caches.delete(key);
  }catch(e){console.error(e);}
  location.reload();
}
function offlineText(){return offlineError|| (offlineReady?tr('Cache prêt : cette version peut être rouverte sans réseau.','Cache ready: this version can reopen without a network.'):tr('Cache hors-ligne en cours de préparation…','Preparing offline cache…'));}
let persistState='—';
function openBackups() {
  const list=store.backups();
  const usage=store.usage();
  const kb=n=>`${Math.round(n/1024).toLocaleString(lang)} Ko`;
  open(tr('Copies de secours','Backups'),`<p class="notice">${tr('Une copie est prise automatiquement avant chaque remplacement de partie. Elles vivent dans ce navigateur : un export reste le seul archivage durable.','A copy is taken automatically before each game replacement. They live in this browser: an export is the only durable archive.')}</p>
    ${list.length?list.map(b=>`<div class="issue"><strong>${esc(b.title||tr('Sans titre','Untitled'))}</strong><p class="muted">${b.players} ${tr('joueurs','players')} · ${kb(b.bytes)}${b.unreadable?' · '+tr('illisible','unreadable'):''}</p>${b.unreadable?'':button('restore-backup',tr('Reprendre cette copie','Restore this copy'),'',`data-slot="${b.slot}"`)}</div>`).join(''):`<p class="empty">${tr('Aucune copie pour le moment.','No copy yet.')}</p>`}
    <h3>${tr('Place occupée','Storage used')}</h3><p class="muted">${tr('Partie','Game')} ${kb(usage.game)} · ${tr('copies','copies')} ${kb(usage.backups)}</p>
    ${usage.total>2_000_000?`<p class="notice warning">${tr('Ce carnet devient volumineux. Exporte-le : le stockage du navigateur peut être plafonné autour de 5 Mo.','This notebook is getting large. Export it: browser storage is often capped around 5 MB.')}</p>`:''}
    <p class="muted">${tr('Stockage persistant','Persistent storage')} : <span id="persist-state">${esc(persistState)}</span></p>`);
}
async function requestPersistence() {
  try{
    if(!navigator.storage?.persist)persistState=tr('non géré par ce navigateur','not supported by this browser');
    else if(await navigator.storage.persisted())persistState=tr('accordé','granted');
    else persistState=await navigator.storage.persist()?tr('accordé','granted'):tr('refusé : le navigateur peut effacer ce carnet','refused: the browser may erase this notebook');
  }catch(e){persistState=tr('indisponible','unavailable');console.warn(e);}
  const el=$('#persist-state');if(el)el.textContent=persistState;
}
function openRestore() {
  open(tr('Restaurer un carnet','Restore notebook'),`<p class="notice">${tr('Un carnet contient des informations privées. Le fichier sera validé avant de remplacer la partie ; une copie de secours de l’ancien carnet enregistré sera conservée.','A notebook contains private information. The file is validated before replacing the game; a backup of the previous saved notebook is kept.')}</p><label>${tr('Fichier Carnet du Joueur .json','Player notebook .json file')}<input id="restore-file" type="file" accept=".json,application/json"></label>`,d=>{
    $('#restore-file',d).onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>LIMITS.save)throw new Error(tr(`Fichier trop volumineux (maximum ${Math.round(LIMITS.save/1000000)} Mo).`,`File too large (maximum ${Math.round(LIMITS.save/1000000)} MB).`));const imported=parseSave(await f.text());confirmAction(tr('Remplacer le carnet ?','Replace notebook?'),`${imported.title} · ${imported.players.length} ${tr('joueurs','players')}`,()=>replaceGame(imported));}catch(err){error(err.message);}};
  });
}
function launchDemo() {
  const s=catalogue.scripts.find(s=>s.id==='trouble-brewing')||catalogue.scripts[0];
  const g=newGame({...s,customRoles:[],warnings:[]},['Alice','Bruno','Chloé','David','Emma','Farid','Gaëlle'],tr('Les murmures de Ravenswood','Whispers of Ravenswood'));
  const ps=g.players,sc=g.scenarios[0];
  sc.name=tr('Version d’Alice','Alice’s version');
  const candidates=[['washerwoman'],['empath','imp'],['empath','imp'],['chef'],['monk'],['poisoner'],['soldier']];
  candidates.forEach((r,i)=>sc.domains[ps[i].id]=r);
  const claims=['washerwoman','empath','empath','chef','monk','soldier','soldier'];
  claims.forEach((r,i)=>{const c={id:uid(),playerId:ps[i].id,roleIds:[r],sourceId:ps[i].id,visibility:'private',note:'',day:1,phase:'day'};g.claims.push(c);event(g,'claim',tr('Déclare : ','Claims: ')+loc(catalogue.roles.find(x=>x.id===r).name),[ps[i].id],ps[i].id,c.id);});
  g.myRole='washerwoman';
  event(g,'info',tr('Bruno déclare Empathe et annonce le chiffre 1 : un de ses deux voisins vivants serait maléfique. À vérifier : qui était vivant à côté de lui cette nuit-là.','Bruno claims Empath and announces the number 1: one of his two living neighbours would be evil. Check who was alive beside him that night.'),[ps[0].id,ps[2].id],ps[1].id,'1');
  event(g,'note',tr('Exemple fictif. Le modèle est volontairement très restreint pour montrer deux mondes complets. Les déclarations n’ont pas été traitées comme des faits.','Fictional example. The model is deliberately narrow to show two complete worlds. Claims have not been treated as facts.'));
  ps[2].trust='watch';ps[5].trust='suspect';
  replaceGame(g,true);
}
function cover(explicit=false) {
  const screen=$('#cover');
  if(screen.open)return;
  $('#cover-text').textContent=tr('Les notes sont masquées.','Your notes are hidden.');
  $('#uncover').textContent=tr('Revenir à mon carnet','Return to my notebook');
  screen.showModal();
  if(explicit)try{sessionStorage.setItem('botc-player-covered','1');}catch{}
  $('#uncover').focus();
}
function uncover() {
  const screen=$('#cover');
  if(screen.open)screen.close();
  try{sessionStorage.removeItem('botc-player-covered');}catch{}
  if($('#dialog').open)$('#dialog').querySelector('[data-action=close]')?.focus();
  else ($('#privacy')||$('.thumb-hide'))?.focus();
}
const actions={
  close,new:()=>openNew(),demo:launchDemo,player:el=>openPlayer(el.dataset.id),
  roster:openRoster,coverage:openCoverage,
  mask:()=>cover(true),express:el=>openExpress(el.dataset.id||''),
  mynotes:openMyNotes,'self-add':openSelfEntry,'retain-add':openRetainEntry,endgame:openEndgame,'table-card':openTableCard,onboarding:openOnboarding,
  'self-delete':el=>change(g=>{g.selfLog=g.selfLog.filter(x=>x.id!==el.dataset.id);})||openMyNotes(),
  'retain-delete':el=>change(g=>{g.retained=g.retained.filter(x=>x.id!==el.dataset.id);})||openMyNotes(),
  'print-sheet':openPrintSheet,
  'toggle-estimates':()=>estimatesOn()?disableEstimates():requestEstimates(),
  relock,'table-menu':openTableMenu,
  shape:el=>{tableShape=el.dataset.shape==='plan'?'plan':'liste';savePrefs();render();},
  claim:el=>openClaim(el.dataset.id),'edit-claim':el=>{const c=game.claims.find(c=>c.id===el.dataset.id);openClaim(c.playerId,c);},
  observe:el=>openObservation(el.dataset.id||''),note:()=>openObservation('','note'),
  round:()=>openRound(),night:()=>openNight(),estimate:requestEstimates,'event-influence':el=>openEventInfluence(el.dataset.id),
  'player-probability':el=>open(tr('Rôles déclarés et estimations : ','Claimed characters and estimates: ')+pname(el.dataset.id),`<div data-player-estimate="${el.dataset.id}">${playerPrediction(el.dataset.id)}</div>`),
  explain:el=>openExplain(el.dataset.id||'',el.dataset.role||''),
  'edit-round':el=>{const ev=game.events.find(e=>e.id===el.dataset.id);ev.type==='night'?openNight(ev):openRound('',ev);},
  view:el=>{view=el.dataset.view;close();render();window.scrollTo({top:0});},
  domain:el=>openDomain(el.dataset.id),constraint:openConstraint,'scenario-settings':openScenarioSettings,'script-import':openScriptImport,
  analyze:startAnalysis,'stop-analysis':()=>{stopStrictSearch();renderWorlds();toast(tr('Exploration arrêtée','Exploration stopped'));},
  'journal-filter':el=>{noteType=el.dataset.type;renderJournal();},'role-team':el=>{roleTeam=el.dataset.team;renderScript();},
  'clone-scenario':()=>{if(game.scenarios.length>=8)throw new Error(tr('Maximum 8 hypothèses.','Maximum 8 hypotheses.'));change(g=>{const s=structuredClone(g.scenarios.find(s=>s.id===g.activeScenario));s.id=uid();s.name=tr('Copie : ','Copy: ')+s.name.slice(0,65);g.scenarios.push(s);g.activeScenario=s.id;});},
  'delete-scenario':()=>{if(game.scenarios.length<=1)return;confirmAction(tr('Supprimer cette hypothèse ?','Delete hypothesis?'),scenario().name,()=>change(g=>{g.scenarios=g.scenarios.filter(s=>s.id!==g.activeScenario);g.activeScenario=g.scenarios[0].id;}));},
  'delete-constraint':el=>change(g=>{const s=g.scenarios.find(s=>s.id===g.activeScenario);s.constraints=s.constraints.filter(c=>c.id!==el.dataset.id);}),
  'assume-claim':el=>{const c=game.claims.find(c=>c.id===el.dataset.id);if(player(c.playerId).traveller)throw new Error(tr('Voyageur exclu du modèle.','Traveller excluded from model.'));if(c.roleIds.some(id=>!TEAMS.includes(role(id).team)))throw new Error(tr('Catégorie de rôle non prise en charge.','Unsupported character category.'));
    confirmAction(tr('Tester cette déclaration comme rôle initial ?','Test this claim as initial character?'),tr('Cela écarte volontairement le bluff, les rôles montrés trompeurs et les changements de rôle pour ce joueur. Ce n’est pas une confirmation.','This deliberately rules out bluffing, misleading shown characters and role changes for this player. It is not confirmation.'),()=>change(g=>g.scenarios.find(s=>s.id===g.activeScenario).domains[c.playerId]=[...c.roleIds]));},
  'delete-claim':el=>confirmAction(tr('Supprimer cette déclaration ?','Delete claim?'),tr('Elle sera retirée avec son entrée de journal. Annulation possible.','It and its journal entry will be removed. Undo is available.'),()=>change(g=>{g.claims=g.claims.filter(c=>c.id!==el.dataset.id);g.events=g.events.filter(e=>!(e.type==='claim'&&e.value===el.dataset.id));})),
  'delete-event':el=>confirmAction(tr('Supprimer cette entrée ?','Delete entry?'),tr('Cela ne change pas l’état en vie / mort ni un vote déjà noté. Pour les corriger, utilise la fiche du joueur.','This does not change alive/dead status or a recorded vote state. Correct these from the player card.'),()=>change(g=>{const ev=g.events.find(e=>e.id===el.dataset.id);if(ev.type==='claim')g.claims=g.claims.filter(c=>c.id!==ev.value);g.events=g.events.filter(e=>e.id!==el.dataset.id);})),
  phase:()=>open(tr('Avancer dans la partie','Advance game phase'),`<form id="phase-form">${timeFields()}<p class="notice">${tr('Tu notes le moment courant. Aucun décès, réveil ou effet n’est automatisé.','You record the current phase. No death, wake or effect is automated.')}</p><div class="dialog-footer"><button class="primary" type="submit">${tr('Appliquer','Apply')}</button></div></form>`,d=>$('#phase-form',d).onsubmit=e=>{e.preventDefault();try{const f=new FormData(e.target);change(g=>{g.day=Number(f.get('day'));g.phase=f.get('phase');event(g,'phase',phaseName(g));});close();}catch(err){error(err.message);}}),
  life:el=>{const p=player(el.dataset.id);change(g=>{const q=g.players.find(x=>x.id===p.id);q.alive=!q.alive;event(g,q.alive?'revival':'death',q.alive?tr('Retour en vie observé','Observed revival'):tr('Décès observé','Observed death'),[q.id]);},p.alive?tr(`${p.name} noté mort. ↶ pour annuler.`,`${p.name} recorded dead. ↶ to undo.`):tr(`${p.name} noté vivant. ↶ pour annuler.`,`${p.name} recorded alive. ↶ to undo.`));if($('#dialog').open)openPlayer(p.id);},
  ghost:el=>{const p=player(el.dataset.id);change(g=>{const q=g.players.find(x=>x.id===p.id);q.ghost=!q.ghost;event(g,'vote',q.ghost?tr('Vote fantôme rendu dans mes notes','Ghost vote restored in my notes'):tr('Vote fantôme utilisé','Ghost vote used'),[q.id]);});openPlayer(p.id);},
  execution:el=>openRound(el.dataset.id),
  export:()=>{download(`carnet-joueur-${game.id.slice(0,8)}.json`,JSON.stringify(validateGame(game),null,2));toast(tr('Export privé téléchargé','Private export downloaded'));},
  restore:openRestore,backup:openBackups,'apply-update':applyUpdate,
  'force-update':()=>confirmAction(tr('Forcer la mise à jour ?','Force update?'),tr('Le cache hors-ligne sera vidé et la page rechargée. Tes carnets enregistrés ne sont pas touchés. Il faudra être connecté une fois pour reconstruire le cache.','The offline cache is cleared and the page reloads. Your saved notebooks are untouched. You will need to be online once to rebuild the cache.'),forceUpdate),
  'restore-backup':el=>{const b=store.backup(Number(el.dataset.slot));confirmAction(tr('Reprendre cette copie ?','Restore this copy?'),tr(`${b.title} — la partie actuelle sera remplacée et sauvegardée à son tour.`,`${b.title} — the current game will be replaced and backed up in turn.`),()=>replaceGame(b));},
  'leave-demo':()=>{const saved=store.load();demo=false;game=saved;history.clear();invalidate();close();render();},
  install:async()=>{if(!deferredInstall)return;await deferredInstall.prompt();deferredInstall=null;openSettings();}
};
document.addEventListener('click',async e=>{
  const seat=e.target.closest('[data-plan-seat]');
  if(seat){planSeat=planSeat===seat.dataset.planSeat?'':seat.dataset.planSeat;drawPlan();return;}
  const el=e.target.closest('[data-action]');if(!el)return;
  try{await actions[el.dataset.action]?.(el);}catch(err){error(err.message);}
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ')return;
  const seat=e.target.closest?.('[data-plan-seat]');if(!seat)return;
  e.preventDefault();planSeat=planSeat===seat.dataset.planSeat?'':seat.dataset.planSeat;drawPlan();
  $(`[data-plan-seat="${CSS.escape(seat.dataset.planSeat)}"]`)?.focus();
});
$('#settings').onclick=openSettings;$('#privacy').onclick=()=>cover(true);$('#uncover').onclick=uncover;
$('#undo').onclick=()=>{
  if(!history.canUndo()||locked)return;
  let step;
  try{step=history.undo(game,{commit:false});}catch(e){error(e.message);return;}
  if(!step)return;
  try{
    const previous=validateGame(step.state);
    if(!demo)store.save(previous);
    game=previous;history.commit();
    invalidate();render();schedulePrediction();
    toast(tr('Dernière modification annulée','Last change undone'));
  }catch(e){error(e.message);}
};
$('#dialog').addEventListener('close',()=>{if($('#cover').open)return; if(returnFocus?.isConnected&&!returnFocus.inert)returnFocus.focus();});
$('#dialog').addEventListener('cancel',e=>{e.preventDefault();close();});
document.addEventListener('keydown',e=>{if($('#cover').open&&(e.key==='Escape'||e.key==='Tab')){e.preventDefault();$('#uncover').focus();return;}if(e.key==='Escape'&&!$('#dialog').open){cover(true);}});
$('#cover').addEventListener('cancel',e=>e.preventDefault());
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY&&!demo&&game){locked=true;invalidate();render();}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&game)cover();});
window.addEventListener('pagehide',()=>{if(game)cover();});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
window.addEventListener('online',()=>toast(tr('Connexion retrouvée','Back online')));
window.addEventListener('offline',()=>toast(tr('Hors ligne : le carnet reste utilisable.','Offline: your notebook still works.')));
async function init() {
  store=createStorage(localStorage);
  const prefs=localStorage.getItem('botc-player-preferences');
  if(prefs){try{const p=JSON.parse(prefs);if(['fr','en'].includes(p.lang))lang=p.lang;if(['light','dark'].includes(p.theme))document.documentElement.dataset.theme=p.theme;if(['liste','plan'].includes(p.shape))tableShape=p.shape;}catch(e){console.warn('Invalid preferences',e);}}
  let covered=false;try{covered=sessionStorage.getItem('botc-player-covered')==='1';}catch{}
  const response=await fetch('./data/catalogue.json');
  if(!response.ok)throw new Error(tr('Impossible de charger les rôles.','Unable to load characters.'));
  catalogue=await response.json();
  try{game=store.load();}catch(e){loadError=tr('Carnet illisible, conservé sans modification. Restaure un export ou crée une nouvelle partie. ','Unreadable notebook, left unchanged. Restore an export or create a new game. ')+e.message;console.error(e);}
  render();schedulePrediction();
  if(covered&&game)cover();
  if(game)requestPersistence();
  if('serviceWorker' in navigator){
    try{
      const registration=await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      offlineReady=true;
      const announce=()=>{updateReady=true;render();};
      if(registration.waiting)announce();
      registration.addEventListener('updatefound',()=>{
        const installing=registration.installing;
        installing?.addEventListener('statechange',()=>{if(installing.state==='installed'&&navigator.serviceWorker.controller)announce();});
      });
      if($('#offline-status'))$('#offline-status').textContent=offlineText();
    }catch(e){offlineError=tr('Cache hors-ligne indisponible : ','Offline cache unavailable: ')+e.message;console.error(e);if($('#offline-status'))$('#offline-status').textContent=offlineText();}
  }else offlineError=tr('Ce navigateur ne permet pas le mode hors-ligne ici.','This browser cannot enable offline mode here.');
}
init().catch(e=>{$('#main').innerHTML=`<section class="card"><h1>${tr('Le carnet n’a pas pu s’ouvrir','The notebook could not open')}</h1><p>${esc(e.message)}</p><p>${tr('Utilise l’adresse HTTP locale fournie, pas une ouverture directe du fichier HTML. Vérifie aussi que le stockage du navigateur est autorisé.','Use the provided local HTTP address, not a direct HTML file. Check that browser storage is allowed.')}</p><button onclick="location.reload()">${tr('Réessayer','Retry')}</button></section>`;console.error(e);});


























