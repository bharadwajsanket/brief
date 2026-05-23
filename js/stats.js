/*
 * CleanCopy Pro — stats.js
 * Tracks cleaned URL count in session storage.
 * No persistent telemetry. Session-only. Resets on browser restart.
 */

const SESSION_KEY = 'ccStats';

export async function getStats() {
  try {
    const data = await chrome.storage.session.get(SESSION_KEY);
    return data[SESSION_KEY] ?? { cleaned: 0, redirects: 0, amp: 0 };
  } catch {
    return { cleaned: 0, redirects: 0, amp: 0 };
  }
}

export async function incrementStat(key) {
  try {
    const stats = await getStats();
    stats[key] = (stats[key] ?? 0) + 1;
    await chrome.storage.session.set({ [SESSION_KEY]: stats });
  } catch {}
}

export async function bumpCleaned()   { return incrementStat('cleaned'); }
export async function bumpRedirects() { return incrementStat('redirects'); }
export async function bumpAmp()       { return incrementStat('amp'); }
