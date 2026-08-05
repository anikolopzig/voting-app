import { useState } from 'react';
import { requestSuggestions, requestDetails } from '../utils/suggestions.js';
import { sanitizeDetail } from '../utils/optionMeta.js';
import { OPTION_DETAILS_ENABLED } from '../utils/flags.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import OptionDetails from './OptionDetails.jsx';

// Collapsible "let AI suggest options" panel, rendered inside the CreateRoom form.
// Covers both cases through one request: with a location + hint and no typed
// options it cold-starts; with some options already typed (passed in `existing`)
// it extends without duplicating them. Nothing is added automatically — each
// suggestion carries an accept (✓) / reject (✕) control. Accepting sends the
// label up via onAccept (CreateRoom places it: blank rows first, never
// overwriting text); rejecting an already-accepted one pulls it back via onRemove.
//
// `location` is CONTROLLED by the host and shared with <ExpandOptions>: both
// panels ask for the same thing, so typing it once must be enough — the other
// panel opening with an empty box you already filled in reads as a bug.
export default function SuggestOptions({
  question,
  existing,
  onAccept,
  onRemove,
  location = '',
  onLocationChange,
}) {
  const { user } = useAuth(); // present only because the parent gated us behind sign-in
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null); // [{label, why}] once it succeeds
  // Per-label decision: 'accepted' | 'rejected' | undefined (undecided).
  const [decisions, setDecisions] = useState({});
  // Researched detail per label, from "expand on these". Shown inline here and
  // carried up through onAccept so an accepted suggestion keeps what we found.
  const [details, setDetails] = useState({});
  const [expanding, setExpanding] = useState(false);

  const canSuggest = question.trim().length > 0;

  async function handleSuggest() {
    setError('');
    setBusy(true);
    try {
      // Fresh ID token for the Bearer credential the function verifies. getIdToken
      // auto-refreshes if it's near expiry, so it never sends a stale token.
      const idToken = user ? await user.getIdToken() : null;
      const suggestions = await requestSuggestions({
        question: question.trim(),
        location: location.trim(),
        hint: hint.trim(),
        existing,
        count,
        idToken,
      });
      // Dedup by label (case-insensitive) so two identical suggestions can't
      // collide on the React key or share a single accept/reject decision.
      const seen = new Set();
      const unique = suggestions.filter((s) => {
        const k = (s.label || '').trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      // A fresh batch starts undecided — the user opts each one in or out — and
      // carries no detail until they ask for it.
      setDecisions({});
      setDetails({});
      if (!unique.length) {
        setResults(null);
        setError('No suggestions came back — try adding a location or a hint.');
      } else {
        setResults(unique);
      }
    } catch (err) {
      setResults(null);
      setError(err.message || 'Could not get suggestions.');
    } finally {
      setBusy(false);
    }
  }

  // Research the suggestions in place, so the user can judge them before adding
  // any. Nothing is written anywhere — the detail rides along on accept.
  async function handleExpand() {
    setError('');
    setExpanding(true);
    try {
      const idToken = user ? await user.getIdToken() : null;
      const labels = results.map((s) => s.label);
      const found = await requestDetails({
        question: question.trim(),
        location: location.trim(),
        options: labels,
        idToken,
      });
      // Sanitize here, at the point it enters app state — the same gate Room.jsx
      // applies on read, so nothing unvetted can be handed to onAccept.
      const next = {};
      for (const d of found) {
        const clean = sanitizeDetail(d);
        if (clean && labels.includes(d?.label)) next[d.label] = clean;
      }
      if (!Object.keys(next).length) {
        setError('Could not find details for these suggestions.');
        return;
      }
      setDetails((prev) => ({ ...prev, ...next }));
    } catch (err) {
      setError(err.message || 'Could not add details.');
    } finally {
      setExpanding(false);
    }
  }

  // Accept: add the label to the options (idempotent — onAccept dedupes), along
  // with whatever we researched for it so the detail isn't lost on the way in.
  function accept(label) {
    if (decisions[label] === 'accepted') return;
    onAccept([label], details[label] ? { [label]: details[label] } : undefined);
    setDecisions((d) => ({ ...d, [label]: 'accepted' }));
  }
  // Reject: mark it out, and if it had been accepted, pull it back out of options.
  // Only mark rejected once the removal actually succeeds — the in-room host can
  // refuse (e.g. it would drop below 2 options), and marking it rejected anyway
  // would leave the option live on the ballot while the UI showed it skipped.
  async function reject(label) {
    if (decisions[label] === 'rejected') return;
    if (decisions[label] === 'accepted') {
      const ok = await onRemove?.(label);
      if (ok === false) return; // couldn't remove — keep it shown as accepted
    }
    setDecisions((d) => ({ ...d, [label]: 'rejected' }));
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
        ✨ Suggest options with AI
      </button>
    );
  }

  return (
    <div className="card suggest">
      <div className="suggest__head">
        <span className="field__label suggest__title">Suggest options with AI</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close suggestions"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>

      <label className="field">
        <span className="field__label">
          Location <span className="suggest__hint">optional</span>
        </span>
        <input
          className="input"
          type="text"
          value={location}
          maxLength={120}
          placeholder="e.g. Kolonaki, Athens"
          onChange={(e) => onLocationChange(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">
          Vibe / hint <span className="suggest__hint">optional</span>
        </span>
        <input
          className="input"
          type="text"
          value={hint}
          maxLength={300}
          placeholder="e.g. cheap, vegetarian-friendly, walkable"
          onChange={(e) => setHint(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">How many</span>
        <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {[2, 3, 4, 5, 6, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={handleSuggest}
        disabled={busy || !canSuggest}
        title={canSuggest ? 'Ask AI for options' : 'Enter a question above first'}
      >
        {busy ? 'Thinking…' : '✨ Suggest options'}
      </button>

      {!canSuggest && (
        <p className="section-note">Add a question above first — it drives the suggestions.</p>
      )}
      {error && <p className="inline-error">{error}</p>}

      {results && (
        <div className="suggest__results">
          <p className="section-note">Here’s what came back — ✓ to add it, ✕ to skip:</p>
          {OPTION_DETAILS_ENABLED && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleExpand}
              disabled={expanding}
              title="Search the web for details about these suggestions"
            >
              {expanding ? '🔎 Searching the web…' : '✨ Add details to these'}
            </button>
          )}
          <ul className="suggest__list">
            {results.map((s) => {
              const decision = decisions[s.label];
              return (
                <li
                  key={s.label}
                  className={
                    'suggest__item' +
                    (decision === 'accepted' ? ' suggest__item--accepted' : '') +
                    (decision === 'rejected' ? ' suggest__item--rejected' : '')
                  }
                >
                  <div className="suggest__text">
                    <span className="suggest__label">{s.label}</span>
                    {s.why && <span className="suggest__why">{s.why}</span>}
                    {/* Always visible here, unlike the ballot: this panel exists
                        to help you decide, so hiding what we found defeats it. */}
                    {details[s.label] && <OptionDetails detail={details[s.label]} />}
                  </div>
                  <div className="suggest__actions">
                    <button
                      type="button"
                      className={
                        'suggest__vote suggest__vote--no' +
                        (decision === 'rejected' ? ' is-active' : '')
                      }
                      onClick={() => reject(s.label)}
                      aria-pressed={decision === 'rejected'}
                      aria-label={`Reject ${s.label}`}
                      title="Skip this option"
                    >
                      ✕
                    </button>
                    <button
                      type="button"
                      className={
                        'suggest__vote suggest__vote--yes' +
                        (decision === 'accepted' ? ' is-active' : '')
                      }
                      onClick={() => accept(s.label)}
                      aria-pressed={decision === 'accepted'}
                      aria-label={`Add ${s.label} to options`}
                      title="Add to options"
                    >
                      ✓
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
