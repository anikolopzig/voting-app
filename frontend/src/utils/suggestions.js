// Thin fetch wrapper around the /api/suggest Cloud Function. Pure (no React), per
// the src/utils/ convention. The URL is same-origin in prod (Hosting rewrite) and
// proxied to the functions emulator in dev (see vite.config.js), so there is no
// environment branch here.
//
// Returns an array of { label, why }, or throws an Error whose message is safe to
// show the user.
export async function requestSuggestions({ question, location, hint, existing, count, idToken }) {
  // The endpoint requires a Firebase Auth ID token (AI suggestions are gated
  // behind an account; voting is not). The caller passes the token; we forward it
  // as a Bearer credential the Cloud Function verifies server-side.
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  let res;
  try {
    res = await fetch('/api/suggest', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question,
        location: location || '',
        hint: hint || '',
        existing: existing || [],
        count: count || 4,
      }),
    });
  } catch {
    throw new Error('Could not reach the suggestion service. Check your connection.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body — fall through to status-based handling below.
  }

  if (!res.ok) {
    throw new Error((data && data.error) || 'Could not get suggestions. Please try again.');
  }
  if (!data || !Array.isArray(data.suggestions)) {
    throw new Error('Got an unexpected response from the suggestion service.');
  }
  return data.suggestions;
}
