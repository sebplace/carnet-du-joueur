import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES_COVERAGE } from '../js/rules-coverage.js';

test('Po coverage describes the charge availability as partially bounded', () => {
  const coverage = RULES_COVERAGE.find(entry => entry.title[1] === 'Death upper bound for nine Demons');
  assert.equal(coverage.status, 'partial');
  assert.match(coverage.detail[0], /borne partiellement la charge du Po/);
  assert.match(coverage.detail[1], /partially bounds Po charging/);
  assert.match(coverage.detail[0], /nuit 2.*après une nuit avec des décès/);
  assert.match(coverage.detail[1], /night 2.*after a night with deaths/);
});
