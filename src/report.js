'use strict';

const path = require('path');
const { FAMILIES } = require('./families.js');

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  magenta: '\u001b[35m',
  grey: '\u001b[90m',
};

function painter(enabled) {
  return function paint(code, text) {
    if (!enabled) return text;
    return ANSI[code] + text + ANSI.reset;
  };
}

const SEVERITY_COLOR = { high: 'red', medium: 'yellow', low: 'grey' };

function widthOf() {
  const columns = process.stdout && process.stdout.columns;
  return Math.max(60, Math.min(columns || 100, 140));
}

function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + '…';
}

function render(result, options = {}) {
  const paint = painter(options.color !== false);
  const width = widthOf();
  const lines = [];
  const name = path.basename(result.root) || result.root;

  lines.push('');
  lines.push(`  ${paint('bold', 'tellsign')}  ${paint('grey', '·')}  ${name}  ${paint('grey', '·')}  ${paint('grey', result.fileCount + ' file' + (result.fileCount === 1 ? '' : 's'))}`);
  lines.push('');

  if (!result.findings.length) {
    lines.push(`  ${paint('green', 'No tells found.')}`);
    lines.push('');
    return lines.join('\n');
  }

  if (!options.quiet) {
    let currentFile = null;
    for (const f of result.findings) {
      if (f.file !== currentFile) {
        currentFile = f.file;
        lines.push(`  ${paint('bold', currentFile)}`);
      }
      const where = String(f.line || '-').padStart(4);
      const severity = paint(SEVERITY_COLOR[f.severity], f.severity.padEnd(6));
      const family = paint('cyan', f.family.padEnd(16));
      const room = width - 34;
      lines.push(`  ${paint('grey', where)}  ${severity}  ${family}  ${truncate(f.message, room)}`);
      if (f.evidence) {
        lines.push(`        ${paint('grey', truncate(f.evidence, width - 10))}`);
      }
    }
    lines.push('');
  }

  const { summary } = result;
  const counts = [];
  for (const level of ['high', 'medium', 'low']) {
    if (summary.bySeverity[level]) {
      counts.push(paint(SEVERITY_COLOR[level], `${summary.bySeverity[level]} ${level}`));
    }
  }
  lines.push(`  ${paint('bold', summary.total + ' tell' + (summary.total === 1 ? '' : 's'))}  ${paint('grey', '·')}  ${counts.join(paint('grey', '  ·  '))}`);
  lines.push('');

  const longest = Math.max(...summary.byFamily.map(([family]) => family.length));
  const top = summary.byFamily[0][1];
  for (const [family, count] of summary.byFamily) {
    const bar = '█'.repeat(Math.max(1, Math.round((count / top) * 18)));
    lines.push(`  ${family.padEnd(longest)}  ${paint('magenta', bar)} ${paint('grey', String(count))}`);
  }
  lines.push('');

  const dominant = FAMILIES[summary.dominant];
  if (dominant) {
    lines.push(`  ${paint('bold', dominant.label)} — ${dominant.blurb}`);
    lines.push(`  ${paint('grey', dominant.hint)}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderFamilies(options = {}) {
  const paint = painter(options.color !== false);
  const lines = [''];
  for (const [id, family] of Object.entries(FAMILIES)) {
    lines.push(`  ${paint('cyan', id)}`);
    lines.push(`    ${family.blurb}`);
    lines.push(`    ${paint('grey', family.hint)}`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { render, renderFamilies };
