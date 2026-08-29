'use strict';

const { scan, finding } = require('../util.js');
const { collectImports, rootOf } = require('./imports.js');

// Method names that read like the real thing and are not. Each entry names the
// family it belongs to, because "fs.readFileAsync" and "JSON.loads" are wrong
// in two different ways: one is invented, the other is Python.
const PATTERNS = [
  {
    re: /\bJSON\.(loads|dumps|load|dump)\s*\(/,
    family: 'crossbreed', severity: 'high',
    message: (m) => `JSON.${m[1]} is Python - JavaScript has JSON.parse and JSON.stringify`,
  },
  {
    re: /\bObject\.(map|filter|forEach|reduce|find|some|every)\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: (m) => `Object.${m[1]} does not exist - Object.entries(obj).${m[1]}(...) is the real form`,
  },
  {
    re: /\bMath\.(sum|average|avg|median|randomInt|clamp)\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: (m) => `Math.${m[1]} does not exist`,
  },
  {
    re: /\bfs\.(readFileAsync|writeFileAsync|existsAsync|readdirAsync|appendFileAsync|mkdirAsync|statAsync|unlinkAsync)\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: (m) => `fs.${m[1]} does not exist - the promise API is fs.promises.${m[1].replace(/Async$/, '')}`,
  },
  {
    re: /\bfs\.promises\.exists\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: () => 'fs.promises.exists does not exist - use fs.promises.access inside a try/catch',
  },
  {
    re: /\bpath\.exists\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: () => 'path.exists was removed in Node 0.8 - use fs.existsSync',
  },
  {
    re: /\bprocess\.env\.get\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: () => 'process.env is a plain object - index it, do not call .get()',
  },
  {
    re: /\bcrypto\.(uuid|randomUuid|uuidv4)\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: (m) => `crypto.${m[1]} does not exist - the real method is crypto.randomUUID`,
  },
  {
    re: /\bNumber\.parse\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: () => 'Number.parse does not exist - use Number(), parseInt or parseFloat',
  },
  {
    re: /\bString\.format\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: () => 'String.format does not exist in JavaScript - use a template literal',
  },
  {
    re: /\bconsole\.(print|write|writeline)\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: (m) => `console.${m[1]} does not exist - console.log is the one you want`,
  },
  {
    re: /\bdocument\.getElementByClassName\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: () => 'the real method is getElementsByClassName (plural)',
  },
  {
    re: /\.(padLeft|padRight)\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: (m) => `.${m[1]} does not exist - use ${m[1] === 'padLeft' ? 'padStart' : 'padEnd'}`,
  },
  {
    re: /\.(lstrip|rstrip)\s*\(/,
    family: 'crossbreed', severity: 'high',
    message: (m) => `.${m[1]} is Python - JavaScript has trimStart and trimEnd`,
  },
  {
    re: /\.strip\s*\(\s*\)/,
    family: 'crossbreed', severity: 'high',
    message: () => '.strip() is Python - JavaScript has .trim()',
  },
  {
    re: /\.push_back\s*\(/,
    family: 'crossbreed', severity: 'high',
    message: () => '.push_back is C++ - JavaScript arrays use .push',
  },
  {
    re: /\.(capitalize|upper|lower)\s*\(\s*\)/,
    family: 'crossbreed', severity: 'medium',
    message: (m) => `.${m[1]}() is a Python string method`,
  },
  {
    re: /\bPromise\.(delay|sleep|series|fromCallback)\s*\(/,
    family: 'phantom-api', severity: 'high',
    message: (m) => `Promise.${m[1]} is a Bluebird method, not a standard one`,
    skipIf: (ctx, file) => fileImports(file).has('bluebird'),
  },
  {
    re: /\.flatten\s*\(/,
    family: 'phantom-api', severity: 'medium',
    message: () => '.flatten() does not exist on arrays - the standard method is .flat()',
    skipIf: (ctx, file) => {
      const imports = fileImports(file);
      return imports.has('lodash') || imports.has('underscore') || imports.has('ramda');
    },
  },
  {
    re: /(^|[^.\w$])len\s*\(/,
    family: 'crossbreed', severity: 'high',
    message: () => 'len() is Python - JavaScript uses .length',
    skipIf: (ctx) => ctx.declaredNames.has('len'),
  },
  {
    re: /(^|[^.\w$])print\s*\(/,
    family: 'crossbreed', severity: 'medium',
    message: () => 'print() is Python - JavaScript uses console.log',
    skipIf: (ctx) => ctx.declaredNames.has('print'),
  },
  // Async callbacks handed to methods that have no idea what a promise is.
  {
    re: /\.forEach\s*\(\s*async\b/,
    family: 'lost-await', severity: 'high',
    message: () => 'forEach ignores the promise it gets back - the loop finishes before the work does',
  },
  {
    re: /\.(filter|some|every|find|findIndex)\s*\(\s*async\b/,
    family: 'lost-await', severity: 'high',
    message: (m) => `an async callback to .${m[1]} returns a promise, and a promise is always truthy`,
  },
  {
    re: /\.sort\s*\(\s*async\b/,
    family: 'lost-await', severity: 'high',
    message: () => 'an async comparator returns a promise, so the sort order is meaningless',
  },
  {
    re: /\bnew\s+Promise\s*\(\s*async\b/,
    family: 'lost-await', severity: 'high',
    message: () => 'an async executor swallows its own rejections - drop the wrapper',
  },
  // Recipes that were right once.
  {
    re: /\bnew\s+Buffer\s*\(/,
    family: 'stale-recipe', severity: 'medium',
    message: () => 'the Buffer constructor is deprecated - use Buffer.from or Buffer.alloc',
  },
  {
    re: /\bfs\.exists\s*\(/,
    family: 'stale-recipe', severity: 'medium',
    message: () => 'fs.exists is deprecated - use fs.existsSync or fs.access',
  },
  {
    re: /\butil\.isArray\s*\(/,
    family: 'stale-recipe', severity: 'low',
    message: () => 'util.isArray is deprecated - use Array.isArray',
  },
  {
    re: /\.substr\s*\(/,
    family: 'stale-recipe', severity: 'low',
    message: () => '.substr is a deprecated annex-B method - use .slice',
  },
];

// Arguments of the right type and the wrong shape.
const STRING_ARG_PATTERNS = [
  {
    before: /\bgetElementById\s*\(\s*$/,
    test: (value) => value.startsWith('#') || value.startsWith('.'),
    family: 'phantom-api', severity: 'high',
    message: (value) => `getElementById takes a bare id, not the selector "${value}"`,
  },
  {
    before: /\baddEventListener\s*\(\s*$/,
    test: (value) => /^on[a-z]/.test(value),
    family: 'phantom-api', severity: 'high',
    message: (value) => `addEventListener takes "${value.slice(2)}", not "${value}"`,
  },
];

const importCache = new WeakMap();

function fileImports(file) {
  if (!importCache.has(file)) {
    importCache.set(file, new Set(collectImports(file).map((i) => rootOf(i.spec))));
  }
  return importCache.get(file);
}

function run(ctx) {
  const findings = [];
  for (const file of ctx.files) {
    for (const pattern of PATTERNS) {
      if (pattern.skipIf && pattern.skipIf(ctx, file)) continue;
      for (const m of scan(file.masked, pattern.re)) {
        findings.push(finding(file, m.index, pattern.family, pattern.severity, pattern.message(m)));
      }
    }
    for (const str of file.strings) {
      const before = file.masked.slice(Math.max(0, str.start - 40), str.start);
      for (const pattern of STRING_ARG_PATTERNS) {
        if (!pattern.before.test(before)) continue;
        if (!pattern.test(str.value)) continue;
        findings.push(finding(file, str.start, pattern.family, pattern.severity, pattern.message(str.value)));
      }
    }
  }
  return findings;
}

module.exports = { run, PATTERNS };
