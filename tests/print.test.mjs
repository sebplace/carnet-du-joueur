import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame} from '../js/state.js';
import {printableSheet} from '../js/print.js';

const catalogue = {roles:[
  {id:'chef',name:{fr:'Chef',en:'Chef'}},
  {id:'empath',name:{fr:'Empathe',en:'Empath'}},
  {id:'imp',name:{fr:'Diablotin',en:'Imp'}}
]};
const script = {name:'Trouble <script>alert(1)</script>',roleIds:['chef','empath','imp'],customRoles:[],warnings:[]};

function game(n) {
  return newGame(script,Array.from({length:n},(_,i)=>i===0?'Alice <img src=x>':`P${i+1}`));
}

test('printable sheet escapes hostile names and has no scripts or external URLs',()=>{
  const html = printableSheet(game(5),{catalogue,lang:'en'});
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Alice &lt;img src=x&gt;'));
  assert.equal(/<script[\s>]/i.test(html),false);
  assert.equal(/\bhttps?:\/\//i.test(html),false);
});

test('printable sheet contains one row per seat for five and twenty players',()=>{
  for (const n of [5,20]) {
    const html = printableSheet(game(n),{catalogue,lang:'fr'});
    const rows = (html.match(/<tr>/g) ?? []).length - 1;
    assert.equal(rows,n);
    assert.ok(html.includes(`${n} joueurs`));
  }
});

test('printable sheet excludes recorded notes by default and includes them only on request',()=>{
  const g = game(5);
  g.claims.push({id:'c1',playerId:g.players[0].id,roleIds:['chef'],sourceId:g.players[0].id,visibility:'private',note:'private claim',day:1,phase:'day',weight:1});
  g.events.push({id:'e1',type:'info',playerIds:[g.players[0].id],sourceId:g.players[0].id,roleId:'',text:'secret note',value:'',day:1,phase:'day',aliveSnapshot:[],ballot:[],outcome:'unknown',complete:false,influence:{roleIds:[],multiplier:1,demonOnly:false,stable:false}});
  assert.equal(printableSheet(g,{catalogue}).includes('secret note'),false);
  assert.equal(printableSheet(g,{catalogue,includeRecorded:true}).includes('secret note'),true);
});

test('printable sheet includes required paper sections and script reference',()=>{
  const html = printableSheet(game(5),{catalogue,lang:'en'});
  assert.ok(html.includes('Starting composition'));
  assert.ok(html.includes('Votes and nominations'));
  assert.ok(html.includes('Night deaths'));
  assert.ok(html.includes('Script characters'));
  assert.ok(html.includes('<li>Chef</li>'));
});
