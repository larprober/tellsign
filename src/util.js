'use strict';

const { lineText } = require('./lex.js');

// Strings are blanked in the masked text, so rules that need a literal's value
// (an import specifier, a placeholder key) ask for the string that starts at a
// given offset instead of re-parsing it.
function stringStartingAt(file, index) {
  const skipped = skipSpace(file.masked, index);
  for (const str of file.strings) {
    if (str.start === skipped) return str;
  }
  return null;
}

function skipSpace(text, index) {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

// Index of the brace that closes the one at `open`, or -1.
function matchingBrace(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function* scan(masked, regex) {
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  let m;
  while ((m = re.exec(masked)) !== null) {
    yield m;
    if (m[0].length === 0) re.lastIndex++;
  }
}

function finding(file, index, family, severity, message, extra = {}) {
  const line = file.lineOf(index);
  return {
    family,
    severity,
    message,
    file: file.rel,
    line,
    evidence: extra.evidence !== undefined ? extra.evidence : lineText(file, line),
    ...extra,
  };
}

// "parseConfigFile" -> ["parse", "config", "file"]
function words(identifier) {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

module.exports = { stringStartingAt, skipSpace, matchingBrace, scan, finding, words };
