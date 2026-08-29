'use strict';

const fs = require('fs');
const path = require('path');
const { load } = require('./project.js');
const { declaredNames } = require('./decls.js');
const { SEVERITY_ORDER } = require('./families.js');

const RULES = [
  require('./rules/imports.js'),
  require('./rules/apis.js'),
  require('./rules/comments.js'),
  require('./rules/structure.js'),
];

// A line of .tellsignignore, as a regex over project-relative paths:
// `*` stops at a slash, `**` crosses them, `?` is a single character.
function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      source += '[^/]';
      continue;
    }
    source += /[.+^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch;
  }
  return new RegExp('^' + source + '(/|$)');
}

function ignorePatterns(root) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, '.tellsignignore'), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => globToRegExp(line.replace(/\/$/, '')));
}

// Two rules can be right about the same line for different reasons. Where one
// finding strictly contains the other's news, keep the one that says more.
function collapse(findings) {
  const seen = new Set();
  const bySite = new Map();
  for (const f of findings) {
    const key = `${f.file}:${f.line}:${f.family}:${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const site = `${f.file}:${f.line}`;
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push(f);
  }

  const kept = [];
  for (const group of bySite.values()) {
    const hasPhantomImport = group.some((f) => f.family === 'phantom-import');
    for (const f of group) {
      if (hasPhantomImport && f.family === 'stale-recipe') continue;
      kept.push(f);
    }
  }
  return kept;
}

function summarize(findings) {
  const byFamily = new Map();
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    byFamily.set(f.family, (byFamily.get(f.family) || 0) + 1);
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }
  const ranked = [...byFamily.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    total: findings.length,
    byFamily: ranked,
    bySeverity,
    dominant: ranked.length ? ranked[0][0] : null,
  };
}

function scan(target, options = {}) {
  const ctx = load(target, options);
  const patterns = ignorePatterns(ctx.root);
  if (patterns.length) {
    ctx.files = ctx.files.filter((file) => !patterns.some((re) => re.test(file.rel)));
  }
  ctx.declaredNames = declaredNames(ctx.files);

  let findings = [];
  for (const rule of RULES) findings = findings.concat(rule.run(ctx));

  const min = SEVERITY_ORDER[options.min] || 1;
  findings = collapse(findings).filter((f) => SEVERITY_ORDER[f.severity] >= min);

  if (options.only && options.only.length) {
    findings = findings.filter((f) => options.only.includes(f.family));
  }
  if (options.ignore && options.ignore.length) {
    findings = findings.filter((f) => !options.ignore.includes(f.family));
  }

  findings.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
    a.family.localeCompare(b.family));

  return {
    root: ctx.root,
    fileCount: ctx.files.length,
    findings,
    summary: summarize(findings),
  };
}

module.exports = { scan, globToRegExp, RULES };
