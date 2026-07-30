import { useEffect, useRef, useState } from 'react';

// Live editor for the room's shared option list, shown to anyone who may edit
// (ministers + presidents; see canEditOptions). Edits stay local until "Update
// options" writes the whole array to Firebase, which re-seeds every voter's
// ballot. The draft re-seeds (via the effect below) whenever the stored option
// set changes — including after your own save — so it stays in sync without a
// key-based remount. (A key that matched VotingSection's would collide and make
// React duplicate/drop the editor.) Any unsaved local edits are dropped when the
// stored set changes underneath you; acceptable for a live shared list.
export default function OptionsEditor({ options, onSave }) {
  const [draft, setDraft] = useState(() => [...options]);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  // Re-seed the draft when the stored options change by value (remote edit, or
  // our own save landing). Tracked by signature so typing doesn't trigger it.
  const seededSig = useRef(options.join('|'));
  useEffect(() => {
    const sig = options.join('|');
    if (sig !== seededSig.current) {
      seededSig.current = sig;
      setDraft([...options]);
    }
  }, [options]);

  function update(i, value) {
    setDraft((d) => d.map((o, idx) => (idx === i ? value : o)));
  }
  function add() {
    setDraft((d) => [...d, '']);
  }
  function remove(i) {
    // Enforce a minimum of 2 options, matching room creation.
    setDraft((d) => (d.length <= 2 ? d : d.filter((_, idx) => idx !== i)));
  }

  const trimmed = draft.map((o) => o.trim()).filter(Boolean);
  const lowered = trimmed.map((o) => o.toLowerCase());
  // Nothing to save if the cleaned list is identical to what's already stored.
  const unchanged =
    trimmed.length === options.length && trimmed.every((o, i) => o === options[i]);

  async function save() {
    setLocalError('');
    if (trimmed.length < 2) return setLocalError('Please keep at least 2 options.');
    if (new Set(lowered).size !== lowered.length) {
      return setLocalError('Options must be unique.');
    }
    setBusy(true);
    try {
      await onSave(trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card options-editor">
      <h2 className="section-title">Edit options</h2>
      <p className="section-note">
        Changes apply for everyone and re-seed each person’s ballot.
      </p>
      <div className="option-list">
        {draft.map((opt, i) => (
          <div className="option-row" key={i}>
            <input
              className="input"
              type="text"
              value={opt}
              maxLength={60}
              placeholder={`Option ${i + 1}`}
              onChange={(e) => update(i, e.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove option ${i + 1}`}
              onClick={() => remove(i)}
              disabled={draft.length <= 2}
              title={draft.length <= 2 ? 'At least 2 options required' : 'Remove option'}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--ghost" onClick={add}>
        + Add option
      </button>
      {localError && <p className="inline-error">{localError}</p>}
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={save}
        disabled={busy || unchanged}
      >
        {busy ? 'Saving…' : 'Update options'}
      </button>
    </section>
  );
}
