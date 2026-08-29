#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { scan } = require('../src/scan.js');
const { render, renderFamilies } = require('../src/report.js');
const { FAMILIES, SEVERITY_ORDER } = require('../src/families.js');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

const HELP = `
  tellsign - names the tell in machine-written JavaScript

  Usage
    tellsign [path] [options]

  Options
    --json              machine-readable output
    --quiet             summary only, no per-finding lines
    --only <families>   comma-separated families to keep
    --ignore <families> comma-separated families to drop
    --min <severity>    low | medium | high        (default: low)
    --fail-on <sev>     exit 1 at or above this    (default: high, "none" to disable)
    --list              print every family and what it means
    --no-color          plain output
    -h, --help          this text
    -v, --version       version

  Examples
    tellsign
    tellsign ./src --min medium
    tellsign --only phantom-import,lost-await --fail-on medium
    tellsign . --json > tells.json
`;

function parseArgs(argv) {
  const args = {
    target: null,
    json: false,
    quiet: false,
    color: process.env.NO_COLOR === undefined && process.stdout.isTTY !== false,
    only: [],
    ignore: [],
    min: 'low',
    failOn: 'high',
    help: false,
    version: false,
    list: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--json': args.json = true; break;
      case '--quiet': case '-q': args.quiet = true; break;
      case '--no-color': args.color = false; break;
      case '--color': args.color = true; break;
      case '--only': args.only = String(next() || '').split(',').filter(Boolean); break;
      case '--ignore': args.ignore = String(next() || '').split(',').filter(Boolean); break;
      case '--min': args.min = String(next() || 'low'); break;
      case '--fail-on': args.failOn = String(next() || 'high'); break;
      case '--list': args.list = true; break;
      case '-h': case '--help': args.help = true; break;
      case '-v': case '--version': args.version = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
        if (args.target === null) args.target = arg;
        else throw new Error('only one path can be scanned at a time');
    }
  }

  args.target = args.target || '.';
  return args;
}

function validate(args) {
  const names = Object.keys(FAMILIES);
  for (const family of [...args.only, ...args.ignore]) {
    if (!names.includes(family)) {
      throw new Error(`unknown family "${family}" - run tellsign --list to see them all`);
    }
  }
  if (!['low', 'medium', 'high'].includes(args.min)) {
    throw new Error(`--min takes low, medium or high (got "${args.min}")`);
  }
  if (!['low', 'medium', 'high', 'none'].includes(args.failOn)) {
    throw new Error(`--fail-on takes low, medium, high or none (got "${args.failOn}")`);
  }
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
    validate(args);
  } catch (err) {
    process.stderr.write(`tellsign: ${err.message}\n`);
    return 2;
  }

  if (args.help) { process.stdout.write(HELP); return 0; }
  if (args.version) { process.stdout.write(`${pkg.version}\n`); return 0; }
  if (args.list) { process.stdout.write(renderFamilies({ color: args.color })); return 0; }

  if (!fs.existsSync(args.target)) {
    process.stderr.write(`tellsign: ${args.target} does not exist\n`);
    return 2;
  }

  const result = scan(args.target, {
    min: args.min,
    only: args.only,
    ignore: args.ignore,
  });

  if (args.json) {
    process.stdout.write(JSON.stringify({
      root: result.root,
      files: result.fileCount,
      total: result.summary.total,
      bySeverity: result.summary.bySeverity,
      byFamily: Object.fromEntries(result.summary.byFamily),
      dominant: result.summary.dominant,
      findings: result.findings,
    }, null, 2) + '\n');
  } else {
    process.stdout.write(render(result, { color: args.color, quiet: args.quiet }) + '\n');
  }

  if (args.failOn === 'none') return 0;
  const threshold = SEVERITY_ORDER[args.failOn];
  const tripped = result.findings.some((f) => SEVERITY_ORDER[f.severity] >= threshold);
  return tripped ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
