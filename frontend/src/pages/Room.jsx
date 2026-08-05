import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ref, onValue, set, update, remove, onDisconnect } from 'firebase/database';
import { db } from '../firebase.js';
import { getIdentity, clearIdentity } from '../utils/storage.js';
import { isRoomClosed, CLOSE_UNLOCK_MS, getVipNames } from '../utils/room.js';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Countdown from '../components/Countdown.jsx';
import VotingSection from '../components/VotingSection.jsx';
import ResultsSection from '../components/ResultsSection.jsx';
import MemberStack from '../components/MemberStack.jsx';
import AuthPill from '../components/AuthPill.jsx';
import ModeToggle from '../components/ModeToggle.jsx';
import OptionsEditor from '../components/OptionsEditor.jsx';
import SuggestOptions from '../components/SuggestOptions.jsx';
import ExpandOptions from '../components/ExpandOptions.jsx';
import AuthForm from '../components/AuthForm.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { DEFAULT_METHOD_ID } from '../utils/scoring.js';
import {
  getMode,
  roleOf,
  isPresident,
  canManageRoom,
  canEditOptions,
  canChangeRole,
} from '../utils/roles.js';
import {
  ROOM_MODE_UI_ENABLED,
  REQUIRE_EMAIL_VERIFICATION,
  OPTION_DETAILS_ENABLED,
  STANDALONE_EXPAND_ENABLED,
} from '../utils/flags.js';
import { isValidKey } from '../utils/keys.js';
import { sanitizeMetaMap } from '../utils/optionMeta.js';

