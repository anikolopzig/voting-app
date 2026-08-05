// Read-time sanitizer for the optionMeta node — the app's trust boundary for AI
// option details. Pure (no React), per the src/utils/ convention.
//
// WHY THIS EXISTS EVEN THOUGH THE BACKEND ALREADY VALIDATES: the Realtime
// Database runs on open test-mode rules, so anyone holding a 6-char room code can
// PUT whatever they like straight into rooms/{code}/optionMeta — no Cloud Function
// involved. Server-side validation protects the honest path; THIS is what
// protects the browser. Every cap and every URL check is re-applied here, and
// Room.jsx runs it once before anything reaches a component, so there is exactly
// one call site to audit.

// The only host an option image may load from. Enforced here, in backend/wiki.js,
// and a third time by the CSP img-src header in firebase.json.
export const IMAGE_HOSTS = new Set(['upload.wikimedia.org']);

const MAX_SUMMARY = 140;
const MAX_URL = 200;
const MAX_LINK_TITLE = 60;
const MAX_PLACE_NAME = 80;
const MAX_ADDRESS = 120;
const MAX_ALT = 80;
const MAX_CREDIT = 40;

// Mirror of safeUrl() in backend/text.js — keep the two in step. Returns a
// normalized https href or null. http: is upgraded rather than rejected (see the
// backend note); javascript:, data: and friends are rejected outright.
export function safeHttpUrl(raw, { hosts = null, maxLen = MAX_URL } = {}) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > maxLen * 2) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  u.protocol = 'https:';
  if (u.username || u.password) return null;
  if (u.port) return null;
  if (!u.hostname.includes('.')) return null;
  if (u.hostname.startsWith('[') || /^\d+(\.\d+){3}$/.test(u.hostname)) return null;
  if (hosts && !hosts.has(u.hostname)) return null;
  u.hash = '';
  const href = u.toString();
  return href.length <= maxLen ? href : null;
}

// The hostname to SHOW for a link, minus a leading "www.". The chip renders this
// rather than the model's own title, so a link calling itself "Official site" but
// pointing at evil.example reads as "evil.example".
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Keyless Google Maps deep link — no Maps API key, no billing, no SDK, and on a
// phone the OS hands it straight to the Maps app. Built here from the stored
// place rather than stored as a URL, so it can never be poisoned in the DB.
// Returns null when there's no place, which is how "no map for a cuisine" works.
export function mapsUrlFor(place) {
  if (!place) return null;
  const query = [place.name, place.address].filter(Boolean).join(' ').trim();
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function text(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

// One raw optionMeta entry -> a clean detail, or null when nothing survives.
// Returning null (rather than an empty object) is what keeps an option with no
// usable detail rendering exactly as it does today, with no ⓘ and no empty shell.
export function sanitizeDetail(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};

  const summary = text(raw.summary, MAX_SUMMARY);
  if (summary) out.summary = summary;

  const linkUrl = safeHttpUrl(raw.link?.url);
  if (linkUrl) {
    out.link = { url: linkUrl, title: text(raw.link?.title, MAX_LINK_TITLE) || hostLabel(linkUrl) };
  }

  const placeName = text(raw.place?.name, MAX_PLACE_NAME);
  const address = text(raw.place?.address, MAX_ADDRESS);
  if (placeName && address) out.place = { name: placeName, address };

  const imageUrl = safeHttpUrl(raw.image?.url, { hosts: IMAGE_HOSTS, maxLen: 400 });
  if (imageUrl) {
    out.image = {
      url: imageUrl,
      alt: text(raw.image?.alt, MAX_ALT),
      credit: text(raw.image?.credit, MAX_CREDIT),
    };
  }

  return Object.keys(out).length ? out : null;
}

// Sanitize the whole node, keeping only entries for options that still exist.
// Passing `options` means meta left behind by a rename or a missed prune is
// dropped at render even if it lingers in the database.
export function sanitizeMetaMap(rawMeta, options) {
  if (!rawMeta || typeof rawMeta !== 'object' || !Array.isArray(options)) return null;
  const out = {};
  for (const label of options) {
    const detail = sanitizeDetail(rawMeta[label]);
    if (detail) out[label] = detail;
  }
  return Object.keys(out).length ? out : null;
}
