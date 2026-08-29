'use strict';

// Deliberately full of shapes that a careless scanner mistakes for tells: a
// regex holding a slash, strings holding the word TODO, a template literal
// spanning lines, a catch that does something, and docs that match reality.

const fs = require('fs');
const path = require('path');

const ROUTE = /^\/api\/(users|posts)\/(\d+)$/;
const NOTE = 'TODO: this string is data, not a comment';
const PLACEHOLDER_DOC = 'pass your-api-key in the Authorization header';

/**
 * Reads a JSON file and returns its parsed contents.
 * @param {string} file - absolute path to the file
 * @param {*} fallback - returned when the file is missing or malformed
 * @returns {*} the parsed value, or the fallback
 */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    process.emitWarning(`could not read ${path.basename(file)}: ${err.message}`);
    return fallback;
  }
}

function routeOf(url) {
  const match = ROUTE.exec(url);
  if (!match) return null;
  return { kind: match[1], id: Number(match[2]) };
}

// Halves the width until the label fits, which is not what the next line says.
function fit(label, width) {
  let room = width;
  while (label.length > room && room > 4) room = Math.floor(room / 2);
  return label.slice(0, room);
}

async function loadAll(ids, read) {
  const rows = [];
  for (const id of ids) {
    rows.push(await read(id));
  }
  return rows;
}

function describe(counts) {
  const lines = Object.entries(counts).map(([key, value]) => `  ${key}: ${value}`);
  return [`${NOTE.length} bytes`, ...lines, PLACEHOLDER_DOC].join('\n');
}


// A source file that copies as zero bytes is the sync client handing over a
// placeholder instead of the real file, which is worth refusing to ship.
function guardAgainstEmptyCopies(size) {
  return size > 0;
}

module.exports = { readJson, routeOf, fit, loadAll, describe, guardAgainstEmptyCopies };
