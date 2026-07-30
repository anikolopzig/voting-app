import { useState } from 'react';
import { requestSuggestions } from '../utils/suggestions.js';

// Collapsible "let AI suggest options" panel, rendered inside the CreateRoom form.
// Covers both cases through one request: with a location + hint and no typed
// options it cold-starts; with some options already typed (passed in `existing`)
// it extends without duplicating them. Nothing is added automatically — each
// suggestion carries an accept (✓) / reject (✕) control. Accepting sends the
// label up via onAccept (CreateRoom places it: blank rows first, never
// overwriting text); rejecting an already-accepted one pulls it back via onRemove.
export default function SuggestOptions({ question, existing, onAccept, onRemove }) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [hint, setHint] = useState('');
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null); // [{label, why}] once it succeeds
  // Per-label decision: 'accepted' | 'rejected' | undefined (undecided).
  const [decisions, setDecisions] = useState({});

  const canSuggest = question.trim().length > 0;

  async function handleSuggest() {
    setError('');
    setBusy(true);
    try {
      const suggestions = await requestSuggestions({
        question: question.trim(),
        location: location.trim(),
        hint: hint.trim(),
        existing,
        count,
      });
      // A fresh batch starts undecided — the user opts each one in or out.
      setDecisions({});
      if (!suggestions.length) {
        setResults(null);
        setError('No suggestions came back — try adding a location or a hint.');
      } else {
        setResults(suggestions);
      }
    } catch (err) {
      setResults(null);
      setError(err.message || 'Could not get suggestions.');
    } finally {
      setBusy(false);
    }
  }

  // Accept: add the label to the options (idempotent — onAccept dedupes).
  function accept(label) {
    if (decisions[label] === 'accepted') return;
    onAccept([label]);
    setDecisions((d) => ({ ...d, [label]: 'accepted' }));
  }
  // Reject: mark it out, and if it had been accepted, pull it back out of options.
  function reject(label) {
    if (decisions[label] === 'rejected') return;
    if (decisions[label] === 'accepted') onRemove?.(label);
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
          onChange={(e) => setLocation(e.target.value)}
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
