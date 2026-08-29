'use strict';

// Every finding belongs to exactly one family. The point of the tool is not
// "line 42 is bad" but "line 42 is *this kind of* bad" - the same way a virus
// scanner names the family rather than saying "suspicious".

const FAMILIES = {
  'phantom-import': {
    label: 'Phantom import',
    blurb: 'Pulls in a module the project does not have and could not resolve at runtime.',
    hint: 'Install it, or replace the call with something that exists.',
  },
  'phantom-api': {
    label: 'Phantom API',
    blurb: 'Calls a method that does not exist on that object - a plausible name, not a real one.',
    hint: 'Check the real API surface; the intended method is usually a near neighbour.',
  },
  crossbreed: {
    label: 'Crossbreed',
    blurb: 'An idiom from another language wearing JavaScript syntax.',
    hint: 'Translate it to the JavaScript equivalent.',
  },
  'stale-recipe': {
    label: 'Stale recipe',
    blurb: 'A pattern that was correct years ago and is now redundant or discouraged.',
    hint: 'The modern runtime does this natively.',
  },
  'lost-await': {
    label: 'Lost await',
    blurb: 'An awaited call whose result nothing waits for - the surrounding code races past it.',
    hint: 'Use a for..of loop, or collect the promises and await Promise.all.',
  },
  'dead-guard': {
    label: 'Dead guard',
    blurb: 'A defensive check on a value that cannot possibly be in the guarded state.',
    hint: 'Remove the branch, or fix the value it was meant to protect.',
  },
  'mute-catch': {
    label: 'Mute catch',
    blurb: 'An error is caught and then dropped without a trace.',
    hint: 'Log it, re-throw it, or say in a comment why swallowing is correct.',
  },
  'scaffold-residue': {
    label: 'Scaffold residue',
    blurb: 'Placeholder text that was meant to be replaced before this shipped.',
    hint: 'Finish the section or delete it.',
  },
  'stale-doc': {
    label: 'Stale doc',
    blurb: 'The doc comment describes a function that is not the one below it.',
    hint: 'Re-read the signature and rewrite the block.',
  },
  'echo-comment': {
    label: 'Echo comment',
    blurb: 'A comment that restates the line under it and carries no information.',
    hint: 'Delete it, or replace it with the reason the line exists.',
  },
  'ai-voice': {
    label: 'Assistant voice',
    blurb: 'Narration written for a reader of a chat transcript, not for a reader of the codebase.',
    hint: 'Cut it - the repository is not the conversation it came from.',
  },
  orphan: {
    label: 'Orphan',
    blurb: 'Defined once and referenced nowhere in the project.',
    hint: 'Delete it, or wire it up to whatever was supposed to call it.',
  },
  twin: {
    label: 'Twin',
    blurb: 'The same helper implemented more than once, in more than one place.',
    hint: 'Keep one, import it from the other site.',
  },
  barnacle: {
    label: 'Barnacle',
    blurb: 'A declared runtime dependency that nothing in the project imports.',
    hint: 'Drop it from package.json.',
  },
};

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };

function severityOf(finding) {
  return SEVERITY_ORDER[finding.severity] || 1;
}

module.exports = { FAMILIES, SEVERITY_ORDER, severityOf };
