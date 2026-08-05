import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get, set } from 'firebase/database';
import { db } from '../firebase.js';
import { generateRoomCode } from '../utils/roomCode.js';
import { saveIdentity } from '../utils/storage.js';
import { ROOM_TTL_MS } from '../utils/room.js';
import { INPUT_MODES, DEFAULT_INPUT_MODE_ID, getInputMode } from '../utils/inputModes.js';
import { ROOM_MODES, DEFAULT_ROOM_MODE, MODE_META } from '../utils/roles.js';
import {
  ROOM_MODE_UI_ENABLED,
  REQUIRE_EMAIL_VERIFICATION,
  OPTION_DETAILS_ENABLED,
  STANDALONE_EXPAND_ENABLED,
} from '../utils/flags.js';
import { isValidKey, FORBIDDEN_KEY_HINT } from '../utils/keys.js';
import SuggestOptions from './SuggestOptions.jsx';
import ExpandOptions from './ExpandOptions.jsx';
import OptionDetails, { useOpenDetails, ShowAllDetails } from './OptionDetails.jsx';
import AuthForm from './AuthForm.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';

// Try a handful of random codes, checking each for collisions, before giving up.
async function reserveUniqueCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateRoomCode();
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) return code;
  }
  throw new Error('Could not generate a free room code. Please try again.');
}

