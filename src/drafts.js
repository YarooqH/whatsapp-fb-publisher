import { readFileSync, writeFileSync } from 'node:fs';

const DRAFTS_FILE = new URL('../drafts.json', import.meta.url);

export function saveDraft(text) {
  let drafts = [];
  try {
    drafts = JSON.parse(readFileSync(DRAFTS_FILE, 'utf8'));
  } catch {
    /* first draft */
  }
  drafts.push({ text, at: new Date().toISOString() });
  writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
  return drafts.length;
}
