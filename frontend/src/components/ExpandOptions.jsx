import { useState } from 'react';
import { requestDetails } from '../utils/suggestions.js';
import { sanitizeDetail } from '../utils/optionMeta.js';
import { useAuth } from '../auth/AuthProvider.jsx';

// How many options one expand call covers. Mirrors MAX_OPTIONS in backend/expand.js,
// which rejects more than this.
const MAX_OPTIONS = 8;

// "✨ Add details to all" — researches the options that already exist and hands
// the results to the host via onDetails. Used in the create form (where it fills
// local state) and in the room (where ministers+ write them to Firebase).
//
// Deliberately NOT a .card: ministers already stack the options editor and the
// suggestion panel above the ballot, and a third card would push voting further
// below the fold. It stays a single ghost button until it has something to say.
//
// onDetails(detailsByLabel) -> boolean|Promise<boolean>; false means the host
// couldn't save them, and we show that rather than claiming success.
// `location` is CONTROLLED by the host and shared with <SuggestOptions>, so a
// location typed into either panel is already there when you open the other.
export default function ExpandOptions({
  question,
  options,
  onDetails,
  location = '',
  onLocationChange,
}) {
  const { user } = useAuth(); // present only because the parent gated us behind sign-in
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const labels = (options || []).map((o) => (o || '').trim()).filter(Boolean);
  const targets = labels.slice(0, MAX_OPTIONS);
  const canExpand = Boolean(question?.trim()) && targets.length > 0;

  async function handleExpand() {
    setError('');
    setNote('');
    setBusy(true);
    try {
      // Fresh ID token for the Bearer credential the function verifies.
      const idToken = user ? await user.getIdToken() : null;
      const details = await requestDetails({
        question: question.trim(),
        location: location.trim(),
        options: targets,
        idToken,
      });

      // Sanitize before anything is stored or shown — the same gate Room.jsx
      // applies on read, so a hostile response can't be written to the room.
      const byLabel = {};
      for (const d of details) {
        const clean = sanitizeDetail(d);
        if (clean && targets.includes(d?.label)) byLabel[d.label] = clean;
      }

      const found = Object.keys(byLabel).length;
      if (!found) {
        setError('Could not find details for these options.');
        return;
      }
      const saved = await onDetails(byLabel);
      if (saved === false) return; // the host already surfaced why
      setNote(
        `Added details for ${found} of ${targets.length} option${targets.length === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setError(err.message || 'Could not add details.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
        ✨ Add details to all
      </button>
    );
  }

  return (
    <div className="expand">
      <div className="expand__head">
        <span className="field__label expand__title">Add details to all options</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close details panel"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>

      <label className="field">
        <span className="field__label">
          Location <span className="suggest__hint">optional — helps find real places</span>
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

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={handleExpand}
        disabled={busy || !canExpand}
        title={canExpand ? 'Research these options' : 'Add a question and options first'}
      >
        {busy ? '🔎 Searching the web…' : '✨ Add details'}
      </button>

      {busy && <p className="section-note">This searches the web, so it can take a few seconds.</p>}
      {labels.length > MAX_OPTIONS && (
        <p className="section-note">
          Only the first {MAX_OPTIONS} options are researched at a time.
        </p>
      )}
      {note && <p className="section-note">{note}</p>}
      {error && <p className="inline-error">{error}</p>}
    </div>
  );
}
