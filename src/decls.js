'use strict';

const { scan, matchingBrace } = require('./util.js');

function matchingParen(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitParams(text) {
  const names = [];
  let depth = 0;
  let current = '';
  const push = () => {
    const raw = current.trim();
    current = '';
    if (!raw) return;
    const bare = raw.replace(/=.*$/s, '').trim();
    if (/^[{[]/.test(bare)) {
      for (const m of bare.matchAll(/([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?/g)) {
        names.push(m[2] || m[1]);
      }
      return;
    }
    const name = bare.replace(/^\.\.\./, '').replace(/:.*$/s, '').trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
  };
  for (const ch of text) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { push(); continue; }
    current += ch;
  }
  push();
  return names;
}

// Named functions declared at any level, with their parameter list and body
// range. Deliberately syntactic: it finds the shapes people (and assistants)
// actually write, and skips anything it cannot read confidently.
function functionsOf(file) {
  const masked = file.masked;
  const results = [];
  const seen = new Set();

  const patterns = [
    { re: /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, form: 'function' },
    { re: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*)?\(/, form: 'assigned' },
  ];

  for (const { re, form } of patterns) {
    for (const m of scan(masked, re)) {
      const open = masked.indexOf('(', m.index + m[0].length - 1);
      if (open === -1) continue;
      const close = matchingParen(masked, open);
      if (close === -1) continue;
      if (seen.has(open)) continue;
      seen.add(open);

      let cursor = close + 1;
      while (cursor < masked.length && /\s/.test(masked[cursor])) cursor++;
      if (masked.startsWith('=>', cursor)) {
        cursor += 2;
        while (cursor < masked.length && /\s/.test(masked[cursor])) cursor++;
      }
      const hasBlock = masked[cursor] === '{';
      const bodyStart = hasBlock ? cursor : close + 1;
      const bodyEnd = hasBlock ? matchingBrace(masked, cursor) : lineEnd(masked, close);
      if (bodyEnd === -1) continue;

      results.push({
        name: m[1],
        form,
        index: m.index,
        line: file.lineOf(m.index),
        params: splitParams(file.src.slice(open + 1, close)),
        bodyStart,
        bodyEnd,
        body: masked.slice(bodyStart, bodyEnd + 1),
        blockBodied: hasBlock,
      });
    }
  }

  return results.sort((a, b) => a.index - b.index);
}

function lineEnd(text, from) {
  const idx = text.indexOf('\n', from);
  return idx === -1 ? text.length - 1 : idx;
}

// Every name the project binds somewhere, used to avoid flagging a call to a
// helper the project defines itself.
function declaredNames(files) {
  const names = new Set();
  for (const file of files) {
    for (const m of scan(file.masked, /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/)) names.add(m[1]);
    for (const m of scan(file.masked, /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/)) names.add(m[1]);
    for (const m of scan(file.masked, /\b(?:const|let|var)\s*\{([^}]*)\}/)) {
      for (const name of splitParams(m[1])) names.add(name);
    }
    for (const m of scan(file.masked, /\bimport\s+([A-Za-z_$][\w$]*)/)) names.add(m[1]);
  }
  return names;
}

module.exports = { functionsOf, declaredNames, splitParams, matchingParen };
