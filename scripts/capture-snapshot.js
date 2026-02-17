#!/usr/bin/env node

/**
 * Capture a snapshot of the current Bugzilla bug tree for offline testing.
 *
 * Usage: node scripts/capture-snapshot.js
 *
 * Outputs to: test/fixtures/live-snapshot.json
 */

import { readFileSync } from 'fs';

const BUGZILLA_API_BASE = 'https://bugzilla.mozilla.org/rest';
const BATCH_SIZE = 100;

const milestonesData = JSON.parse(readFileSync(new URL('../data/milestones.json', import.meta.url)));
const MILESTONES = milestonesData.milestones.map(m => ({
  name: m.name,
  bugId: m.bugId
}));

async function fetchBugs(bugIds) {
  if (bugIds.length === 0) return [];

  const url = `${BUGZILLA_API_BASE}/bug?id=${bugIds.join(',')}&include_fields=id,summary,status,resolution,assigned_to,depends_on,blocks,whiteboard,component,product,severity,keywords`;

  console.log(`Fetching ${bugIds.length} bugs...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.bugs || [];
}

function processBug(rawBug) {
  const whiteboard = rawBug.whiteboard || '';
  const keywords = rawBug.keywords || [];
  const summary = rawBug.summary || '';

  // Extract size
  const sizeMatch = whiteboard.match(/\[size=(\d+\.?\d*)\]/i);
  const size = sizeMatch ? parseFloat(sizeMatch[1]) : null;

  // Check if meta bug
  const isMeta = whiteboard.toLowerCase().includes('[meta]') ||
    keywords.some(k => k.toLowerCase() === 'meta') ||
    summary.toLowerCase().includes('[meta]');

  return {
    id: rawBug.id,
    summary: rawBug.summary,
    status: rawBug.status,
    resolution: rawBug.resolution || null,
    assignee: rawBug.assigned_to || null,
    dependsOn: rawBug.depends_on || [],
    blocks: rawBug.blocks || [],
    whiteboard: whiteboard,
    keywords: keywords,
    component: rawBug.component,
    product: rawBug.product,
    severity: rawBug.severity || 'N/A',
    size: size,
    sizeEstimated: size === null,
    isMeta: isMeta
  };
}

async function fetchAllDependencies(rootBugIds) {
  const allBugs = new Map();
  const toFetch = new Set(rootBugIds.map(String));
  const fetched = new Set();
  const failedIds = new Set();

  let iteration = 0;
  const MAX_ITERATIONS = 1000;

  while (toFetch.size > 0 && iteration < MAX_ITERATIONS) {
    iteration++;

    const batch = Array.from(toFetch).slice(0, BATCH_SIZE);
    batch.forEach(id => {
      toFetch.delete(id);
      fetched.add(id);
    });

    try {
      const bugs = await fetchBugs(batch);

      for (const rawBug of bugs) {
        const bug = processBug(rawBug);
        allBugs.set(String(bug.id), bug);

        // Add dependencies to fetch queue
        for (const depId of bug.dependsOn) {
          const depIdStr = String(depId);
          if (!fetched.has(depIdStr) && !toFetch.has(depIdStr) && !failedIds.has(depIdStr)) {
            toFetch.add(depIdStr);
          }
        }
      }

      console.log(`  Iteration ${iteration}: ${allBugs.size} bugs collected, ${toFetch.size} remaining`);

      // Small delay to avoid rate limiting
      if (toFetch.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`Error fetching batch:`, error.message);
      batch.forEach(id => failedIds.add(id));
    }
  }

  return allBugs;
}

async function main() {
  console.log('Capturing Bugzilla snapshot...');
  console.log(`Milestones: ${MILESTONES.map(m => `${m.name} (${m.bugId})`).join(', ')}`);

  const milestoneBugIds = MILESTONES.map(m => m.bugId);
  const bugs = await fetchAllDependencies(milestoneBugIds);

  // Calculate statistics
  const resolvedStatuses = ['RESOLVED', 'VERIFIED', 'CLOSED'];
  const allBugsArray = Array.from(bugs.values());

  const stats = {
    totalBugs: allBugsArray.length,
    resolvedBugs: allBugsArray.filter(b => resolvedStatuses.includes(b.status)).length,
    unresolvedBugs: allBugsArray.filter(b => !resolvedStatuses.includes(b.status)).length,
    clientBugs: allBugsArray.filter(b => b.component === 'Client').length,
    metaBugs: allBugsArray.filter(b => b.isMeta).length,
    bugsWithSize: allBugsArray.filter(b => b.size !== null).length,
    bugsWithoutSize: allBugsArray.filter(b => b.size === null).length,
    bugsWithAssignee: allBugsArray.filter(b => b.assignee).length,
    bugsWithoutAssignee: allBugsArray.filter(b => !b.assignee).length,
    severityCounts: {},
    componentCounts: {}
  };

  // Count by severity
  for (const bug of allBugsArray) {
    const sev = bug.severity || 'N/A';
    stats.severityCounts[sev] = (stats.severityCounts[sev] || 0) + 1;
  }

  // Count by component
  for (const bug of allBugsArray) {
    const comp = bug.component || 'Unknown';
    stats.componentCounts[comp] = (stats.componentCounts[comp] || 0) + 1;
  }

  // Filter to Client component only (like the app does)
  const clientBugs = allBugsArray.filter(b =>
    b.component === 'Client' || milestoneBugIds.includes(b.id)
  );
  const unresolvedClientBugs = clientBugs.filter(b => !resolvedStatuses.includes(b.status));

  stats.clientUnresolvedBugs = unresolvedClientBugs.length;

  // Count severity among client bugs
  stats.clientSeverityCounts = {};
  for (const bug of unresolvedClientBugs) {
    const sev = bug.severity || 'N/A';
    stats.clientSeverityCounts[sev] = (stats.clientSeverityCounts[sev] || 0) + 1;
  }

  const snapshot = {
    capturedAt: new Date().toISOString(),
    milestones: MILESTONES,
    stats: stats,
    bugs: allBugsArray
  };

  // Write to file
  const fs = await import('fs');
  const path = await import('path');
  const outputPath = path.join(process.cwd(), 'test/fixtures/live-snapshot.json');

  fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));

  console.log('\n=== Snapshot Statistics ===');
  console.log(`Total bugs: ${stats.totalBugs}`);
  console.log(`Resolved: ${stats.resolvedBugs}, Unresolved: ${stats.unresolvedBugs}`);
  console.log(`Client component: ${stats.clientBugs} (${stats.clientUnresolvedBugs} unresolved)`);
  console.log(`Meta bugs: ${stats.metaBugs}`);
  console.log(`With size: ${stats.bugsWithSize}, Without size: ${stats.bugsWithoutSize}`);
  console.log(`With assignee: ${stats.bugsWithAssignee}, Without assignee: ${stats.bugsWithoutAssignee}`);
  console.log(`\nSeverity breakdown (Client, unresolved):`);
  for (const [sev, count] of Object.entries(stats.clientSeverityCounts).sort()) {
    console.log(`  ${sev}: ${count}`);
  }
  console.log(`\nSaved to: ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
