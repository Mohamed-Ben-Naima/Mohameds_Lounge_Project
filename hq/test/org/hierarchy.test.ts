import { expect, test } from 'vitest';
import { ROSTER, DEPARTMENTS, getAgent } from '../../src/org/roster.ts';
import { canAssign, directReports, reviewerOf, leadOfDept } from '../../src/org/hierarchy.ts';

test('roster shape', () => {
  expect(ROSTER).toHaveLength(33);
  expect(new Set(ROSTER.map(a => a.id)).size).toBe(33);
  expect(DEPARTMENTS).toHaveLength(8);
  for (const d of DEPARTMENTS) {
    expect(getAgent(d.leadId).role).toBe('lead');
    expect(directReports(d.leadId).map(a => a.role)).toEqual(['specialist', 'specialist', 'specialist']);
    expect(leadOfDept(d.id).id).toBe(d.leadId);
  }
});

test('canAssign follows the chart only', () => {
  expect(canAssign('ceo', 'cto')).toBe(true);
  expect(canAssign('ceo', 'pentester')).toBe(false);
  expect(canAssign('ciso', 'pentester')).toBe(true);
  expect(canAssign('cto', 'pentester')).toBe(false);
  expect(canAssign('pentester', 'qa-engineer')).toBe(false);
  expect(canAssign('cto', 'ciso')).toBe(false);
});

test('reviewerOf', () => {
  expect(reviewerOf('pentester')).toBe('ciso');
  expect(reviewerOf('ciso')).toBe('ceo');
  expect(reviewerOf('ceo')).toBeNull();
});

test('pentester has no shell profile', () => expect(getAgent('pentester').toolProfile).toBe('writer'));

test('engineer profile set is exactly the planned list', () => {
  const engineers = ROSTER.filter(a => a.toolProfile === 'engineer').map(a => a.id).sort();
  expect(engineers).toEqual([
    'ai-integration-engineer', 'automation-engineer', 'cloud-devops-engineer', 'data-engineer',
    'devsecops-cloud-security-engineer', 'qa-engineer', 'software-engineer', 'systems-engineer',
  ]);
});

test('getAgent throws for unknown ids', () => {
  expect(() => getAgent('nobody')).toThrow('unknown agent nobody');
});
