'use strict';

const fs = require('fs');
const path = require('path');
const { stringStartingAt, scan, finding } = require('../util.js');

const RESOLVE_EXT = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json', '.node'];

// Packages the ecosystem moved past. Each entry says what the runtime now does
// for free, which is the part an assistant trained on older code tends to miss.
const STALE = {
  'node-fetch': 'fetch has been global since Node 18',
  request: 'unmaintained since 2020; fetch covers this',
  'request-promise': 'unmaintained since 2020; fetch covers this',
  'body-parser': 'express.json() has been built into Express since 4.16',
  uuid: 'crypto.randomUUID() is built in',
  mkdirp: 'fs.mkdir(p, { recursive: true }) is built in',
  rimraf: 'fs.rm(p, { recursive: true, force: true }) is built in',
  'left-pad': 'String.prototype.padStart is built in',
  querystring: 'legacy API; URLSearchParams is the supported one',
  'object-assign': 'Object.assign and object spread are built in',
  'is-promise': 'a two-line check; not worth a dependency',
  'array-flatten': 'Array.prototype.flat is built in',
  'string.prototype.padstart': 'built in since ES2017',
  colors: 'the package was sabotaged by its author in 2022; use picocolors or ANSI codes',
};

// Declared but never imported is normal for these - they are wired in by a
// config file, a build step or a framework rather than by an import statement.
const IMPLICITLY_USED = new Set([
  'react', 'react-dom', 'typescript', 'tailwindcss', 'postcss', 'autoprefixer',
  'sass', 'less', 'eslint', 'prettier', 'husky', 'nodemon', 'concurrently',
  'cross-env', 'ts-node', 'tsx', 'jest', 'mocha', 'vitest', 'electron',
  'electron-builder', 'esbuild', 'webpack', 'vite', 'rollup', 'parcel',
  'babel', 'core-js', 'regenerator-runtime', 'dotenv', 'pm2', 'serve',
]);

function isImplicit(name) {
  if (IMPLICITLY_USED.has(name)) return true;
  return /^(@types|@babel|@eslint|@typescript-eslint|@vitejs|@rollup|@capacitor|@expo|eslint-|babel-|webpack-|vite-|rollup-|postcss-|prettier-|jest-|@testing-library)/.test(name);
}

function rootOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function collectImports(file) {
  const found = [];
  const patterns = [
    { re: /\brequire\s*\(\s*(?=["'])/, kind: 'require' },
    { re: /\bfrom\s+(?=["'])/, kind: 'import' },
    { re: /\bimport\s*\(\s*(?=["'])/, kind: 'dynamic import' },
    { re: /\bimport\s+(?=["'])/, kind: 'side-effect import' },
  ];
  for (const { re, kind } of patterns) {
    for (const m of scan(file.masked, re)) {
      const str = stringStartingAt(file, m.index + m[0].length);
      if (!str) continue;
      found.push({ spec: str.value, index: m.index, kind });
    }
  }
  return found;
}

function aliasPrefixes(root) {
  const prefixes = [];
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(root, name), 'utf8');
    } catch {
      continue;
    }
    for (const m of raw.matchAll(/"([^"\s]+)\/?\*?"\s*:\s*\[/g)) {
      const key = m[1].replace(/\*$/, '');
      if (key && !key.startsWith('.')) prefixes.push(key);
    }
  }
  return prefixes;
}

function resolvesOnDisk(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of RESOLVE_EXT) {
    const candidate = base + ext;
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return true;
      if (stat.isDirectory() && ext === '') {
        for (const inner of RESOLVE_EXT.slice(1)) {
          if (fs.existsSync(path.join(candidate, 'index' + inner))) return true;
        }
        if (fs.existsSync(path.join(candidate, 'package.json'))) return true;
      }
    } catch {
      /* keep trying the other extensions */
    }
  }
  return false;
}

function run(ctx) {
  const findings = [];
  const aliases = aliasPrefixes(ctx.root);
  const usedRoots = new Set();

  for (const file of ctx.files) {
    for (const imp of collectImports(file)) {
      const spec = imp.spec;
      if (!spec || /^(https?:|data:|node:|bun:|file:)/.test(spec)) continue;
      if (spec.startsWith('#')) continue;

      if (spec.startsWith('.') || path.isAbsolute(spec)) {
        if (!resolvesOnDisk(file.path, spec)) {
          findings.push(finding(file, imp.index, 'phantom-import', 'high',
            `"${spec}" resolves to no file on disk`));
        }
        continue;
      }

      const root = rootOf(spec);
      usedRoots.add(root);
      if (ctx.builtins.has(root)) {
        if (STALE[root]) {
          findings.push(finding(file, imp.index, 'stale-recipe', 'low',
            `"${spec}" - ${STALE[root]}`));
        }
        continue;
      }
      if (aliases.some((p) => spec.startsWith(p))) continue;

      if (STALE[root]) {
        findings.push(finding(file, imp.index, 'stale-recipe', 'low',
          `"${root}" - ${STALE[root]}`));
      }

      if (!ctx.pkg.exists) continue;
      if (ctx.pkg.declared.has(root)) continue;
      if (root === ctx.pkg.name) continue;
      if (fs.existsSync(path.join(ctx.root, 'node_modules', root))) continue;

      findings.push(finding(file, imp.index, 'phantom-import', 'high',
        `"${root}" is imported but is not a dependency, a builtin, or installed`));
    }
  }

  if (ctx.pkg.exists && ctx.files.length > 0) {
    for (const dep of ctx.pkg.runtime) {
      if (usedRoots.has(dep) || isImplicit(dep)) continue;
      findings.push({
        family: 'barnacle',
        severity: 'low',
        message: `"${dep}" is a runtime dependency that nothing imports`,
        file: 'package.json',
        line: 0,
        evidence: `"${dep}"`,
      });
    }
  }

  return findings;
}

module.exports = { run, collectImports, rootOf };
