'use strict';

const { scan, finding, matchingBrace } = require('../util.js');
const { functionsOf, splitParams } = require('../decls.js');

// A function declared inside another function is local by nature; only
// top-level declarations can be orphaned at project scope.
function topLevel(functions) {
  return functions.filter((fn) => !functions.some((other) =>
    other !== fn && other.bodyStart < fn.index && fn.index < other.bodyEnd));
}

function normalizeBody(file, fn) {
  return file.noComments.slice(fn.bodyStart, fn.bodyEnd + 1).replace(/\s+/g, '');
}

// Names the framework calls, not the project: nothing in the repository
// references a Next.js page component or a route handler, and that is correct.
const CONVENTION_EXPORTS = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'middleware', 'handler', 'config', 'metadata', 'generateMetadata',
  'generateStaticParams', 'generateViewport', 'getServerSideProps',
  'getStaticProps', 'getStaticPaths', 'getInitialProps',
  'load', 'actions', 'action', 'loader', 'mount', 'setup', 'register',
  'onRequest', 'onMount', 'main', 'activate', 'deactivate',
]);

function exportKind(file, fn) {
  const before = file.masked.slice(Math.max(0, fn.index - 60), fn.index);
  if (/\bexport\s+default\s+(async\s+)?$/.test(before)) return 'default';
  if (/\bexport\s+(async\s+)?(const|let|var|function|class)?\s*$/.test(before)) return 'named';
  return null;
}

function orphans(ctx) {
  const findings = [];
  for (const file of ctx.files) {
    if (file.isTest) continue;

    for (const fn of topLevel(functionsOf(file))) {
      if (fn.name.length < 3 || fn.name.startsWith('_')) continue;
      if ((ctx.identifiers.get(fn.name) || 0) !== 1) continue;
      if (ctx.markupMentions.has(fn.name)) continue;

      const exported = exportKind(file, fn);
      // A default export is imported under whatever name the importer picks, so
      // counting this name proves nothing.
      if (exported === 'default') continue;
      if (CONVENTION_EXPORTS.has(fn.name)) continue;

      findings.push(finding(file, fn.index, 'orphan', exported ? 'low' : 'medium',
        exported
          ? `${fn.name}() is exported and nothing in this project imports it`
          : `${fn.name}() is defined here and referenced nowhere else in the project`));
    }

    // Bindings pulled in from a module and then never touched.
    for (const m of scan(file.masked, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/)) {
      if ((ctx.identifiers.get(m[1]) || 0) !== 1) continue;
      findings.push(finding(file, m.index, 'orphan', 'low',
        `${m[1]} is required here and never used`));
    }
    for (const m of scan(file.masked, /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(/)) {
      for (const name of splitParams(m[1])) {
        if ((ctx.identifiers.get(name) || 0) !== 1) continue;
        findings.push(finding(file, m.index, 'orphan', 'low',
          `${name} is destructured out of a module and never used`));
      }
    }
  }
  return findings;
}

function twins(ctx) {
  const groups = new Map();
  for (const file of ctx.files) {
    if (file.isTest) continue;
    for (const fn of functionsOf(file)) {
      if (!fn.blockBodied) continue;
      const body = normalizeBody(file, fn);
      if (body.length < 70) continue;
      if (!groups.has(body)) groups.set(body, []);
      groups.get(body).push({ file, fn });
    }
  }

  const findings = [];
  for (const sites of groups.values()) {
    if (sites.length < 2) continue;
    const [first, ...rest] = sites;
    for (const site of rest) {
      findings.push(finding(site.file, site.fn.index, 'twin', 'medium',
        `${site.fn.name}() is byte-for-byte the same function as ${first.fn.name}() in ${first.file.rel}:${first.fn.line}`));
    }
  }
  return findings;
}

function muteCatches(ctx) {
  const findings = [];
  for (const file of ctx.files) {
    for (const m of scan(file.masked, /\bcatch\s*(\(\s*([A-Za-z_$][\w$]*)?\s*\))?\s*\{/)) {
      const open = file.masked.indexOf('{', m.index);
      const close = matchingBrace(file.masked, open);
      if (close === -1) continue;
      const inner = file.src.slice(open + 1, close);
      if (/\S/.test(inner)) continue; // a comment or any statement counts as intent
      const binding = m[2];
      findings.push(finding(file, m.index, 'mute-catch', binding ? 'medium' : 'low',
        binding
          ? `the error is bound as "${binding}" and then dropped without a trace`
          : 'the failure is swallowed with no note of why that is safe'));
    }
  }
  return findings;
}

const GUARD_FORMS = (name) => [
  { re: new RegExp(`if\\s*\\(\\s*!\\s*${name}\\s*[)|&]`), sense: 'falsy' },
  { re: new RegExp(`if\\s*\\(\\s*${name}\\s*===?\\s*(undefined|null)\\b`), sense: 'unset' },
  { re: new RegExp(`if\\s*\\(\\s*typeof\\s+${name}\\s*===?\\s*['"]`), sense: 'typeof' },
  { re: new RegExp(`if\\s*\\(\\s*${name}\\s*==\\s*null\\b`), sense: 'unset' },
];

const LITERAL_KIND = [
  { re: /^\{/, what: 'an object literal' },
  { re: /^\[/, what: 'an array literal' },
  { re: /^(true|false)\b/, what: 'a boolean literal' },
  { re: /^-?\d/, what: 'a number literal' },
  { re: /^['"`]/, what: 'a string literal' },
  { re: /^new\s+[A-Z]/, what: 'a fresh instance' },
];

// Everything from `start` up to the brace that closes the block the statement
// sits in. Without this the search runs on into the next function and starts
// matching a different variable that happens to share the name.
function restOfBlock(masked, start, limit) {
  let depth = 0;
  const stop = Math.min(masked.length, start + limit);
  for (let i = start; i < stop; i++) {
    const ch = masked[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      if (depth === 0) return masked.slice(start, i);
      depth--;
    }
  }
  return masked.slice(start, stop);
}

function deadGuards(ctx) {
  const findings = [];
  const WINDOW = 700;
  for (const file of ctx.files) {
    for (const m of scan(file.masked, /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(.{0,12})/)) {
      const name = m[1];
      const tail = m[2];
      const kind = LITERAL_KIND.find((k) => k.re.test(tail));
      if (!kind) continue;
      const region = restOfBlock(file.masked, m.index, WINDOW);
      for (const form of GUARD_FORMS(name)) {
        const hit = form.re.exec(region);
        if (!hit) continue;
        const at = m.index + hit.index;
        findings.push(finding(file, at, 'dead-guard', 'medium',
          `${name} was just assigned ${kind.what}, so this check always goes the same way`));
        break;
      }
    }
  }
  return findings;
}

function run(ctx) {
  return [...orphans(ctx), ...twins(ctx), ...muteCatches(ctx), ...deadGuards(ctx)];
}

module.exports = { run };
