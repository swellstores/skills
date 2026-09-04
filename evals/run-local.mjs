#!/usr/bin/env node
// Local eval runner — executes this suite with plain `claude -p`, for use when
// `claude plugin eval` is not enabled. Same case/grader files, same semantics
// for the grader types this suite uses (tool_used, regex, llm).
//
//   node evals/run-local.mjs --tag routing --runs 1
//   node evals/run-local.mjs --case 'writes-*' --arms both --model sonnet
//
// Exit code is 1 if any case scores below --threshold (default 1.0).

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
// Cases run in an empty directory: the agent must answer from the skill, not by
// grepping the repo it happens to be sitting in.
const SANDBOX = mkdtempSync(join(tmpdir(), 'swell-eval-'));
const PLUGIN_DIR = join(EVAL_DIR, '..');

// ---------- args ----------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const CFG = {
  tag: opt('tag'),
  caseGlob: opt('case'),
  runs: Number(opt('runs', 0)) || null,       // null = use case.yaml
  arms: opt('arms', 'with'),                   // with | both
  model: opt('model'),
  // Haiku mis-graded correct answers against these rubrics; sonnet is the floor
  // for a judge that has to weigh 'leads with X' and 'must not invent Y'.
  judgeModel: opt('judge-model', 'sonnet'),
  // Skills load references on demand, which costs turns — too low a budget reads
  // as a skill failure when the run simply never reached an answer.
  maxTurns: opt('max-turns', '25'),
  threshold: Number(opt('threshold', '1.0')),
  outDir: opt('out', join(EVAL_DIR, 'results')),
  dryRun: flag('dry-run'),
};

// ---------- tiny YAML subset parser ----------
// Handles what this suite uses: scalars, quoted strings, inline arrays, `|` blocks.
function parseYaml(text) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    let value = rawValue.trim();
    if (value === '|' || value === '|-' || value === '>') {
      const block = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() && !/^\s/.test(lines[j])) break;
        block.push(lines[j].replace(/^ {2,4}/, ''));
      }
      i = j - 1;
      out[key] = block.join('\n').trim();
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      continue;
    }
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      out[key] = value.slice(1, -1);
      continue;
    }
    if (value === 'true' || value === 'false') { out[key] = value === 'true'; continue; }
    if (value !== '' && !Number.isNaN(Number(value))) { out[key] = Number(value); continue; }
    out[key] = value;
  }
  return out;
}

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  return { meta: parseYaml(m[1]), body: m[2].trim() };
}

// ---------- load cases ----------
function loadCases() {
  const globToRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  const cases = [];
  for (const name of readdirSync(EVAL_DIR).sort()) {
    const dir = join(EVAL_DIR, name);
    if (!statSync(dir).isDirectory() || name === 'results') continue;
    let meta = {};
    try { meta = parseYaml(readFileSync(join(dir, 'case.yaml'), 'utf8')); } catch { continue; }
    const prompt = readFileSync(join(dir, meta.prompt_file || 'prompt.md'), 'utf8').trim();
    const graders = readdirSync(join(dir, 'graders')).filter((f) => f.endsWith('.md')).map((f) => {
      const { meta: gm, body } = parseFrontmatter(readFileSync(join(dir, 'graders', f), 'utf8'));
      return { file: f, ...gm, note: body };
    });
    if (CFG.tag && !(meta.tags || []).includes(CFG.tag)) continue;
    if (CFG.caseGlob && !globToRe(CFG.caseGlob).test(name)) continue;
    cases.push({ name, dir, meta, prompt, graders });
  }
  return cases;
}

// ---------- run one agent turn ----------
function runClaude(prompt, { withPlugin }) {
  return new Promise((resolve, reject) => {
    const a = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', String(CFG.maxTurns)];
    // Neutral cwd keeps the agent from treating the repo as its project, but the
    // skill must still be able to read its own reference files.
    if (withPlugin) a.push('--plugin-dir', PLUGIN_DIR, '--add-dir', PLUGIN_DIR);
    if (CFG.model) a.push('--model', CFG.model);
    const proc = spawn('claude', a, { stdio: ['pipe', 'pipe', 'pipe'], cwd: SANDBOX });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', () => {
      const toolUses = [];
      let result = '', cost = 0, loadedSkills = [], lastText = '', subtype = '';
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') {
          loadedSkills = ev.skills || [];
        } else if (ev.type === 'assistant') {
          for (const block of ev.message?.content || []) {
            if (block.type === 'tool_use') toolUses.push({ name: block.name, input: JSON.stringify(block.input) });
            else if (block.type === 'text' && block.text.trim()) lastText = block.text;
          }
        } else if (ev.type === 'result') {
          result = ev.result || '';
          cost = ev.total_cost_usd || 0;
          subtype = ev.subtype || '';
        }
      }
      if (!result && stderr) return reject(new Error(stderr.slice(0, 400)));
      // A run that exhausts --max-turns emits no `result`; grade its last message
      // rather than handing the judge an empty string.
      if (!result && lastText) result = lastText;
      resolve({ result, toolUses, cost, loadedSkills, subtype });
    });
    proc.stdin.end(prompt);
  });
}

