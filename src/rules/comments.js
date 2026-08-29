'use strict';

const { finding, words } = require('../util.js');
const { functionsOf } = require('../decls.js');

// Text that only makes sense while the code is still being written.
const RESIDUE_COMMENT = [
  { re: /\.\.\.\s*(rest|the rest|existing|unchanged|same as|remainder)/i, why: 'a stand-in for code that was never pasted in' },
  { re: /\brest of (the )?(code|file|function|implementation|logic|method)\b/i, why: 'a stand-in for code that was never pasted in' },
  { re: /\b(your|add your|insert|implementation goes|code goes|logic goes)\s+(code\s+)?here\b/i, why: 'an unfilled blank' },
  { re: /\bTODO:?\s*(implement|add|fill|complete|write)\b/i, why: 'an unfinished section' },
  { re: /\bnot implemented\b/i, why: 'an unfinished section' },
  // Only a comment that *is* a placeholder marker - not prose that happens to
  // discuss placeholders.
  { re: /^[\s*-]*(placeholder|stub)\b/i, why: 'a placeholder that outlived the draft' },
  { re: /\b(placeholder|stub)\s+(value|text|data|content|for now|here)\b/i, why: 'a placeholder that outlived the draft' },
  { re: /\bin (a|the) real (app|application|world|implementation|project|system|scenario)\b/i, why: 'this code knows it is a demo' },
  { re: /\bfor (simplicity|brevity)[,:]?/i, why: 'this code knows it is incomplete' },
  { re: /\b(simplified|dummy|mock|fake)\s+(implementation|version|example|data)\b/i, why: 'this code knows it is a stand-in' },
];

