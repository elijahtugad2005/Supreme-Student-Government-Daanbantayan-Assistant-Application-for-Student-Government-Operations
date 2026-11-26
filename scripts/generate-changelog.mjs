/**
 * generate-changelog.mjs
 * Compiles the full Git repository commit history into src/data/changelogData.json
 * for the Settings -> Changelogs & Repository Timeline view.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'src', 'data', 'changelogData.json');

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';

function runGit(args) {
  return execFileSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function normalizeRepoUrl(remoteUrl) {
  if (!remoteUrl) {
    return {
      owner: 'elijahtugad2005',
      name: 'Supreme-Student-Government-Daanbantayan-Assistant-Application-for-Student-Government-Operations',
      url: 'https://github.com/elijahtugad2005/Supreme-Student-Government-Daanbantayan-Assistant-Application-for-Student-Government-Operations',
    };
  }
  let webUrl = remoteUrl.trim();
  if (webUrl.startsWith('git@github.com:')) {
    webUrl = `https://github.com/${webUrl.slice('git@github.com:'.length)}`;
  }
  webUrl = webUrl.replace(/\.git$/i, '');

  const match = webUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
  return {
    owner: match ? match[1] : 'unknown',
    name: match ? match[2] : webUrl,
    url: webUrl,
  };
}

const CONVENTIONAL_RE = /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

function classifyCommit(subject) {
  const trimmed = String(subject || '').trim();
  const match = trimmed.match(CONVENTIONAL_RE);

  if (match) {
    const rawType = match[1].toLowerCase();
    const rawScope = match[2] || '';
    const breaking = Boolean(match[3]);
    const title = match[4].trim();
    const scopes = rawScope
      .split(/[,/]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const typeMap = {
      feat: 'feat',
      feature: 'feat',
      fix: 'fix',
      bugfix: 'fix',
      style: 'style',
      ui: 'style',
      refactor: 'refactor',
      perf: 'perf',
      test: 'test',
      tests: 'test',
      docs: 'docs',
      doc: 'docs',
      chore: 'chore',
      build: 'chore',
      ci: 'chore',
      revert: 'fix',
    };
    const type = typeMap[rawType] || 'chore';
    const isSecurityScope = scopes.some((s) => /security|auth|rbac|rule/i.test(s));

    let category = 'docs_chore';
    if (type === 'feat') category = 'feature';
    else if (isSecurityScope || type === 'test') category = 'security_test';
    else if (type === 'fix') category = 'fix';
    else if (type === 'style' || type === 'refactor' || type === 'perf') category = 'style';

    return { type, scopes, breaking, title, category };
  }

  // Fallback inference for early non-conventional commits
  const lower = trimmed.toLowerCase();
  if (/^initial commit/i.test(lower)) {
    return { type: 'chore', scopes: ['repo'], breaking: false, title: trimmed, category: 'docs_chore' };
  }
  if (/readme|tutorial|markdown|gitignore|doc/i.test(lower)) {
    return { type: 'docs', scopes: ['docs'], breaking: false, title: trimmed, category: 'docs_chore' };
  }
  if (/fix|bug|cutoff|invalid/i.test(lower) && !/^add(ed)?\b/i.test(lower)) {
    return { type: 'fix', scopes: [], breaking: false, title: trimmed, category: 'fix' };
  }
  if (/u\/i|ui|theme|color|padding|layout|mobile|css|centered|slider|animation/i.test(lower) && !/^added\s+(firebase|e-commerce|finance|router|announcement|member)/i.test(lower)) {
    return { type: 'style', scopes: ['ui'], breaking: false, title: trimmed, category: 'style' };
  }
  if (/add|added|provided|implem|merge|upgrade|update/i.test(lower)) {
    return { type: 'feat', scopes: [], breaking: false, title: trimmed, category: 'feature' };
  }
  return { type: 'chore', scopes: [], breaking: false, title: trimmed, category: 'docs_chore' };
}

function parseBodyLines(rawBody) {
  if (!rawBody) return [];
  return String(rawBody)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Co-authored-by:/i.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, ''));
}

function main() {
  const remoteUrl = runGit(['remote', 'get-url', 'origin']);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const repo = normalizeRepoUrl(remoteUrl);

  const format = ['%H', '%h', '%ad', '%aI', '%an', '%s', '%b'].join(FIELD_SEP) + RECORD_SEP;
  const rawLog = runGit(['log', '--date=short', `--pretty=format:${format}`]);

  const records = rawLog
    .split(RECORD_SEP)
    .map((r) => r.trim())
    .filter(Boolean);

  const commits = records.map((record) => {
    const [hash, shortHash, date, isoDate, author, subject, rawBody] = record.split(FIELD_SEP);
    const classified = classifyCommit(subject);
    const bodyLines = parseBodyLines(rawBody);

    return {
      hash,
      shortHash,
      date,
      monthKey: String(date || '').slice(0, 7),
      isoDate,
      author: String(author || '').trim(),
      subject: String(subject || '').trim(),
      title: classified.title,
      type: classified.type,
      scopes: classified.scopes,
      category: classified.category,
      breaking: classified.breaking,
      bodyLines,
      commitUrl: `${repo.url}/commit/${hash}`,
    };
  });

  const contributors = Array.from(new Set(commits.map((c) => c.author).filter(Boolean)));
  const stats = {
    totalCommits: commits.length,
    features: commits.filter((c) => c.category === 'feature').length,
    fixes: commits.filter((c) => c.category === 'fix').length,
    styles: commits.filter((c) => c.category === 'style').length,
    securityAndTests: commits.filter((c) => c.category === 'security_test').length,
    docsAndChores: commits.filter((c) => c.category === 'docs_chore').length,
    contributors,
    firstCommitDate: commits.length > 0 ? commits[commits.length - 1].date : '',
    latestCommitDate: commits.length > 0 ? commits[0].date : '',
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    repository: {
      ...repo,
      branch,
    },
    stats,
    commits,
  };

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `Compiled ${commits.length} commits from ${repo.owner}/${repo.name} (${branch}) -> src/data/changelogData.json`
  );
}

main();
