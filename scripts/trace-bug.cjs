#!/usr/bin/env node

const { readFileSync } = require('fs');
const snapshot = JSON.parse(readFileSync('./test/fixtures/live-snapshot.json'));

const bugId = parseInt(process.argv[2]) || 2012078;

// Trace path from bug to milestones via 'blocks' relationships
function findPath(startId, targetId, bugs) {
  const bugMap = new Map(bugs.map(b => [b.id, b]));
  const visited = new Set();
  const queue = [[startId, [startId]]];

  while (queue.length > 0) {
    const [currentId, path] = queue.shift();
    if (currentId === targetId) return path;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const bug = bugMap.get(currentId);
    if (!bug) continue;

    // Follow 'blocks' relationships (if A blocks B, B depends on A)
    for (const blockedId of bug.blocks || []) {
      if (!visited.has(blockedId)) {
        queue.push([blockedId, [...path, blockedId]]);
      }
    }
  }
  return null;
}

const bug = snapshot.bugs.find(b => b.id === bugId);
if (bug) {
  console.log(`Bug ${bugId}: ${bug.summary}`);
  console.log(`Depends on: ${JSON.stringify(bug.dependsOn)}`);
  console.log(`Blocks: ${JSON.stringify(bug.blocks)}`);
  console.log();
}

const milestones = [
  { name: 'Foxfooding', id: 1980342 },
  { name: 'Customer Pilot', id: 2012055 },
  { name: 'MVP', id: 1980739 }
];

for (const ms of milestones) {
  const path = findPath(bugId, ms.id, snapshot.bugs);
  if (path) {
    console.log(`Path to ${ms.name} (${ms.id}):`);
    for (const id of path) {
      const b = snapshot.bugs.find(x => x.id === id);
      console.log(`  ${id} - ${b?.summary || 'NOT FOUND'}`);
    }
    console.log();
  } else {
    console.log(`No path to ${ms.name}`);
  }
}