const RESIDUE_STRING = [
  // Anchored: a string that *is* the placeholder, not prose that mentions one.
  { re: /^[<{("']*your[-_ ]?(api[-_ ]?key|secret|token|password|domain|username|email)([-_ ]?(here|goes[-_ ]?here))?[>})"']*$/i, severity: 'high' },
  { re: /^(YOUR|MY)_[A-Z0-9_]+$/, severity: 'high' },
  // Only angle brackets that name what belongs there - not every HTML tag in a
  // template string.
  { re: /^<(your|my|insert|api|token|key|secret|username|password|domain|host|port|email|name)\b[^>]*>$/i, severity: 'high' },
  { re: /path[\/\\]to[\/\\]your/i, severity: 'high' },
  { re: /^(changeme|change-me|todo|tbd|xxx+)$/i, severity: 'high' },
  { re: /^INSERT_[A-Z0-9_]+$/, severity: 'high' },
  { re: /^sk-(xxx|your|test123)/i, severity: 'high' },
  { re: /^not implemented$/i, severity: 'medium' },
  { re: /^(foo|bar|baz|lorem ipsum)$/i, severity: 'low' },
];

// Sentences addressed to whoever asked for the code, left in the code.
const VOICE = [
  { re: /\b(as requested|as you can see|hope this helps|let me know if|feel free to (ask|modify|adjust)|here is (the|how|a))\b/i, why: 'written to a person in a chat, not to a reader of this file' },
  { re: /\bnote(:| that) this is (a |an )?(simplified|basic|minimal|naive)/i, why: 'a caveat aimed at a reader who is not here' },
  { re: /\b(blazing[- ]fast|production[- ]ready|enterprise[- ]grade|state[- ]of[- ]the[- ]art|cutting[- ]edge|best[- ]in[- ]class|seamlessly integrat)/i, why: 'marketing copy inside a source file' },
  { re: /\byou (can|should|might want to|may want to) (now|then)?\s*(run|use|call|modify|adjust|replace)/i, why: 'instructions to a reader, not documentation of the code' },
];

const EMOJI = /\p{Extended_Pictographic}/u;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'this', 'that', 'it', 'is',
  'are', 'be', 'we', 'our', 'in', 'on', 'at', 'with', 'from', 'by', 'then',
  'now', 'if', 'all', 'each', 'its', 'into', 'as', 'so', 'up', 'do', 'does',
  'here', 'there', 'when', 'will', 'not', 'no', 'yes', 'via', 'per',
]);

// Operators and keywords carry meaning that a restating comment spells out in
// words - without this map, "// increment the counter" over `counter++` reads
// as a comment that says something new.
const CONCEPTS = [
  { re: /\+\+/, words: ['increment', 'increase', 'bump'] },
  { re: /--/, words: ['decrement', 'decrease'] },
  { re: /\+=/, words: ['add', 'increment', 'append'] },
  { re: /-=/, words: ['subtract', 'decrement'] },
  { re: /\b(for|while)\b|\.forEach\(/, words: ['loop', 'iterate', 'iterating', 'each', 'through', 'over'] },
  { re: /\breturn\b/, words: ['return', 'returns'] },
  { re: /\bif\b/, words: ['check', 'if', 'whether'] },
  { re: /\bnew\b/, words: ['create', 'creates', 'make', 'new', 'instantiate'] },
  { re: /\.push\(/, words: ['add', 'adds', 'append', 'store', 'collect'] },
  { re: /console\.(log|error|warn)/, words: ['log', 'print', 'output', 'display'] },
  { re: /\bcatch\b/, words: ['catch', 'handle', 'error', 'errors'] },
  { re: /\.map\(/, words: ['map', 'transform', 'convert'] },
  { re: /\.filter\(/, words: ['filter', 'keep', 'remove'] },
  { re: /\b(require|import)\b/, words: ['import', 'require', 'load', 'pull'] },
  { re: /=[^=]/, words: ['set', 'assign', 'store', 'save'] },
];

function contentWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function conceptsOf(codeLine) {
  const set = new Set();
  for (const concept of CONCEPTS) {
    if (concept.re.test(codeLine)) for (const w of concept.words) set.add(w);
  }
  for (const m of codeLine.matchAll(/[A-Za-z_$][\w$]*/g)) {
    for (const w of words(m[0])) set.add(w);
  }
  return set;
}

function nextCodeLine(file, afterLine) {
  for (let line = afterLine + 1; line <= file.lineStarts.length; line++) {
    const start = file.lineStarts[line - 1];
    if (start === undefined) break;
    const end = file.lineStarts[line] === undefined ? file.masked.length : file.lineStarts[line] - 1;
    const text = file.masked.slice(start, end).trim();
    if (text) return text;
  }
  return '';
}

function stem(word) {
  return word.replace(/(ing|es|ed|s)$/, '');
}

function isEcho(comment, codeLine) {
  const commentWords = contentWords(comment);
  if (commentWords.length < 2 || commentWords.length > 8) return false;
  const concepts = new Set([...conceptsOf(codeLine)].map(stem));
  const hits = commentWords.filter((w) => concepts.has(stem(w))).length;
  const ratio = hits / commentWords.length;
  return commentWords.length <= 3 ? ratio === 1 : ratio >= 0.75;
}

// True when nothing but whitespace precedes the comment on its line.
function ownLine(file, comment) {
  const start = file.lineStarts[comment.line - 1];
  return start !== undefined && !/\S/.test(file.src.slice(start, comment.start));
}

// A wrapped `//` comment is one comment, not several. Consecutive own-line
// comments are joined before any rule looks at them, so a word that happens to
// land at the start of a continuation line cannot read like the start of the
// comment - which is how "handing over a / placeholder instead of the file"
// used to trip the scaffold-residue check.
function commentBlocks(file) {
  const blocks = [];
  let current = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const comment of file.comments) {
    if (comment.type !== 'line' || !ownLine(file, comment)) {
      flush();
      blocks.push({ ...comment, lastLine: comment.line, wrapped: false });
      continue;
    }
    if (current && comment.line === current.lastLine + 1) {
      current.text = current.text.trim() + ' ' + comment.text.trim();
      current.lastLine = comment.line;
      current.wrapped = true;
      continue;
    }
    flush();
    current = { ...comment, lastLine: comment.line, wrapped: false };
  }
  flush();
  return blocks;
}

function docFor(file, fn) {
  let best = null;
  for (const comment of file.comments) {
    if (comment.type !== 'block') continue;
    if (comment.end > fn.index) continue;
    const between = file.src.slice(comment.end, fn.index);
    if (/[^\s]/.test(between.replace(/^(export\s+|default\s+|async\s+|module\.exports\s*=\s*)*/, ''))) continue;
    if (!best || comment.end > best.end) best = comment;
  }
  return best;
}

function run(ctx) {
  const findings = [];

  for (const file of ctx.files) {
    for (const comment of commentBlocks(file)) {
      const text = comment.text;

      for (const rule of RESIDUE_COMMENT) {
        if (rule.re.test(text)) {
          findings.push(finding(file, comment.start, 'scaffold-residue', 'medium',
            rule.why, { evidence: text.trim().slice(0, 100) }));
          break;
        }
      }

      let voiced = false;
      for (const rule of VOICE) {
        if (rule.re.test(text)) {
          findings.push(finding(file, comment.start, 'ai-voice', 'low', rule.why,
            { evidence: text.trim().slice(0, 100) }));
          voiced = true;
          break;
        }
      }
      if (!voiced && EMOJI.test(text)) {
        findings.push(finding(file, comment.start, 'ai-voice', 'low',
          'an emoji in a source comment', { evidence: text.trim().slice(0, 100) }));
      }

      // Only an unwrapped one-liner can restate the line beneath it.
      if (comment.type === 'line' && !comment.wrapped && !file.isTest) {
        const code = nextCodeLine(file, comment.line);
        if (code && isEcho(text, code)) {
          findings.push(finding(file, comment.start, 'echo-comment', 'low',
            'says what the next line already says', { evidence: text.trim().slice(0, 80) }));
        }
      }
    }

    for (const str of file.strings) {
      for (const rule of RESIDUE_STRING) {
        if (rule.re.test(str.value)) {
          findings.push(finding(file, str.start, 'scaffold-residue', rule.severity,
            `"${str.value.slice(0, 60)}" is placeholder text`));
          break;
        }
      }
    }

    // Doc comments that describe a different function than the one below them.
    for (const fn of functionsOf(file)) {
      const doc = docFor(file, fn);
      if (!doc || !/^\*/.test(doc.text)) continue;
      const documented = [...doc.text.matchAll(/@param\s+(?:\{[^}]*\}\s*)?\[?([A-Za-z_$][\w$.]*)/g)]
        .map((m) => m[1])
        .filter((name) => !name.includes('.'));
      const actual = new Set(fn.params);
      const ghosts = documented.filter((name) => !actual.has(name));
      if (ghosts.length) {
        findings.push(finding(file, doc.start, 'stale-doc', 'medium',
          `documents ${ghosts.map((g) => `"${g}"`).join(', ')}, which ${ghosts.length > 1 ? 'are' : 'is'} not a parameter of ${fn.name}(${fn.params.join(', ')})`,
          { evidence: `@param ${ghosts[0]}` }));
      }
      if (/@returns?\b(?!\s*\{?\s*(void|undefined))/.test(doc.text) && fn.blockBodied
        && !/\breturn\s+[^;\s]/.test(fn.body)) {
        findings.push(finding(file, doc.start, 'stale-doc', 'medium',
          `documents a return value, but ${fn.name} never returns one`,
          { evidence: '@returns' }));
      }
    }
  }

  return findings;
}

module.exports = { run, isEcho, commentBlocks };