export default function Room() {
  const { code } = useParams();
  const roomCode = (code || '').toUpperCase();
  const navigate = useNavigate();
  const identity = getIdentity(roomCode); // lowercase name, or null
  // Auth is SEPARATE from voting identity: it only unlocks AI suggestions.
  const { user, authReady } = useAuth();
  const canUseAI = authReady && !!user && (!REQUIRE_EMAIL_VERIFICATION || user.emailVerified);

  const [room, setRoom] = useState(undefined); // undefined = loading, null = missing
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  // Which evaluator method this viewer sees. Local only — no Firebase write.
  const [methodId, setMethodId] = useState(DEFAULT_METHOD_ID);
  // Roster name being hovered; lifted here so the sidebar can highlight that
  // person's vote dots over in the results column. Local, never persisted.
  const [hoveredName, setHoveredName] = useState(null);
  // Shared by BOTH AI panels — they ask for the same location, so typing it in
  // one must fill it in the other. Local only, never written to the room.
  const [aiLocation, setAiLocation] = useState('');

  // Someone opened the URL without joining -> send them home to join properly.
  useEffect(() => {
    if (!identity) navigate('/', { replace: true });
  }, [identity, navigate]);

  // ONE live listener for all room state (votes + closedAt). No polling.
  useEffect(() => {
    if (!identity) return undefined;
    const roomRef = ref(db, `rooms/${roomCode}`);
    const unsubscribe = onValue(
      roomRef,
      (snap) => setRoom(snap.exists() ? snap.val() : null),
      (err) => setError(err.message || 'Lost connection to the room.')
    );
    return () => unsubscribe();
  }, [roomCode, identity]);

  // Ticking clock: drives the countdown AND flips the UI to "ended" at expiry.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Presence: register once the room exists, and CLEAN UP on the way out so the
  // roster reflects who's actually here. Depends on a boolean (not the `room`
  // object, which changes on every vote) so it runs once — on the load edge.
  //   - onDisconnect().remove(): the server drops our entry if the socket dies
  //     (tab closed, laptop asleep, network lost).
  //   - unmount cleanup: SPA navigation (e.g. the browser back button) keeps the
  //     socket alive, so onDisconnect never fires — remove it ourselves here.
  // A person's SUBMITTED vote is intentionally left untouched: it still counts,
  // and they'll keep showing in the roster via that vote until they explicitly
  // leave. Only fully leaving (the Leave button) removes the vote too.
  const roomLoaded = room != null;
  useEffect(() => {
    if (!identity || !roomLoaded) return undefined;
    const meRef = ref(db, `rooms/${roomCode}/participants/${identity}`);
    set(meRef, true).catch(() => {
      // Non-fatal — the roster just won't include people who never voted.
    });
    const disconnect = onDisconnect(meRef);
    disconnect.remove().catch(() => {});
    return () => {
      disconnect.cancel().catch(() => {});
      remove(meRef).catch(() => {});
    };
  }, [identity, roomLoaded, roomCode]);

  const ended = useMemo(() => isRoomClosed(room, now), [room, now]);
  // The room's VIPs (votes count double). Memoized off `room` so the Set stays
  // stable across the 1s clock ticks — keeps ResultsSection's useMemo from
  // recomputing every second.
  const vips = useMemo(() => getVipNames(room), [room]);
  // AI option details, sanitized ONCE here so no component ever touches the raw
  // node. The RTDB rules are open, so anyone with the room code can write
  // whatever they like to optionMeta — this is the trust boundary, not the Cloud
  // Function. Also drops meta for labels that are no longer options.
  const optionMeta = useMemo(
    () => (OPTION_DETAILS_ENABLED ? sanitizeMetaMap(room?.optionMeta, room?.options) : null),
    [room?.optionMeta, room?.options],
  );

  // --- Firebase writes (guarded so a failure shows a banner, never crashes) ---
  async function submitVotes(scores) {
    try {
      await set(ref(db, `rooms/${roomCode}/votes/${identity}`), { scores, submitted: true });
    } catch (err) {
      setError(err.message || 'Failed to submit your votes.');
      throw err; // let VotingSection keep the ballot editable so the user can retry
    }
  }
  async function editVotes(scores) {
    try {
      // Keep the scores but mark unsubmitted so they stop counting in results.
      await set(ref(db, `rooms/${roomCode}/votes/${identity}`), { scores, submitted: false });
    } catch (err) {
      setError(err.message || 'Failed to update your votes.');
      throw err; // let VotingSection stay in its current mode so the user can retry
    }
  }
  async function closePoll() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Close the poll now? Voters will no longer be able to change their votes.')) {
      return;
    }
    try {
      await update(ref(db, `rooms/${roomCode}`), { closedAt: Date.now() });
    } catch (err) {
      setError(err.message || 'Failed to close the poll.');
    }
  }

  async function addVip(name) {
    // President-only; `name` is a lowercase participant name. Rooms can have
    // several VIPs — write into the `vips` map so the double-weight applies for
    // everyone via onValue. Room-wide, so everyone sees the same weighting.
    if (!canManageRoom(room, identity)) return;
    try {
      await update(ref(db, `rooms/${roomCode}`), { [`vips/${name}`]: true });
    } catch (err) {
      setError(err.message || 'Failed to update the VIP.');
    }
  }
  async function removeVip(name) {
    // President-only. Drop them from the `vips` map; also clear the legacy single
    // `vip` field if this room predates the multi-VIP map and it names this person.
    if (!canManageRoom(room, identity)) return;
    const updates = { [`vips/${name}`]: null };
    if (room.vip === name) updates.vip = null;
    try {
      await update(ref(db, `rooms/${roomCode}`), updates);
    } catch (err) {
      setError(err.message || 'Failed to update the VIP.');
    }
  }

  async function setMode(nextMode) {
    // President-only. Switching modes RESETS every non-president to the mode's
    // default role: we just clear their explicit `status` overrides, and roleOf
    // falls them back to minister (conversation) or voter (vote). Presidents are
    // untouched — they can't be demoted. One atomic multi-path update.
    if (!canManageRoom(room, identity)) return;
    const updates = { mode: nextMode };
    for (const [name, role] of Object.entries(room.status || {})) {
      if (role !== 'president') updates[`status/${name}`] = null;
    }
    try {
      await update(ref(db, `rooms/${roomCode}`), updates);
    } catch (err) {
      setError(err.message || 'Failed to change the room mode.');
    }
  }

  async function setRole(name, role) {
    // President-only, and never on another president (can't demote presidents).
    if (!canChangeRole(room, identity, name)) return;
    try {
      await update(ref(db, `rooms/${roomCode}/status`), { [name]: role });
    } catch (err) {
      setError(err.message || 'Failed to change the role.');
    }
  }
  // Click the badge to toggle the reversible pair (voter <-> minister).
  function cycleRole(name) {
    const current = roleOf(room, name);
    setRole(name, current === 'voter' ? 'minister' : 'voter');
  }
  // Promotion to president is irreversible (presidents can't be demoted), so it
  // gets its own confirmed action rather than sitting in the click cycle.
  function promoteToPresident(name) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Make ${name} a president? Presidents can end the vote, change roles and the mode — and can’t be demoted.`)) {
      return;
    }
    setRole(name, 'president');
  }

  // Rebuild the authorship map for a new option array: surviving labels keep
  // their original author, brand-new labels are credited to whoever's editing,
  // and removed labels drop out (the fresh object replaces the old node).
  function authorsFor(nextOptions) {
    const prev = room.optionAuthors || {};
    const authors = {};
    for (const label of nextOptions) authors[label] = prev[label] || identity;
    return authors;
  }

  // Same idea for AI details: surviving labels keep theirs, removed ones drop
  // out. Returns null when the room has no details at all, so we omit the key
  // entirely rather than writing an empty node onto a room that never had one.
  // NOTE a rename loses an option's details — exactly as it already loses that
  // option's author and everyone's scores, since the label IS the key.
  function metaFor(nextOptions) {
    const prev = room.optionMeta;
    if (!prev) return null;
    const meta = {};
    for (const label of nextOptions) if (prev[label]) meta[label] = prev[label];
    return meta;
  }

  async function saveOptions(nextOptions) {
    if (!canEditOptions(room, identity)) return;
    try {
      const updates = {
        options: nextOptions,
        optionAuthors: authorsFor(nextOptions),
      };
      const meta = metaFor(nextOptions);
      if (meta) updates.optionMeta = meta;
      await update(ref(db, `rooms/${roomCode}`), updates);
    } catch (err) {
      setError(err.message || 'Failed to update the options.');
    }
  }

  // Attach AI-researched detail to options that already exist. Writes ONLY
  // optionMeta/{label} paths — never `options` — so the ballot does not remount
  // (VotingSection is keyed on room.options.join('|')) and nobody loses the
  // slider positions they were part-way through setting.
  async function applyOptionDetails(detailsByLabel) {
    if (!canEditOptions(room, identity)) return false;
    const live = new Set(room.options || []);
    const updates = {};
    for (const [label, detail] of Object.entries(detailsByLabel)) {
      // An option removed while the request was in flight must not come back.
      if (live.has(label)) updates[`optionMeta/${label}`] = detail;
    }
    if (!Object.keys(updates).length) return false;
    try {
      await update(ref(db, `rooms/${roomCode}`), updates);
      return true;
    } catch (err) {
      setError(err.message || 'Failed to save the option details.');
      return false;
    }
  }

  // AI suggestions, in-room: accepting appends the new labels (crediting the
  // person who accepted); rejecting one they'd accepted pulls it back out.
  // Same capability gate as manual editing — only ministers+ ever see the panel.
  // `detailsByLabel` is optional: present when the suggestion was expanded before
  // being accepted, so its researched detail lands with it in one write.
  async function acceptSuggestions(labels, detailsByLabel) {
    if (!canEditOptions(room, identity)) return;
    const current = room.options || [];
    const present = new Set(current.map((o) => o.trim().toLowerCase()));
    const toAdd = [];
    for (const raw of labels) {
      const label = (raw || '').trim();
      const key = label.toLowerCase();
      if (label && isValidKey(label) && !present.has(key)) {
        present.add(key);
        toAdd.push(label);
      }
    }
    if (!toAdd.length) return; // all duplicates — nothing to write
    const next = [...current, ...toAdd];
    try {
      const updates = {
        options: next,
        optionAuthors: authorsFor(next),
      };
      // Path-scoped, so this only ADDS meta for the new labels and leaves every
      // existing entry alone. Mixing these with a whole-object `optionMeta` key
      // in the same call is not allowed — RTDB rejects overlapping paths.
      for (const label of toAdd) {
        if (detailsByLabel?.[label]) updates[`optionMeta/${label}`] = detailsByLabel[label];
      }
      await update(ref(db, `rooms/${roomCode}`), updates);
    } catch (err) {
      setError(err.message || 'Failed to add the option.');
    }
  }
  async function removeSuggestion(label) {
    if (!canEditOptions(room, identity)) return false;
    const key = (label || '').trim().toLowerCase();
    const current = room.options || [];
    const next = current.filter((o) => o.trim().toLowerCase() !== key);
    if (next.length === current.length) return false; // wasn't in the list
    if (next.length < 2) {
      setError('A room needs at least 2 options.');
      return false;
    }
    try {
      const updates = {
        options: next,
        optionAuthors: authorsFor(next),
      };
      const meta = metaFor(next);
      if (meta) updates.optionMeta = meta;
      await update(ref(db, `rooms/${roomCode}`), updates);
      return true;
    } catch (err) {
      setError(err.message || 'Failed to remove the option.');
      return false;
    }
  }

  async function leaveRoom() {
    // Fully withdraw: drop presence AND any vote so this person disappears from
    // the roster and results for everyone. Best-effort — if the write fails we
    // still leave (the unmount cleanup removes presence as a backstop).
    try {
      await update(ref(db, `rooms/${roomCode}`), {
        [`participants/${identity}`]: null,
        [`votes/${identity}`]: null,
      });
    } catch {
      // Non-fatal — go home regardless.
    }
    // Forget the identity so revisiting the URL asks them to join again rather
    // than silently re-registering presence.
    clearIdentity(roomCode);
    // Home pre-fills the create/join forms from this name.
    navigate('/', { state: { name: identity } });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy — please copy the code manually.');
    }
  }

  // Redirecting; render nothing to avoid a flash.
  if (!identity) return null;

  if (room === undefined) {
    return (
      <div className="page page--room">
        <p className="loading">Loading room…</p>
      </div>
    );
  }

  if (room === null) {
    return (
      <div className="page page--room">
        <div className="card notfound">
          <h2>Room not found</h2>
          <p>This room code doesn’t exist or was removed.</p>
          <Link className="btn btn--primary" to="/">
            Back home
          </Link>
        </div>
      </div>
    );
  }

  const votes = room.votes || {};
  const expiresAt = Number(room.expiresAt);
  const remainingMs = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - now) : 0;
  const canCloseAt = room.createdAt + CLOSE_UNLOCK_MS;
  const closeUnlocked = now >= canCloseAt;
  const closeCountdownS = Math.ceil((canCloseAt - now) / 1000);
  const myVote = votes[identity] || null;

  // Role-derived capabilities for this viewer.
  const mode = getMode(room);
  const iAmPresident = isPresident(room, identity); // end vote, VIP, mode, roles
  const iCanEditOptions = canEditOptions(room, identity) && !ended;

  return (
    <div className="page page--room">
      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Full-width white bar pinned to the top of the page (position:fixed), so
          it stays put on scroll. Hosts the presence stack + Leave button, right-
          aligned; the roster opens as a popover under the stack. */}
      <header className="room-topbar">
        <AuthPill />
        <MemberStack
          creatorName={room.creatorName}
          participants={room.participants}
          votes={votes}
          status={room.status}
          mode={mode}
          me={identity}
          vips={vips}
          canManageVip={iAmPresident && !ended}
          canManageRoles={iAmPresident && !ended}
          onAddVip={addVip}
          onRemoveVip={removeVip}
          onCycleRole={cycleRole}
          onPromotePresident={promoteToPresident}
          onHoverName={setHoveredName}
          onLeave={leaveRoom}
        />
      </header>

      <div className="room-layout">
        <div className="room-main">
          <header className="room-header card">
            <h1 className="room-question">{room.question}</h1>
            <div className="room-header__row">
              <button
                type="button"
                className="code-chip"
                onClick={copyCode}
                title="Copy room code"
              >
                <span className="code-chip__code">{roomCode}</span>
                <span className="code-chip__action">{copied ? 'Copied!' : 'Copy code'}</span>
              </button>
              {ended ? (
                <span className="countdown countdown--ended">Ended</span>
              ) : (
                <Countdown remainingMs={remainingMs} />
              )}
            </div>
            {/* Only presidents can change the room mode, so only presidents see
                the bar (hidden once ended, when even they can't change it) —
                don't show a control nobody in the room can interact with.
                Currently hidden entirely behind ROOM_MODE_UI_ENABLED (feature
                flag); the mode logic still runs, only the control is gone. */}
            {ROOM_MODE_UI_ENABLED && iAmPresident && !ended && (
              <ModeToggle value={mode} canChange onChange={setMode} />
            )}
          </header>

          {/* Ministers + presidents get a live editor for the shared options.
              No `key` here: it must NOT share VotingSection's option-set key, or
              the two siblings collide and React duplicates/drops them. The editor
              re-seeds itself from props via an effect instead. */}
          {/* Both AI panels live INSIDE the editor, in a row with "+ Add option",
              so every way of adding or enriching an option is in one place.
              Offered to anyone who may edit options (ministers + presidents) —
              voters see neither, same as the editor itself. Gated behind sign-in:
              verified editors get the panels, others get the inline sign-in
              affordance in place of the first (voting still needs no account).
              "Expand with AI" has no AuthForm fallback of its own — one sign-in
              card is enough, and we hide controls a member can't use. */}
          {iCanEditOptions && (
            <OptionsEditor
              options={room.options}
              onSave={saveOptions}
              optionMeta={optionMeta}
              actions={
                <>
                  {canUseAI ? (
                    <SuggestOptions
                      question={room.question}
                      existing={room.options}
                      onAccept={acceptSuggestions}
                      onRemove={removeSuggestion}
                      location={aiLocation}
                      onLocationChange={setAiLocation}
                    />
                  ) : (
                    <AuthForm prompt="Sign in to use AI suggestions" />
                  )}
                  {OPTION_DETAILS_ENABLED && STANDALONE_EXPAND_ENABLED && canUseAI && !ended && (
                    <ExpandOptions
                      question={room.question}
                      options={room.options}
                      onDetails={applyOptionDetails}
                      location={aiLocation}
                      onLocationChange={setAiLocation}
                    />
                  )}
                </>
              }
            />
          )}

          {/* key remounts the voter UI if the option set ever changes. Note that
              expanding details writes only optionMeta/*, so it deliberately does
              NOT remount and does not disturb an in-progress ballot. */}
          <VotingSection
            key={room.options.join('|')}
            options={room.options}
            optionAuthors={room.optionAuthors || null}
            optionMeta={optionMeta}
            me={identity}
            myVote={myVote}
            ended={ended}
            onSubmit={submitVotes}
            onEdit={editVotes}
            inputMode={room.inputMode}
          />

          <ResultsSection
            options={room.options}
            votes={votes}
            participants={room.participants}
            creatorName={room.creatorName}
            ended={ended}
            methodId={methodId}
            onMethodChange={setMethodId}
            vips={vips}
            me={identity}
            highlightName={hoveredName}
            optionMeta={optionMeta}
          />

          {iAmPresident && !ended && (
            <section className="card creator-controls">
              <button
                type="button"
                className="btn btn--danger btn--block"
                onClick={closePoll}
                disabled={!closeUnlocked}
                title={
                  closeUnlocked
                    ? 'Close the poll for everyone'
                    : `You can close the poll in ${closeCountdownS}s`
                }
              >
                {closeUnlocked ? 'Close Poll' : `Close Poll (in ${closeCountdownS}s)`}
              </button>
              <p className="section-note">
                As a president you can end voting early. Available 3 minutes after creation.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
