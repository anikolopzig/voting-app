import { useEffect, useRef, useState } from 'react';
import { getParticipantNames } from '../utils/room.js';
import VoterDot from './VoterDot.jsx';
import ParticipantsList from './ParticipantsList.jsx';

// Google-Docs-style presence indicator, pinned to the top-right of the screen:
// a small cluster of overlapping avatar circles + a "+N" overflow chip + a caret.
// Clicking any of them opens the full "In the room" roster (ParticipantsList) as
// a popover. This component owns only the collapsed/expanded chrome — every prop
// is the same one Room.jsx used to pass straight to ParticipantsList, so it just
// forwards them through untouched.

// How many avatars show before the rest collapse into a "+N" chip.
const MAX_VISIBLE = 3;

export default function MemberStack(props) {
  // The Leave button lives in its own pill beside the stack now, NOT inside the
  // roster popover — so keep onLeave out of what we forward to ParticipantsList.
  const { onLeave, ...rosterProps } = props;
  const { creatorName, participants, votes, me, vips } = rosterProps;

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Same people, same order as the roster: creator first, then alphabetical, so
  // the collapsed stack and the expanded panel always agree.
  const names = getParticipantNames({ creatorName, participants, votes });
  names.sort((a, b) => {
    if (a === creatorName) return -1;
    if (b === creatorName) return 1;
    return a.localeCompare(b);
  });

  const visible = names.slice(0, MAX_VISIBLE);
  const overflow = names.length - visible.length;

  // Close on outside click / Escape — listeners live only while open.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = () => setOpen((o) => !o);

  return (
    <div className="member-stack" ref={rootRef}>
      <div className="member-stack__bar">
        {/* Clicking the avatars OR the caret opens the roster. */}
        <button
          type="button"
          className="member-stack__cluster"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`${names.length} in the room — click to see who`}
        >
          {visible.map((name) => (
            <VoterDot
              key={name}
              name={name}
              isMe={name === me}
              isVip={vips?.has(name)}
              voted={votes?.[name]?.submitted === true}
            />
          ))}
          {overflow > 0 && (
            <span className="member-stack__more" aria-hidden="true">
              +{overflow}
            </span>
          )}
        </button>
        <button
          type="button"
          className={'member-stack__toggle' + (open ? ' member-stack__toggle--open' : '')}
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={open ? 'Hide who’s in the room' : 'Show who’s in the room'}
        >
          <span className="member-stack__caret" aria-hidden="true">
            ⌄
          </span>
        </button>
      </div>

      {onLeave && (
        <button type="button" className="member-stack__leave" onClick={onLeave}>
          Leave room
        </button>
      )}

      {open && (
        <div className="member-stack__popover" role="dialog" aria-label="In the room">
          <ParticipantsList {...rosterProps} />
        </div>
      )}
    </div>
  );
}
