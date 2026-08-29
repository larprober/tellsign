'use strict';

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const { lex, isIdentChar } = require('./lex.js');

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', 'vendor', 'bower_components',
  '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'android', 'ios',
]);

function walk(dir, root, files, opts) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      walk(full, root, files, opts);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!CODE_EXT.has(ext)) continue;
    if (/\.min\.js$/.test(entry.name)) continue;
    if (/\.d\.ts$/.test(entry.name)) continue;
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > opts.maxBytes) continue;
    files.push(full);
  }
}

function readPackage(root) {
  const pkgPath = path.join(root, 'package.json');
  const info = {
    exists: false,
    name: null,
    type: 'commonjs',
    declared: new Set(),
    runtime: new Set(),
    raw: null,
  };
  let raw;
  try {
    raw = fs.readFileSync(pkgPath, 'utf8');
  } catch {
    return info;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return info;
  }
  info.exists = true;
  info.raw = json;
  info.name = json.name || null;
  info.type = json.type === 'module' ? 'module' : 'commonjs';
  const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (const bucket of buckets) {
    for (const dep of Object.keys(json[bucket] || {})) {
      info.declared.add(dep);
      if (bucket === 'dependencies') info.runtime.add(dep);
    }
  }
  return info;
}

// Counts every identifier occurrence across the project's masked sources, so a
// rule can ask "is this name ever mentioned anywhere else?" in O(1).
function indexIdentifiers(files) {
  const counts = new Map();
  const perFile = new Map();
  for (const file of files) {
    const local = new Map();
    const text = file.masked;
    let i = 0;
    while (i < text.length) {
      if (!isIdentChar(text[i])) { i++; continue; }
      let j = i;
      while (j < text.length && isIdentChar(text[j])) j++;
      const word = text.slice(i, j);
      if (!/^[0-9]/.test(word)) {
        counts.set(word, (counts.get(word) || 0) + 1);
        local.set(word, (local.get(word) || 0) + 1);
      }
      i = j;
    }
    perFile.set(file.rel, local);
  }
  return { counts, perFile };
}

// A function called only from an onclick attribute or an inline script is not
// an orphan. Collect every identifier-shaped word out of the project's markup
// so the orphan rule can check there before accusing anything.
const MARKUP_EXT = new Set(['.html', '.htm', '.ejs', '.hbs', '.handlebars', '.pug', '.vue', '.svelte', '.astro']);

function markupMentions(root, opts) {
  const names = new Set();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) stack.push(full);
        continue;
      }
      if (!MARKUP_EXT.has(path.extname(entry.name))) continue;
      let text;
      try {
        if (fs.statSync(full).size > opts.maxBytes) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]);
    }
  }
  return names;
}

function load(root, opts = {}) {
  const options = { maxBytes: 1024 * 512, ...opts };
  const abs = path.resolve(root);
  const filePaths = [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) filePaths.push(abs);
  else walk(abs, abs, filePaths, options);

  const projectRoot = stat.isFile() ? path.dirname(abs) : abs;
  const files = [];
  for (const full of filePaths) {
    let src;
    try {
      src = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (src.includes('\u0000')) continue;
    const lexed = lex(src);
    files.push({
      path: full,
      rel: path.relative(projectRoot, full).split(path.sep).join('/') || path.basename(full),
      ext: path.extname(full),
      isTest: /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\./i.test(
        path.relative(projectRoot, full).split(path.sep).join('/')
      ),
      ...lexed,
    });
  }

  const pkg = readPackage(projectRoot);
  const index = indexIdentifiers(files);
  const mentions = markupMentions(projectRoot, options);

  return {
    root: projectRoot,
    files,
    pkg,
    builtins: new Set(builtinModules),
    identifiers: index.counts,
    identifiersByFile: index.perFile,
    markupMentions: mentions,
    options,
  };
}

module.exports = { load, CODE_EXT, SKIP_DIRS };
