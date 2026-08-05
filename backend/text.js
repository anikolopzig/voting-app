// Shared text + URL helpers for the two AI endpoints (suggest.js, expand.js).
// Pure — no Firebase, no SDK imports — so both modules stay runnable standalone.
//
// These started life inside suggest.js; they were lifted out when expand.js
// needed the same prompt-injection posture. Keep them here rather than copying:
// the sanitize rules ARE the injection defense, and two drifting copies would be
// a silent hole.

// Mirrors frontend/src/utils/keys.js isValidKey(): a label becomes a Firebase key
// downstream (optionAuthors[label], optionMeta[label], scores[label]), so it may
// not contain any of these. Local copy — backend/ is a separate package with no
// import path to the frontend src.
export const FORBIDDEN_KEY_RE = /[.#$[\]/]/;

// Neutralize any attempt to break out of the <tag> data fences the prompt
// builders wrap each field in, or to smuggle instructions: drop control chars
// (incl. newlines), angle brackets, and backticks; collapse to a single line;
// clamp length. Angle-bracket removal is a deliberate trade — poll fields almost
// never need < or >, and removing them guarantees no tag-like structure survives.
export function sanitizeField(value, maxLen) {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[<>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// Force a model-returned value to a single printable line and clamp it. Weaker
// than sanitizeField (angle brackets survive — this is output, not prompt input),
// but a multi-line value is almost always injected payload.
export function cleanLine(value, maxLen) {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// Like cleanLine, but never cuts a word in half: if the text overruns, back up to
// the last space and add an ellipsis. A hard slice produced summaries ending in
// "...Anatolian-in", which reads as a bug rather than as an abbreviation.
export function clampWords(value, maxLen) {
  const s = cleanLine(value, maxLen * 2);
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour the word boundary if it isn't absurdly early (one very long token).
  const body = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[,;:.\s]+$/, '')}…`;
}

// Pull the JSON object out of a model response: strip a ```json fence if present,
// then fall back to the outermost {...} if there's stray prose around it. Returns
// the candidate JSON *string* — the caller parses, so it can choose its own
// salvage strategy on failure.
export function extractJson(text) {
  let s = (text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{')) {
    const brace = s.match(/\{[\s\S]*\}/);
    if (brace) s = brace[0];
  }
  return s;
}

// The single URL trust gate. Model-supplied URLs are web-attacker-influenced
// (grounding reads arbitrary pages), and they end up as clickable hrefs, so this
// is deliberately strict — anything the least bit odd is rejected outright rather
// than repaired. Mirrored verbatim in frontend/src/utils/optionMeta.js, which
// re-runs it at render time (the RTDB node is world-writable; see CLAUDE.md).
// Returns a normalized href, or null.
//
// http: is accepted but UPGRADED to https:. Models routinely report a site as
// "http://example.com" even when it serves https, and rejecting those silently
// dropped most real links in testing. Upgrading can't widen the attack surface —
// the host is unchanged and only the scheme moves — while dropping the link
// outright loses real information. A genuinely http-only site just fails to load,
// which beats embedding mixed content in an https page.
export function safeUrl(raw, maxLen = 200) {
  const s = String(raw ?? '').trim();
  if (!s || s.length > maxLen * 2) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; // blocks javascript:, data:, vbscript:
  u.protocol = 'https:';
  if (u.username || u.password) return null; // blocks https://evil.example@real.example
  if (u.port) return null; // default port only
  if (!u.hostname.includes('.')) return null; // no bare/intranet hostnames
  // No IP literals — v4 (1.2.3.4) or v6 (bracketed). A legitimate website URL
  // found by web search always has a domain name.
  if (u.hostname.startsWith('[') || /^\d+(\.\d+){3}$/.test(u.hostname)) return null;
  u.hash = ''; // fragments carry no useful meaning here and are pure attack surface
  const href = u.toString();
  return href.length <= maxLen ? href : null;
}

// The hostname a user should see for a link, minus a leading "www.". The UI shows
// THIS rather than the model's own title text, so a link claiming to be "Official
// site" but pointing at evil.example reads as "evil.example".
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