export default function CreateRoom({ onError, initialName = '' }) {
  const [name, setName] = useState(initialName);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']); // start with 2 empty inputs
  // AI-researched detail per option label, kept local until the room is created
  // (handleSubmit prunes it to the options that actually ship).
  const [optionMeta, setOptionMeta] = useState({});
  // Shared by BOTH AI panels — they ask for the same location, so typing it in
  // one must fill it in the other. Never persisted; it only shapes AI requests.
  const [aiLocation, setAiLocation] = useState('');
  const details = useOpenDetails();
  const [inputMode, setInputMode] = useState(DEFAULT_INPUT_MODE_ID);
  const [mode, setMode] = useState(DEFAULT_ROOM_MODE);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  // Auth gates AI suggestions only — creating a room and typing options never
  // needs an account (voting stays account-free).
  const { user, authReady } = useAuth();
  const canUseAI = authReady && !!user && (!REQUIRE_EMAIL_VERIFICATION || user.emailVerified);

  function updateOption(index, value) {
    setOptions((opts) => opts.map((o, i) => (i === index ? value : o)));
  }
  function addOption() {
    setOptions((opts) => [...opts, '']);
  }
  function removeOption(index) {
    // Enforce a minimum of 2 options.
    setOptions((opts) => (opts.length <= 2 ? opts : opts.filter((_, i) => i !== index)));
  }

  // Merge AI suggestions into the option rows: fill BLANK rows first, then append
  // new ones. Never overwrites text the user typed, and skips anything that would
  // duplicate an option already present (case-insensitive) or repeats within the
  // incoming batch — the same uniqueness rule handleSubmit enforces.
  function acceptSuggestions(labels, detailsByLabel) {
    // Merge liberally: over-storing detail for a label that turns out to be a
    // duplicate is harmless, because handleSubmit prunes to the final options.
    if (detailsByLabel) setOptionMeta((m) => ({ ...m, ...detailsByLabel }));
    setOptions((opts) => {
      const present = new Set(opts.map((o) => o.trim().toLowerCase()).filter(Boolean));
      const incoming = [];
      for (const raw of labels) {
        const label = (raw || '').trim();
        const key = label.toLowerCase();
        if (label && isValidKey(label) && !present.has(key)) {
          present.add(key);
          incoming.push(label);
        }
      }

      const next = [...opts];
      let qi = 0;
      for (let i = 0; i < next.length && qi < incoming.length; i += 1) {
        if (!next[i].trim()) {
          next[i] = incoming[qi];
          qi += 1;
        }
      }
      while (qi < incoming.length) {
        next.push(incoming[qi]);
        qi += 1;
      }
      return next;
    });
  }

  // Undo an accepted suggestion: drop the row that holds exactly that label
  // (case-insensitive), keeping the form's 2-row minimum so inputs stay visible.
  function removeSuggestion(label) {
    const key = (label || '').trim().toLowerCase();
    if (!key) return;
    setOptions((opts) => {
      const next = opts.filter((o) => o.trim().toLowerCase() !== key);
      while (next.length < 2) next.push('');
      return next;
    });
    return true; // this host always removes — shares SuggestOptions' onRemove contract
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError('');

    const trimmedName = name.trim();
    const trimmedQuestion = question.trim();
    const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);

    if (!trimmedName) return setLocalError('Please enter your name.');
    if (!isValidKey(trimmedName.toLowerCase())) {
      return setLocalError(`Your name can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
    }
    if (!trimmedQuestion) return setLocalError('Please enter a question.');
    if (trimmedOptions.length < 2) return setLocalError('Please enter at least 2 options.');

    // Reject duplicate options (case-insensitive).
    const lowered = trimmedOptions.map((o) => o.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      return setLocalError('Options must be unique.');
    }

    // Option labels are used directly as Firebase keys (optionAuthors[label] and
    // each vote's scores[label]), so reject any that isn't a legal key.
    const badOption = trimmedOptions.find((o) => !isValidKey(o));
    if (badOption) {
      return setLocalError(`Options can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
    }

    setBusy(true);
    try {
      const code = await reserveUniqueCode();
      const createdAt = Date.now();
      const creatorLower = trimmedName.toLowerCase();
      // Credit every seed option to the creator, so each carries their sticker
      // (see optionAuthors in the data model). Ministers who add options later
      // get credited in Room.jsx.
      const optionAuthors = {};
      for (const o of trimmedOptions) optionAuthors[o] = creatorLower;
      // Ship only the detail belonging to options that survived, and omit the key
      // entirely when there is none — a room with no details must look exactly
      // like a room created before the feature existed.
      const meta = {};
      for (const o of trimmedOptions) if (optionMeta[o]) meta[o] = optionMeta[o];
      await set(ref(db, `rooms/${code}`), {
        question: trimmedQuestion,
        options: trimmedOptions,
        optionAuthors, // { optionLabel: lowercasename } — who added each option
        ...(Object.keys(meta).length ? { optionMeta: meta } : {}),
        creatorName: creatorLower, // stored lowercase per spec
        createdAt,
        expiresAt: createdAt + ROOM_TTL_MS,
        closedAt: null,
        inputMode, // how everyone in this room votes; fixed at creation
        mode, // conversation | vote — a president can flip this live
        status: { [creatorLower]: 'president' }, // creator starts as president
      });
      saveIdentity(code, trimmedName);
      navigate(`/room/${code}`);
    } catch (err) {
      setBusy(false);
      onError(err.message || 'Failed to create the room.');
    }
    // note: no setBusy(false) on success — we navigate away.
  }

  return (
    <form className="card panel" onSubmit={handleSubmit}>
      <label className="field">
        <span className="field__label">Your name</span>
        <input
          className="input"
          type="text"
          value={name}
          maxLength={24}
          placeholder="e.g. Alex"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Question</span>
        <input
          className="input"
          type="text"
          value={question}
          maxLength={120}
          placeholder="e.g. Where should we eat tonight?"
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>

      <div className="field">
        <span className="field__label">Options</span>
        <ShowAllDetails
          labels={options.map((o) => o.trim()).filter((o) => optionMeta[o])}
          view={details}
        />
        <div className="option-list">
          {options.map((opt, i) => {
            // Same ⓘ affordance as the room's editor and the ballot, so "this
            // option has AI details" looks identical everywhere. Looked up by the
            // typed text, so it disappears as you rename a row — which is what
            // happens on save, since details are keyed by label.
            const label = opt.trim();
            const detail = optionMeta[label];
            return (
              <div className="option-row" key={i}>
                <span className="option-num" aria-hidden="true">
                  {i + 1}
                </span>
                <input
                  className="input"
                  type="text"
                  value={opt}
                  maxLength={60}
                  placeholder={`Option ${i + 1}`}
                  onChange={(e) => updateOption(i, e.target.value)}
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
                  onClick={() => removeOption(i)}
                  disabled={options.length <= 2}
                  title={options.length <= 2 ? 'At least 2 options required' : 'Remove option'}
                >
                  ✕
                </button>
                {details.isOpen(label) && <OptionDetails detail={detail} />}
              </div>
            );
          })}
        </div>
        {/* "+ Add option" and both AI panels share one row, matching the room's
            options editor. ExpandOptions researches whatever is in the rows right
            now — including options typed by hand, which the suggestion panel never
            sees. Nothing hits Firebase until the room is created. */}
        <div className="options-actions">
          <button type="button" className="btn btn--ghost" onClick={addOption}>
            + Add option
          </button>
          {canUseAI ? (
            <SuggestOptions
              question={question}
              existing={options.map((o) => o.trim()).filter(Boolean)}
              onAccept={acceptSuggestions}
              onRemove={removeSuggestion}
              location={aiLocation}
              onLocationChange={setAiLocation}
            />
          ) : (
            <AuthForm prompt="Sign in to use AI suggestions" />
          )}
          {OPTION_DETAILS_ENABLED && STANDALONE_EXPAND_ENABLED && canUseAI && (
            <ExpandOptions
              question={question}
              options={options.map((o) => o.trim()).filter(Boolean)}
              onDetails={(byLabel) => {
                setOptionMeta((m) => ({ ...m, ...byLabel }));
                return true;
              }}
              location={aiLocation}
              onLocationChange={setAiLocation}
            />
          )}
        </div>
      </div>

      <label className="field">
        <span className="field__label">How people vote</span>
        <select
          className="input"
          value={inputMode}
          onChange={(e) => setInputMode(e.target.value)}
        >
          {INPUT_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="section-note">{getInputMode(inputMode).blurb}</span>
      </label>

      {/* Room-mode picker hidden behind ROOM_MODE_UI_ENABLED. `mode` still
          defaults to DEFAULT_ROOM_MODE (vote) and is written on create, so every
          new room is seeded with that mode — there's just no picker for it. */}
      {ROOM_MODE_UI_ENABLED && (
        <label className="field">
          <span className="field__label">Room mode</span>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {ROOM_MODES.map((id) => (
              <option key={id} value={id}>
                {MODE_META[id].label}
              </option>
            ))}
          </select>
          <span className="section-note">
            {MODE_META[mode].blurb} You can switch anytime as president.
          </span>
        </label>
      )}

      {localError && <p className="inline-error">{localError}</p>}

      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
        {busy ? 'Creating…' : 'Create room'}
      </button>
    </form>
  );
}
