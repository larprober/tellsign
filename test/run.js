'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { scan, globToRegExp } = require('../src/scan.js');
const { lex } = require('../src/lex.js');
const { isEcho, commentBlocks } = require('../src/rules/comments.js');
const { FAMILIES } = require('../src/families.js');

const CLI = path.join(__dirname, '..', 'bin', 'tellsign.js');
const SLOP = path.join(__dirname, 'fixtures', 'slop');
const CLEAN = path.join(__dirname, 'fixtures', 'clean');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ok    ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  FAIL  ${name}\n        ${err.message}\n`);
  }
}

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '' };
  }
}

process.stdout.write('\nlexer\n');

test('masks string contents but keeps the quotes', () => {
  const { masked } = lex('const a = "hidden";');
  assert.ok(!masked.includes('hidden'));
  assert.strictEqual(masked.length, 'const a = "hidden";'.length);
  assert.ok(masked.includes('"'));
});

test('a comment marker inside a string is not a comment', () => {
  const { comments } = lex('const a = "// not a comment";');
  assert.strictEqual(comments.length, 0);
});

test('a string marker inside a comment is not a string', () => {
  const { strings } = lex('// it is a "quote" in a comment');
  assert.strictEqual(strings.length, 0);
});

test('a regex holding a slash is masked whole', () => {
  const { masked } = lex('const r = /a[/]b/g; const d = 6 / 2;');
  assert.ok(!masked.includes('a['));
  assert.ok(masked.includes('6 / 2'));
});

test('code inside a template hole stays visible', () => {
  const { masked } = lex('const t = `x ${ total + 1 } y`;');
  assert.ok(masked.includes('total + 1'));
  assert.ok(!masked.includes('x '));
});

test('an escaped quote does not end the string', () => {
  const backslash = String.fromCharCode(92);
  const { strings } = lex(`const s = 'it${backslash}'s fine'; after();`);
  assert.strictEqual(strings.length, 1);
  assert.ok(strings[0].value.includes('s fine'));
});

test('line numbers are 1-based and correct', () => {
  const file = lex('a\nb\nc');
  assert.strictEqual(file.lineOf(0), 1);
  assert.strictEqual(file.lineOf(2), 2);
  assert.strictEqual(file.lineOf(4), 3);
});

process.stdout.write('\necho detection\n');

test('a comment restating the next line is an echo', () => {
  assert.ok(isEcho(' Increment the counter', 'counter++;'));
});

test('a comment adding a reason is not an echo', () => {
  assert.ok(!isEcho(' Retry once because the upstream cache is cold', 'counter++;'));
});

test('a one-word comment is never an echo', () => {
  assert.ok(!isEcho(' setup', 'setup();'));
});

process.stdout.write('\nignore patterns\n');

test('a bare directory name matches everything under it', () => {
  const re = globToRegExp('test/fixtures');
  assert.ok(re.test('test/fixtures/slop/src/api.js'));
  assert.ok(!re.test('test/run.js'));
});

test('* stops at a slash and ** crosses them', () => {
  assert.ok(globToRegExp('src/*.js').test('src/lex.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/rules/apis.js'));
  assert.ok(globToRegExp('**/generated').test('a/b/generated/out.js'));
});

test('a dot in a pattern is a literal dot', () => {
  const re = globToRegExp('build.min');
  assert.ok(re.test('build.min/app.js'));
  assert.ok(!re.test('buildxmin/app.js'));
});

process.stdout.write('\ncomment blocks\n');

test('consecutive line comments are joined into one', () => {
  const file = lex('// handing over a\n// placeholder instead of the file\nrun();');
  const blocks = commentBlocks(file);
  assert.strictEqual(blocks.length, 1);
  assert.ok(blocks[0].text.includes('handing over a placeholder instead'));
  assert.strictEqual(blocks[0].wrapped, true);
});

test('a comment trailing code is its own block', () => {
  const file = lex('run(); // one\n// two');
  assert.strictEqual(commentBlocks(file).length, 2);
});

test('a wrapped comment does not read as a placeholder marker', () => {
  const wrapped = scan(path.join(__dirname, 'fixtures', 'clean'));
  assert.ok(!wrapped.findings.some((f) => f.family === 'scaffold-residue'));
});

