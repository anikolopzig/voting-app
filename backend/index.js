// GroupVote Cloud Function: POST /api/suggest -> { suggestions: [{label, why}] }.
// This is the ONLY server-side code in the project. It exists solely to hold the
// Gemini API key server-side (a Firebase secret) — the key must never ship in the
// browser bundle. All voting logic stays client-side against Firebase.

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { callGemini } from './suggest.js';

// Bound at deploy time; set with `firebase functions:secrets:set GEMINI_API_KEY`.
const geminiKey = defineSecret('GEMINI_API_KEY');

// Same-origin in prod (Hosting rewrite) and dev (Vite proxy adds no cross-origin),
// so a real browser request carries one of these Origins. A missing Origin (curl,
// server-to-server) is allowed so the endpoint stays testable; a present-but-
// unknown Origin is rejected as a cheap deterrent. Real abuse protection is
// Firebase App Check — a documented follow-up, not built here.
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

async function handler(req, res) {
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: 'Origin not allowed.' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  const problem = validate(req.body);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const { question, location, hint, existing } = req.body;

  try {
    const suggestions = await callGemini({
      apiKey: geminiKey.value(),
      question: question.trim(),
      location: location?.trim() || '',
      hint: hint?.trim() || '',
      existing: (existing || []).map((o) => o.trim()).filter(Boolean),
      count: clampCount(req.body.count),
    });
    res.status(200).json({ suggestions });
  } catch (err) {
    if (err?.isRefusal) {
      res.status(422).json({ error: 'Could not suggest options for this request.' });
      return;
    }
    // Map without leaking the raw SDK message. Network failure first (no HTTP
    // status), then rate limit, then everything else (bad key, 5xx, parse fail).
    if (isNetworkError(err)) {
      res.status(503).json({ error: 'Could not reach the suggestion service.' });
      return;
    }
    if (statusOf(err) === 429) {
      res.status(429).json({ error: 'The suggestion service is busy — try again in a moment.' });
      return;
    }
    console.error('suggestOptions failed:', err);
    res.status(502).json({ error: 'Could not generate suggestions. Please try again.' });
  }
}

export const suggestOptions = onRequest(
  {
    secrets: [geminiKey],
    region: 'us-central1', // must match the Hosting rewrite in firebase.json
    cors: false, // same-origin via the Hosting rewrite; we gate on Origin ourselves
    memory: '256MiB',
    timeoutSeconds: 60, // web-grounded calls can take ~5–15s
  },
  handler,
);
