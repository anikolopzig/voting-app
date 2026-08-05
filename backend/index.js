// GroupVote Cloud Functions — the ONLY server-side code in the project. Both
// endpoints exist solely to hold the Gemini API key server-side (a Firebase
// secret); the key must never ship in the browser bundle. All voting logic stays
// client-side against Firebase.
//
//   POST /api/suggest -> { suggestions: [{label, why}] }   propose new options
//   POST /api/expand  -> { details: [{label, summary?, link?, place?, image?}] }
//                                                          research existing ones
//
// Both share one access gate (requireVerifiedCaller) and one error→HTTP mapping
// (sendAiError), so they can't drift apart.

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { callGemini } from './suggest.js';
import { callExpand, MAX_OPTIONS } from './expand.js';

// Bound at deploy time; set with `firebase functions:secrets:set GEMINI_API_KEY`.
const geminiKey = defineSecret('GEMINI_API_KEY');

// Admin SDK — used only to verify the caller's Firebase Auth ID token (below).
// No credentials needed: it uses the function's own service account (and the
// auth emulator locally, via FIREBASE_AUTH_EMULATOR_HOST). Guard against a
// double init on hot reload.
if (!getApps().length) initializeApp();

// The AI features are gated behind a Firebase Auth account (VOTING stays
// account-free). Require a *verified* email so "sign up" proves the caller
// controls a real inbox — flip to false to accept any signed-in user. Keep this
// in sync with REQUIRE_EMAIL_VERIFICATION in frontend/src/utils/flags.js.
const EMAIL_VERIFICATION_REQUIRED = true;

// Firebase Hosting cuts off a proxied function response at ~60s and emits its own
// HTML 504 — which the client's res.json() can't parse. So we stop ourselves
// first and return a real JSON error the UI can show. Raising timeoutSeconds past
// 60 would NOT help: the Hosting cap is upstream of the function's own timeout.
const SOFT_DEADLINE_MS = 45_000;

// Same-origin in prod (Hosting rewrite) and dev (Vite proxy adds no cross-origin),
// so a real browser request carries one of these Origins. A missing Origin (curl,
// server-to-server) is allowed so the endpoints stay testable; a present-but-
// unknown Origin is rejected as a cheap deterrent. This is NOT the real access
// control — the Origin header is client-spoofable. The real gate is the Firebase
// Auth ID-token check in requireVerifiedCaller() (a signed token can't be forged).
const ALLOWED_ORIGINS = new Set([
  'https://groupvote-12796.web.app',
  'https://groupvote-12796.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function clampCount(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 4;
  return Math.max(1, Math.min(8, n));
}

// Pull an HTTP-ish status off whatever the SDK throws (the shape varies by
// version). Returns undefined when there's no numeric status to key on.
function statusOf(err) {
  const s = err?.status ?? err?.code ?? err?.response?.status;
  return typeof s === 'number' ? s : undefined;
}
// A transport failure (DNS / connection refused / timeout) has no HTTP status.
function isNetworkError(err) {
  const name = err?.name || '';
  const msg = err?.message || '';
  return name === 'FetchError' || /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(msg);
}

// Shared access gate for every AI endpoint. Returns the decoded token, or null
// after having ALREADY sent the response — callers just `if (!decoded) return;`.
//
// Verifying the ID token here — not merely hiding the button in the UI — is what
// actually closes the open endpoint: unlike the Origin header, a Firebase-signed
// token can't be forged by a stray script. The token check is kept in its own
// try/catch so a bad token yields 401, not the 502 fallback.
async function requireVerifiedCaller(req, res, what) {
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: 'Origin not allowed.' });
    return null;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return null;
  }

  const authHeader = req.get('authorization') || '';
  const bearer = authHeader.match(/^Bearer (.+)$/i);
  if (!bearer) {
    res.status(401).json({ error: `Sign in to use ${what}.` });
    return null;
  }
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(bearer[1]);
  } catch {
    res.status(401).json({ error: 'Your session has expired — sign in again.' });
    return null;
  }
  if (EMAIL_VERIFICATION_REQUIRED && !decoded.email_verified) {
    res.status(403).json({ error: `Verify your email to use ${what}.` });
    return null;
  }
  return decoded;
}

