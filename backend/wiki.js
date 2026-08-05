// Resolves a concept name to a hotlinkable thumbnail via the English Wikipedia
// REST summary API. Keyless, CORS-friendly, stable URLs, and permissively
// licensed — which is why option images come from here rather than from a URL
// the model made up.
//
// The deliberate consequence: this works for GENERAL CONCEPTS with an article
// ("Greek cuisine", "Sushi", "Bowling") and returns nothing for a specific local
// business. That's exactly the split the feature wants — venues get a website
// link + a map, concepts get a picture.
//
// SSRF posture: the model supplies only a PATH SEGMENT, never a URL. The host is
// hardcoded, the title is regex-validated and then encodeURIComponent'd (which
// encodes "/" as %2F, so no traversal and no host substitution), and the URL that
// comes back out is re-validated against a one-host allowlist before we hand it
// to a browser. If you ever make this fetch a model-supplied URL, that property
// is lost and you must add IP/host filtering.

import { safeUrl, cleanLine } from './text.js';

// The only host an option image may ever load from. Enforced here, again in
// frontend/src/utils/optionMeta.js at render time, and a third time by the CSP
// img-src header in firebase.json.
export const IMAGE_HOST = 'upload.wikimedia.org';

// Letters/numbers/spaces and the punctuation real article titles use. Anything
// else — slashes, colons, percent signs, control chars — and we don't ask.
const TITLE_RE = /^[\p{L}\p{N} '’()\-,.&]{1,80}$/u;

// Wikimedia's User-Agent policy: unidentified datacenter clients get 403'd or
// throttled. Omitting this works locally and then silently fails in production.
const USER_AGENT = 'GroupVote/1.0 (https://groupvote-12796.web.app)';

// Returns { url, alt, credit } or null. NEVER throws and never rejects — an image
// is a nice-to-have, so every failure (bad title, 404, disambiguation page,
// timeout, no thumbnail, unexpected host) degrades silently to "no image".
export async function resolveWikiImage(title, { timeoutMs = 3000 } = {}) {
  const clean = cleanLine(title, 80);
  if (!clean || !TITLE_RE.test(clean)) return null;

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    clean.replace(/ /g, '_'),
  )}`;

  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const data = await res.json();
    // 'standard' excludes disambiguation pages, which have no meaningful image.
    if (data?.type !== 'standard') return null;

    const src = data?.thumbnail?.source; // ~320px wide; originalimage can be many MB
    if (!src) return null;
    const safe = safeUrl(src, 400);
    if (!safe || new URL(safe).hostname !== IMAGE_HOST) return null;

    return {
      url: safe,
      alt: cleanLine(data.title, 80) || clean,
      credit: 'Wikipedia',
    };
  } catch {
    return null; // network error, timeout, non-JSON body — all the same to us
  }
}

// Tiny manual harness: `node wiki.js "Greek cuisine"`.
// Expect a thumbnail for a concept, and null for a specific local business.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [title = 'Greek cuisine'] = process.argv.slice(2);
  resolveWikiImage(title).then((out) => console.log(JSON.stringify(out, null, 2)));
}
