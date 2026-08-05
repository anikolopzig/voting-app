// Thin fetch wrappers around the two AI Cloud Functions. Pure (no React), per the
// src/utils/ convention. Both URLs are same-origin in prod (Hosting rewrites) and
// proxied to the functions emulator in dev (see vite.config.js), so there is no
// environment branch here.
//
// Both endpoints require a Firebase Auth ID token (the AI features are gated
// behind an account; voting is not). The caller passes the token; we forward it
// as a Bearer credential the Cloud Function verifies server-side.
//
// Both throw an Error whose message is safe to show the user.

// The functions stop themselves at 45s and Firebase Hosting cuts a proxied
// response at ~60s, so a request still open past this is never coming back —
// fail with a readable message instead of spinning forever.
const REQUEST_TIMEOUT_MS = 70_000;

async function postJson(path, body, idToken, { unreachable, failed }) {
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(err?.name === 'TimeoutError' ? 'That took too long — try again.' : unreachable);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. Hosting's own HTML 504) — fall through to the status check.
  }

  if (!res.ok) throw new Error((data && data.error) || failed);
  return data;
}

// Returns an array of { label, why }.
export async function requestSuggestions({ question, location, hint, existing, count, idToken }) {
  const data = await postJson(
    '/api/suggest',
    {
      question,
      location: location || '',
      hint: hint || '',
      existing: existing || [],
      count: count || 4,
    },
    idToken,
    {
      unreachable: 'Could not reach the suggestion service. Check your connection.',
      failed: 'Could not get suggestions. Please try again.',
    },
  );
  if (!Array.isArray(data?.suggestions)) {
    throw new Error('Got an unexpected response from the suggestion service.');
  }
  return data.suggestions;
}

// Web-researched detail for options that already exist. Returns an array of
// { label, summary?, link?, place?, image? } — every field optional, and options
// nothing was found for are simply absent from the result.
export async function requestDetails({ question, location, options, idToken }) {
  const data = await postJson(
    '/api/expand',
    { question, location: location || '', options: options || [] },
    idToken,
    {
      unreachable: 'Could not reach the AI service. Check your connection.',
      failed: 'Could not add details. Please try again.',
    },
  );
  if (!Array.isArray(data?.details)) {
    throw new Error('Got an unexpected response from the AI service.');
  }
  return data.details;
}