// ---------- graders ----------
async function judge(criteria, output) {
  const prompt = `You are grading one response against a rubric. Reply with exactly PASS or FAIL on the first line, then one short sentence of justification.

RUBRIC:
${criteria}

RESPONSE TO GRADE:
${output}`;
  const a = ['-p', '--output-format', 'json', '--max-turns', '1', '--model', CFG.judgeModel];
  return new Promise((resolve) => {
    const proc = spawn('claude', a, { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('close', () => {
      let verdict = '', cost = 0;
      try { const j = JSON.parse(out); verdict = j.result || ''; cost = j.total_cost_usd || 0; } catch {}
      resolve({ pass: /^\s*PASS/i.test(verdict), detail: verdict.split('\n').slice(0, 2).join(' ').trim(), cost });
    });
    proc.stdin.end(prompt);
  });
}

async function grade(grader, run) {
  if (grader.type === 'tool_used') {
    const re = grader.input_match ? new RegExp(grader.input_match) : null;
    const hits = run.toolUses.filter((t) => t.name === grader.tool && (!re || re.test(t.input))).length;
    const min = grader.min ?? 1, max = grader.max ?? Infinity;
    return { pass: hits >= min && hits <= max, detail: `${hits} call(s), want ${min}..${max === Infinity ? '∞' : max}`, cost: 0 };
  }
  if (grader.type === 'regex') {
    const re = new RegExp(grader.pattern, grader.flags || '');
    const found = re.test(run.result);
    const want = (grader.match || 'contains') === 'contains';
    return { pass: found === want, detail: `${found ? 'found' : 'absent'} /${grader.pattern}/`, cost: 0 };
  }
  if (grader.type === 'llm') return judge(grader.criteria, run.result);
  return { pass: false, detail: `unsupported grader type: ${grader.type}`, cost: 0 };
}

// ---------- main ----------
const cases = loadCases();
if (!cases.length) { console.error('No cases matched.'); process.exit(2); }
const arms = CFG.arms === 'both' ? [true, false] : [true];

console.log(`\n${cases.length} case(s) · arms: ${CFG.arms} · model: ${CFG.model || '(cli default)'} · judge: ${CFG.judgeModel}\n`);
if (CFG.dryRun) {
  for (const c of cases) console.log(`  ${c.name}  runs=${CFG.runs ?? c.meta.runs ?? 3}  graders=${c.graders.map((g) => g.type).join(',')}`);
  process.exit(0);
}

const report = { started: new Date().toISOString(), cases: [] };
let totalCost = 0, failed = 0, warnedContaminated = false;

for (const c of cases) {
  const runs = CFG.runs ?? c.meta.runs ?? 3;
  const entry = { name: c.name, tags: c.meta.tags || [], arms: {} };
  for (const withPlugin of arms) {
    const armKey = withPlugin ? 'with' : 'without';
    const scores = [], details = [];
    for (let i = 0; i < runs; i++) {
      let run;
      try { run = await runClaude(c.prompt, { withPlugin }); }
      catch (e) { details.push(`run ${i + 1}: ERROR ${e.message}`); scores.push(0); continue; }
      totalCost += run.cost;
      if (!withPlugin && !warnedContaminated) {
        const leaked = (run.loadedSkills || []).filter((s) => /swell/i.test(s));
        if (leaked.length) {
          warnedContaminated = true;
          console.log(`\n  ⚠ baseline arm is contaminated — these Swell skills are installed globally and still load\n    without --plugin-dir: ${leaked.join(', ')}\n    The delta is meaningless until you uninstall them (e.g. /plugin uninstall swell-app@swell).\n`);
        }
      }
      const results = [];
      for (const g of c.graders) {
        const r = await grade(g, run);
        totalCost += r.cost || 0;
        results.push({ grader: g.file, ...r });
      }
      if (run.subtype && run.subtype !== 'success') details.push(`run ${i + 1}: ended as ${run.subtype} (raise --max-turns)`);
      const passed = results.filter((r) => r.pass).length;
      scores.push(passed / results.length);
      details.push(...results.filter((r) => !r.pass).map((r) => `run ${i + 1}: ${r.grader} — ${r.detail}`));
    }
    const score = scores.reduce((a, b) => a + b, 0) / scores.length;
    entry.arms[armKey] = { score, runs, failures: details };
    const bar = '█'.repeat(Math.round(score * 10)).padEnd(10, '·');
    console.log(`${score >= CFG.threshold ? '✓' : '✗'} ${c.name.padEnd(34)} ${armKey.padEnd(8)} ${bar} ${(score * 100).toFixed(0)}%`);
    for (const d of details.slice(0, 3)) console.log(`    ${d}`);
  }
  if (entry.arms.with.score < CFG.threshold) failed++;
  if (entry.arms.without) {
    const delta = entry.arms.with.score - entry.arms.without.score;
    entry.delta = delta;
    console.log(`  ${' '.repeat(34)} delta   ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}%  (skills vs. no skills)`);
  }
  report.cases.push(entry);
}

report.totalCostUsd = Number(totalCost.toFixed(4));
mkdirSync(CFG.outDir, { recursive: true });
const outFile = join(CFG.outDir, `local-${Date.now()}.json`);
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`\n${cases.length - failed}/${cases.length} cases at or above threshold ${CFG.threshold} · $${totalCost.toFixed(2)} · ${outFile}\n`);
process.exit(failed ? 1 : 0);
