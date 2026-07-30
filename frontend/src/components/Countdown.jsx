import { formatDuration } from '../utils/room.js';

// Pure presentational countdown. `remainingMs` is computed by the parent from a
// ticking clock so a single interval drives both this display and expiry logic.
export default function Countdown({ remainingMs }) {
  const urgent = remainingMs <= 60 * 1000; // red styling under 60s
  return (
    <span
      className={`countdown${urgent ? ' countdown--urgent' : ''}`}
      aria-label="Time remaining"
    >
      <span className="countdown__dot" aria-hidden="true" />
      {formatDuration(remainingMs)}
    </span>
  );
}
