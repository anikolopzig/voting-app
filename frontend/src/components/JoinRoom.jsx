import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, get } from 'firebase/database';
import { db } from '../firebase.js';
import { saveIdentity } from '../utils/storage.js';
import { isRoomClosed, getParticipantNames } from '../utils/room.js';
import { isValidKey, FORBIDDEN_KEY_HINT } from '../utils/keys.js';

export default function JoinRoom({ onError, initialName = '' }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState(initialName);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError('');

    const roomCode = code.trim().toUpperCase(); // lookup is case-insensitive
    const trimmedName = name.trim();

    if (!roomCode) return setLocalError('Please enter a room code.');
    if (!trimmedName) return setLocalError('Please enter your name.');

    setBusy(true);
    try {
      const snap = await get(ref(db, `rooms/${roomCode}`));
      if (!snap.exists()) {
        setBusy(false);
        return setLocalError('Room not found.');
      }

      const room = snap.val();
      if (isRoomClosed(room)) {
        setBusy(false);
        return setLocalError('This room has closed.');
      }

      const lowerName = trimmedName.toLowerCase();
      if (!isValidKey(lowerName)) {
        setBusy(false);
        return setLocalError(`Your name can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
      }
      // Reserve any name already in the room — creator, present-but-not-voted, or
      // voted — not just names that already have a vote entry.
      if (getParticipantNames(room).includes(lowerName)) {
        setBusy(false);
        return setLocalError('That name is already taken in this room.');
      }

      saveIdentity(roomCode, trimmedName);
      navigate(`/room/${roomCode}`);
    } catch (err) {
      setBusy(false);
      onError(err.message || 'Failed to join the room.');
    }
  }

  return (
    <form className="card panel" onSubmit={handleSubmit}>
      <h2 className="panel__title">Join a room</h2>

      <label className="field">
        <span className="field__label">Room code</span>
        <input
          className="input input--code"
          type="text"
          value={code}
          maxLength={6}
          placeholder="ABC123"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </label>

      <label className="field">
        <span className="field__label">Your name</span>
        <input
          className="input"
          type="text"
          value={name}
          maxLength={24}
          placeholder="e.g. Sam"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {localError && <p className="inline-error">{localError}</p>}

      <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
        {busy ? 'Joining…' : 'Join room'}
      </button>
    </form>
  );
}
