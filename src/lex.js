'use strict';

// A single-pass scanner that produces a "masked" copy of the source in which
// every string, template chunk, comment and regex literal has been blanked out
// (offsets and newlines preserved). Every rule in this tool matches against the
// masked text, so a phrase inside a string or a commented-out line can never be
// mistaken for real code.

const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

const PUNCT_BEFORE_REGEX = new Set([
  '', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-',
  '*', '%', '~', '^', '<', '>', '\n',
]);

function isIdentChar(c) {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

function makeLineLookup(starts) {
  return function lineOf(index) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based
  };
}

function lex(src) {
  const out = src.split('');
  const comments = [];
  const strings = [];
  const starts = lineStarts(src);
  const lineOf = makeLineLookup(starts);
  const n = src.length;
  const BACKSLASH = '\\';

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  // modes: a 'code' frame tracks brace depth so we can tell a `}` that closes a
  // block from one that closes a `${...}` hole inside a template literal.
  const modes = [{ type: 'code', brace: 0 }];
  let lastSig = '';
  let lastWord = '';
  let i = 0;

  while (i < n) {
    const mode = modes[modes.length - 1];

    if (mode.type === 'template') {
      if (src[i] === BACKSLASH) { blank(i, i + 2); i += 2; continue; }
      if (src[i] === '`') { modes.pop(); lastSig = 'x'; lastWord = ''; i++; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        modes.push({ type: 'code', brace: 0 });
        lastSig = '{';
        lastWord = '';
        i += 2;
        continue;
      }
      if (src[i] !== '\n') out[i] = ' ';
      i++;
      continue;
    }

    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {
      let end = src.indexOf('\n', i);
      if (end === -1) end = n;
      comments.push({ type: 'line', start: i, end, line: lineOf(i), text: src.slice(i + 2, end) });
      blank(i, end);
      i = end;
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      let end = src.indexOf('*/', i + 2);
      end = end === -1 ? n : end + 2;
      comments.push({
        type: 'block',
        start: i,
        end,
        line: lineOf(i),
        text: src.slice(i + 2, Math.max(i + 2, end - 2)),
      });
      blank(i, end);
      i = end;
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === BACKSLASH ? 2 : 1;
      const end = Math.min(j + 1, n);
      strings.push({ start: i, end, line: lineOf(i), value: src.slice(i + 1, j) });
      blank(i + 1, end - 1);
      lastSig = 'x';
      lastWord = '';
      i = end;
      continue;
    }

    if (c === '`') {
      modes.push({ type: 'template' });
      i++;
      continue;
    }

    if (c === '/' && (PUNCT_BEFORE_REGEX.has(lastSig) || KEYWORDS_BEFORE_REGEX.has(lastWord))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && src[j] !== '\n') {
        const d = src[j];
        if (d === BACKSLASH) { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        while (j + 1 < n && /[a-z]/.test(src[j + 1])) j++;
        blank(i, j + 1);
        lastSig = 'x';
        lastWord = '';
        i = j + 1;
        continue;
      }
    }

    if (c === '{') {
      mode.brace++;
    } else if (c === '}') {
      if (mode.brace === 0 && modes.length > 1) { modes.pop(); i++; lastSig = 'x'; continue; }
      if (mode.brace > 0) mode.brace--;
    }

    if (isIdentChar(c)) {
      let j = i;
      while (j < n && isIdentChar(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSig = 'x';
      i = j;
      continue;
    }

    if (c === '\n') lastWord = '';
    else if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i++;
  }

  // Same text with only the comments removed: rules that compare two bodies for
  // sameness need the string literals intact, which `masked` has thrown away.
  const bare = src.split('');
  for (const comment of comments) {
    for (let k = comment.start; k < comment.end; k++) if (bare[k] !== '\n') bare[k] = ' ';
  }

  return {
    src,
    masked: out.join(''),
    noComments: bare.join(''),
    comments,
    strings,
    lineOf,
    lineStarts: starts,
  };
}

// Text of one line from the original source, trimmed for display.
function lineText(file, line) {
  const start = file.lineStarts[line - 1];
  if (start === undefined) return '';
  const end = file.lineStarts[line] === undefined ? file.src.length : file.lineStarts[line] - 1;
  return file.src.slice(start, end).trim();
}

module.exports = { lex, isIdentChar, lineText };
