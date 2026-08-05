import { useEffect, useRef, useState } from 'react';
import { isValidKey, FORBIDDEN_KEY_HINT } from '../utils/keys.js';
import OptionDetails, { useOpenDetails, ShowAllDetails } from './OptionDetails.jsx';

// Live editor for the room's shared option list, shown to anyone who may edit
// (ministers + presidents; see canEditOptions). Edits stay local until "Update
// options" writes the whole array to Firebase, which re-seeds every voter's
// ballot. The draft re-seeds (via the effect below) whenever the stored option
// set changes — including after your own save — so it stays in sync without a
// key-based remount. (A key that matched VotingSection's would collide and make
// React duplicate/drop the editor.) Any unsaved local edits are dropped when the
// stored set changes underneath you; acceptable for a live shared list.
//
// `actions` are extra buttons shown beside "+ Add option" (the AI panels, which
// the room passes in) — kept as a slot so the editor stays unaware of AI.
// `optionMeta` only lights up a ⓘ per row, so you can see which options already
// carry AI details without leaving this card.
export default function OptionsEditor({ options, onSave, optionMeta, actions }) {
  const [draft, setDraft] = useState(() => [...options]);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const details = useOpenDetails();

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
    // Labels become Firebase keys (optionAuthors[label], each vote's scores[label]).
    const badOption = trimmed.find((o) => !isValidKey(o));
    if (badOption) {
      return setLocalError(`Options can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
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
      <ShowAllDetails
        labels={draft.map((o) => o.trim()).filter((o) => optionMeta?.[o])}
        view={details}
      />
      <div className="option-list">
        {draft.map((opt, i) => {
          // Look the detail up by the DRAFT text, not the stored label: if you
          // rename a row the ⓘ disappears as you type, which is exactly what
          // happens on save (details are keyed by label, so a rename drops them).
          const label = opt.trim();
          const detail = optionMeta?.[label];
          return (
            <div className="option-row" key={i}>
              <input
                className="input"
                type="text"
                value={opt}
                maxLength={60}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => update(i, e.target.value)}
              />
              {detail && (
                <button
                  type="button"
                  className={`option-info${details.isOpen(label) ? ' is-open' : ''}`}
                  onClick={() => details.toggle(label)}
                  aria-expanded={details.isOpen(label)}
                  aria-label={`${details.isOpen(label) ? 'Hide' : 'Show'} AI details for ${label}`}
                  title={details.isOpen(label) ? 'Hide AI details' : 'Has AI details'}
                >
                  ⓘ
                </button>
              )}
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
              {/* Wraps onto its own full-width line (see .option-row in global.css). */}
              {details.isOpen(label) && <OptionDetails detail={detail} />}
            </div>
          );
        })}
      </div>
      {/* "+ Add option" sits in a row with whatever the host supplies — in the
          room that's the two AI panels, so every way of adding or enriching an
          option lives together instead of floating below the card. */}
      <div className="options-actions">
        <button type="button" className="btn btn--ghost" onClick={add}>
          + Add option
        </button>
        {actions}
      </div>
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
