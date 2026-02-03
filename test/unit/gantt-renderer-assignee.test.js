import { describe, it, expect } from 'vitest';
import engineersData from '../../data/engineers.json' assert { type: 'json' };
import {
  normalizeAssigneeHandle,
  deriveInitialsFromHandle,
  buildEngineerHandleMap,
  getAssigneeDisplay,
  resolveEngineerDisplay
} from '../../js/gantt-renderer.js';

describe('gantt renderer assignee display helpers', () => {
  it('normalizes assignee handles from emails and tags', () => {
    expect(normalizeAssigneeHandle('jneuberger@mozilla.com')).toBe('jneuberger');
    expect(normalizeAssigneeHandle('lissyx+mozillians@lissyx.dyndns.org')).toBe('lissyx');
    expect(normalizeAssigneeHandle('john.smith@mozilla.com')).toBe('johnsmith');
  });

  it('derives initials from common Mozilla-style handles', () => {
    expect(deriveInitialsFromHandle('jneuberger')).toBe('JN');
    expect(deriveInitialsFromHandle('gpascutto')).toBe('GP');
    expect(deriveInitialsFromHandle('dtownsend')).toBe('DT');
  });

  it('maps known assignees to engineer display names', () => {
    const handleMap = buildEngineerHandleMap(engineersData.engineers);
    const assignee = getAssigneeDisplay('lissyx+mozillians@lissyx.dyndns.org', handleMap);
    expect(assignee.name).toBe('Alexandre Lissy');
    expect(assignee.initials).toBe('AL');
  });

  it('prefers original assignee for display when available', () => {
    const handleMap = buildEngineerHandleMap(engineersData.engineers);
    const resolved = resolveEngineerDisplay({
      originalAssignee: 'jneuberger@mozilla.com',
      scheduledEngineerName: 'Alexandre Lissy',
      engineerHandleMap: handleMap
    });
    expect(resolved.isSchedulerAssigned).toBe(false);
    expect(resolved.displayName).toBe('Janika Neuberger');
    expect(resolved.initials).toBe('JN');
  });

  it('uses scheduler assignment when no assignee is set', () => {
    const handleMap = buildEngineerHandleMap(engineersData.engineers);
    const resolved = resolveEngineerDisplay({
      originalAssignee: null,
      scheduledEngineerName: 'Alexandre Lissy',
      engineerHandleMap: handleMap
    });
    expect(resolved.isSchedulerAssigned).toBe(true);
    expect(resolved.displayName).toBe('Alexandre Lissy');
    expect(resolved.initials).toBe('AL');
  });
});