test('a dependency wired in by app.json is not a barnacle', () => {
  const result = scan(path.join(__dirname, 'fixtures', 'config-dep'));
  const barnacles = result.findings.filter((f) => f.family === 'barnacle').map((f) => f.message);
  assert.ok(barnacles.some((m) => m.includes('never-mentioned-anywhere')));
  assert.ok(!barnacles.some((m) => m.includes('expo-splash-screen')));
});

process.stdout.write('\nfixtures\n');

const slop = scan(SLOP);
const clean = scan(CLEAN);

test('the clean fixture reports nothing', () => {
  assert.deepStrictEqual(clean.findings.map((f) => `${f.file}:${f.line} ${f.family}`), []);
});

test('every family fires on the slop fixture', () => {
  const seen = new Set(slop.findings.map((f) => f.family));
  const missing = Object.keys(FAMILIES).filter((family) => !seen.has(family));
  assert.deepStrictEqual(missing, [], `families that never fired: ${missing.join(', ')}`);
});

test('a missing package is caught, an installed one is not', () => {
  const specs = slop.findings.filter((f) => f.family === 'phantom-import').map((f) => f.message);
  assert.ok(specs.some((m) => m.includes('super-validator-pro')));
  assert.ok(specs.some((m) => m.includes('./crypto-helpers')));
  assert.ok(!specs.some((m) => m.includes('express')));
});

test('findings come back sorted by file and line', () => {
  const keys = slop.findings.map((f) => `${f.file}:${String(f.line).padStart(5, '0')}`);
  assert.deepStrictEqual(keys, [...keys].sort());
});

test('--min medium drops the low findings', () => {
  const medium = scan(SLOP, { min: 'medium' });
  assert.ok(medium.findings.length < slop.findings.length);
  assert.ok(!medium.findings.some((f) => f.severity === 'low'));
});

test('--only keeps a single family', () => {
  const only = scan(SLOP, { only: ['lost-await'] });
  assert.ok(only.findings.length > 0);
  assert.ok(only.findings.every((f) => f.family === 'lost-await'));
});

test('--ignore removes a family', () => {
  const without = scan(SLOP, { ignore: ['crossbreed'] });
  assert.ok(!without.findings.some((f) => f.family === 'crossbreed'));
});

test('every finding carries a family the tool documents', () => {
  for (const f of slop.findings) {
    assert.ok(FAMILIES[f.family], `undocumented family: ${f.family}`);
    assert.ok(['high', 'medium', 'low'].includes(f.severity), `odd severity: ${f.severity}`);
    assert.ok(f.message && f.file, 'finding is missing message or file');
  }
});

process.stdout.write('\ncli\n');

test('exits 1 when a high finding is present', () => {
  assert.strictEqual(run([SLOP, '--no-color']).code, 1);
});

test('exits 0 on clean code', () => {
  assert.strictEqual(run([CLEAN, '--no-color']).code, 0);
});

test('--fail-on none always exits 0', () => {
  assert.strictEqual(run([SLOP, '--no-color', '--fail-on', 'none']).code, 0);
});

test('--json emits parseable output', () => {
  const { stdout } = run([SLOP, '--json', '--fail-on', 'none']);
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.total > 0);
  assert.ok(Array.isArray(parsed.findings));
  assert.ok(parsed.dominant);
});

test('--list documents every family', () => {
  const { stdout } = run(['--list', '--no-color']);
  for (const id of Object.keys(FAMILIES)) assert.ok(stdout.includes(id), `missing ${id}`);
});

test('an unknown family is rejected', () => {
  assert.strictEqual(run([SLOP, '--only', 'nonsense']).code, 2);
});

test('--help exits 0', () => {
  assert.strictEqual(run(['--help']).code, 0);
});

test('scanning tellsign itself reports zero findings', () => {
  const { stdout } = run([path.join(__dirname, '..'), '--json', '--fail-on', 'none']);
  const parsed = JSON.parse(stdout);
  const listed = parsed.findings.map((f) => `${f.file}:${f.line} ${f.family} - ${f.message}`);
  assert.deepStrictEqual(listed, []);
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n\n`);
process.exitCode = failed ? 1 : 0;