// Shared error→HTTP mapping, without leaking the raw SDK message. Refusal first,
// then network failure (no HTTP status), then rate limit, then everything else
// (bad key, 5xx, parse failure).
function sendAiError(res, err, { refusal, fallback, tag }) {
  if (err?.isRefusal) {
    res.status(422).json({ error: refusal });
    return;
  }
  if (err?.isTimeout) {
    res.status(503).json({ error: 'That took too long — try again with fewer options.' });
    return;
  }
  if (isNetworkError(err)) {
    res.status(503).json({ error: 'Could not reach the AI service.' });
    return;
  }
  if (statusOf(err) === 429) {
    res.status(429).json({ error: 'The AI service is busy — try again in a moment.' });
    return;
  }
  console.error(`${tag} failed:`, err);
  res.status(502).json({ error: fallback });
}

// Reject before Hosting does, so the client gets JSON instead of an HTML 504.
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Soft deadline exceeded.');
      err.isTimeout = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- /api/suggest

// Returns a user-safe error string if the body is invalid, or null if it's OK.
function validate(body) {
  if (typeof body !== 'object' || body === null) return 'Request body must be a JSON object.';
  const { question, location, hint, existing } = body;
  if (typeof question !== 'string' || !question.trim()) return 'A question is required.';
  if (question.length > 200) return 'Question is too long.';
  if (location != null && (typeof location !== 'string' || location.length > 120)) {
    return 'Location is invalid.';
  }
  if (hint != null && (typeof hint !== 'string' || hint.length > 300)) return 'Hint is invalid.';
  if (existing != null) {
    if (!Array.isArray(existing) || existing.length > 20) return 'Existing options are invalid.';
    if (existing.some((o) => typeof o !== 'string' || o.length > 60)) {
      return 'One of the existing options is invalid.';
    }
  }
  return null;
}

async function suggestHandler(req, res) {
  if (!(await requireVerifiedCaller(req, res, 'AI suggestions'))) return;

  const problem = validate(req.body);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const { question, location, hint, existing } = req.body;

  try {
    const suggestions = await withDeadline(
      callGemini({
        apiKey: geminiKey.value(),
        question: question.trim(),
        location: location?.trim() || '',
        hint: hint?.trim() || '',
        existing: (existing || []).map((o) => o.trim()).filter(Boolean),
        count: clampCount(req.body.count),
      }),
      SOFT_DEADLINE_MS,
    );
    res.status(200).json({ suggestions });
  } catch (err) {
    sendAiError(res, err, {
      refusal: 'Could not suggest options for this request.',
      fallback: 'Could not generate suggestions. Please try again.',
      tag: 'suggestOptions',
    });
  }
}

// ----------------------------------------------------------------- /api/expand

function validateExpand(body) {
  if (typeof body !== 'object' || body === null) return 'Request body must be a JSON object.';
  const { question, location, options } = body;
  if (typeof question !== 'string' || !question.trim()) return 'A question is required.';
  if (question.length > 200) return 'Question is too long.';
  if (location != null && (typeof location !== 'string' || location.length > 120)) {
    return 'Location is invalid.';
  }
  if (!Array.isArray(options) || options.length < 1) return 'At least one option is required.';
  if (options.length > MAX_OPTIONS) return `Please expand at most ${MAX_OPTIONS} options at a time.`;
  if (options.some((o) => typeof o !== 'string' || !o.trim() || o.length > 60)) {
    return 'One of the options is invalid.';
  }
  return null;
}

async function expandHandler(req, res) {
  if (!(await requireVerifiedCaller(req, res, 'AI details'))) return;

  const problem = validateExpand(req.body);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const { question, location, options } = req.body;

  try {
    const details = await withDeadline(
      callExpand({
        apiKey: geminiKey.value(),
        question: question.trim(),
        location: location?.trim() || '',
        options: options.map((o) => o.trim()).filter(Boolean),
      }),
      SOFT_DEADLINE_MS,
    );
    res.status(200).json({ details });
  } catch (err) {
    sendAiError(res, err, {
      refusal: 'Could not research these options.',
      fallback: 'Could not add details. Please try again.',
      tag: 'expandOptions',
    });
  }
}

// ---------------------------------------------------------------------- export

export const suggestOptions = onRequest(
  {
    secrets: [geminiKey],
    region: 'us-central1', // must match the Hosting rewrite in firebase.json
    cors: false, // same-origin via the Hosting rewrite; we gate on Origin ourselves
    memory: '256MiB',
    timeoutSeconds: 60, // web-grounded calls can take ~5–15s; Hosting caps us at 60 anyway
  },
  suggestHandler,
);

export const expandOptions = onRequest(
  {
    secrets: [geminiKey],
    region: 'us-central1',
    cors: false,
    memory: '256MiB',
    timeoutSeconds: 60, // see SOFT_DEADLINE_MS — Hosting won't wait longer than this
    maxInstances: 5, // cheap cost guard: expand is the pricier of the two endpoints
  },
  expandHandler,
);
