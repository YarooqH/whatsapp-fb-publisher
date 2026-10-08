import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getStorageDir } from './store.js';

export function saveDraft(text) {
  const draftsFile = join(getStorageDir(), 'drafts.json');
  let drafts = [];
  if (existsSync(draftsFile)) {
    try {
      drafts = JSON.parse(readFileSync(draftsFile, 'utf8'));
    } catch {
      /* first draft */
    }
  }
  drafts.push({ text, at: new Date().toISOString() });
  writeFileSync(draftsFile, JSON.stringify(drafts, null, 2));
  return drafts.length;
}
