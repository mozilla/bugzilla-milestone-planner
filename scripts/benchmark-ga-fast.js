#!/usr/bin/env node
/**
 * Benchmark faster GA configurations for optimal mode.
 */

import { DependencyGraph } from '../js/dependency-graph.js';
import { isBetterScore } from '../js/optimizer-utils.js';
import { readFileSync } from 'fs';

const snapshot = JSON.parse(readFileSync(new URL('../test/fixtures/live-snapshot.json', import.meta.url)));
const engineersData = JSON.parse(readFileSync(new URL('../data/engineers.json', import.meta.url)));

function buildOptimizerEngineers(bugs, baseEngineers) {
  const engineers = baseEngineers.map(e => ({ ...e, isExternal: false }));
  const knownEmails = new Set(engineers.map(e => e.email?.toLowerCase()).filter(Boolean));
  const externals = new Map();
  for (const bug of bugs || []) {
    if (!bug.assignee || bug.assignee === 'nobody@mozilla.org') continue;
    const email = bug.assignee.toLowerCase();
    if (knownEmails.has(email)) continue;
    if (!externals.has(email)) {
      externals.set(email, {
        id: `external:${email}`, name: 'External', email,
        availability: 1.0, unavailability: [], isExternal: true
      });
    }
  }
  return [...engineers, ...externals.values()];
}

const MILESTONES = [
  { name: 'Foxfooding', bugId: 1980342, deadline: new Date('2026-02-23'), freezeDate: new Date('2026-02-16') },
  { name: 'Customer Pilot', bugId: 2012055, deadline: new Date('2026-03-30'), freezeDate: new Date('2026-03-23') },
  { name: 'MVP', bugId: 1980739, deadline: new Date('2026-09-15'), freezeDate: new Date('2026-09-08') }
];
const RESOLVED_STATUSES = ['RESOLVED', 'VERIFIED', 'CLOSED'];

const SEVERITY_FILTERS = {
  'S1-S2': (sev) => ['S1', 'S2'].includes(sev),
  'All': () => true
};

function prepareData(severityFilter) {
  const bugMap = new Map();
  for (const bug of snapshot.bugs) bugMap.set(String(bug.id), bug);

  const graph = new DependencyGraph();
  graph.buildFromBugs(bugMap);
  const { sorted } = graph.topologicalSort();
  const sortedBugs = sorted.map(id => bugMap.get(id)).filter(Boolean);

  const milestoneBugIds = new Set(MILESTONES.map(m => String(m.bugId)));
  const severityFn = SEVERITY_FILTERS[severityFilter] || SEVERITY_FILTERS['S1-S2'];

  const filteredBugs = sortedBugs.filter(b => {
    if (milestoneBugIds.has(String(b.id))) return true;
    if (RESOLVED_STATUSES.includes(b.status)) return false;
    if (b.component !== 'Client') return false;
    return severityFn(b.severity);
  });

  const graphData = {};
  for (const bug of snapshot.bugs) graphData[String(bug.id)] = bug.dependsOn || [];

  return { filteredBugs, graphData, engineers: buildOptimizerEngineers(filteredBugs, engineersData.engineers) };
}

let gaOnmessage = null;

async function setupGA() {
  const messages = [];
  globalThis.self = {
    postMessage: (msg) => messages.push(msg),
    close: () => {}
  };
  await import('../js/ga-scheduler-worker.js');
  gaOnmessage = globalThis.self.onmessage;
  return messages;
}

function runGA(messages, data, options) {
  messages.length = 0;
  const saved = globalThis.self.postMessage;
  globalThis.self.postMessage = (msg) => messages.push(msg);

  gaOnmessage({
    data: {
      type: 'start',
      data: {
        bugs: data.filteredBugs,
        engineers: data.engineers,
        graph: data.graphData,
        milestones: MILESTONES.map(m => ({
          name: m.name, bugId: m.bugId,
          deadline: m.deadline.toISOString(),
          freezeDate: m.freezeDate.toISOString()
        })),
        ...options
      }
    }
  });

  globalThis.self.postMessage = saved;
  return messages.find(m => m.type === 'complete');
}

async function main() {
  const messages = await setupGA();

  // Test configurations
  const configs = [
    { name: '50×200 (baseline)', populationSize: 50, generations: 200 },
    { name: '50×100', populationSize: 50, generations: 100 },
    { name: '50×50', populationSize: 50, generations: 50 },
    { name: '40×100', populationSize: 40, generations: 100 },
    { name: '40×75', populationSize: 40, generations: 75 },
    { name: '30×100', populationSize: 30, generations: 100 },
    { name: '30×75', populationSize: 30, generations: 75 },
    { name: '30×50', populationSize: 30, generations: 50 },
  ];

  const RUNS = 12; // Match 12 workers

  for (const filter of ['S1-S2', 'All']) {
    console.log(`\n=== ${filter} Filter ===`);
    const data = prepareData(filter);
    console.log(`Bugs: ${data.filteredBugs.length}\n`);

    const results = [];

    for (const config of configs) {
      const runResults = [];
      const start = Date.now();

      for (let i = 0; i < RUNS; i++) {
        const result = runGA(messages, data, {
          populationSize: config.populationSize,
          generations: config.generations,
          id: i
        });
        if (result) {
          runResults.push({
            deadlines: result.deadlinesMet,
            lateness: result.totalLateness || 0,
            makespan: result.makespan,
            convergedAt: result.bestFoundAtGeneration
          });
        }
      }

      const elapsed = Date.now() - start;
      const perRun = (elapsed / RUNS).toFixed(0);

      // Find best across runs
      let best = { deadlinesMet: -1, totalLateness: Infinity, makespan: Infinity };
      for (const r of runResults) {
        const score = { deadlinesMet: r.deadlines, totalLateness: r.lateness, makespan: r.makespan };
        if (isBetterScore(score, best)) best = score;
      }

      // Count optimal hits (matching best deadlines + lateness)
      const optimalHits = runResults.filter(r =>
        r.deadlines === best.deadlinesMet &&
        r.lateness === best.totalLateness &&
        r.makespan === best.makespan
      ).length;

      // Makespan stats
      const makespans = runResults.map(r => r.makespan).sort((a,b) => a-b);
      const minMs = makespans[0];
      const maxMs = makespans[makespans.length - 1];
      const avgMs = (makespans.reduce((a,b) => a+b, 0) / makespans.length).toFixed(0);

      // Convergence stats
      const convergences = runResults.map(r => r.convergedAt);
      const avgConv = (convergences.reduce((a,b) => a+b, 0) / convergences.length).toFixed(0);

      results.push({
        name: config.name,
        time: perRun,
        deadlines: best.deadlinesMet,
        lateness: best.totalLateness,
        bestMakespan: minMs,
        avgMakespan: avgMs,
        worstMakespan: maxMs,
        optimalHits: `${optimalHits}/${RUNS}`,
        avgConvergence: avgConv
      });
    }

    // Print results table
    console.log('| Config | Time | Deadlines | Best MS | Avg MS | Worst MS | Optimal | Converge |');
    console.log('|--------|------|-----------|---------|--------|----------|---------|----------|');
    for (const r of results) {
      console.log(`| ${r.name.padEnd(14)} | ${r.time.padStart(4)}ms | ${r.deadlines}/3       | ${String(r.bestMakespan).padStart(5)}d  | ${r.avgMakespan.padStart(5)}d | ${String(r.worstMakespan).padStart(6)}d  | ${r.optimalHits.padStart(5)}   | gen ${r.avgConvergence.padStart(3)}  |`);
    }
  }
}

main().catch(console.error);
