import { useState } from 'react';
import { getParticipantNames } from '../utils/room.js';
import { roleOf, ROLE_META } from '../utils/roles.js';
import VoterDot from './VoterDot.jsx';

// Vertical roster of everyone in the room, each with a status emoji:
//   📄 hasn't voted yet · ✏️ editing their vote · ✅ submitted their vote.
//
// "Everyone in the room" = the creator + anyone who registered presence on entry
// + anyone who has a vote entry (presence is written in Room.jsx on room load).
// Status comes from the vote entry, which only exists once a person has acted:
//   no entry        -> hasn't voted        (📄)
//   submitted:false -> submitted then editing again, not counting (✏️)
//   submitted:true  -> counting (✅)
//
// Creator-only VIP: a single draggable badge. It lives in the pill when nobody
// is VIP and next to the VIP's name once assigned. Dropping it on a name makes
// them VIP (their vote counts double, see ResultsSection); dropping it back on
// the pill clears it. `vip` is room-wide state, so the weighting is the same for
// everyone; non-creators just see the badge as a read-only marker.

const STATUS = {
  none: { tag: 'Deciding', cls: 'status-tag--none', label: 'has not voted yet' },
  editing: { tag: 'Editing', cls: 'status-tag--editing', label: 'is editing their vote' },
  voted: { tag: 'Voted', cls: 'status-tag--voted', label: 'has submitted their vote' },
};

function statusFor(vote) {
  if (vote?.submitted === true) return STATUS.voted;
  if (vote) return STATUS.editing;
  return STATUS.none;
}

const PILL = '__pill__'; // sentinel drop target: dropping here clears the VIP

export default function ParticipantsList({
  creatorName,
  participants,
  votes,
  status,
  mode,
  me,
  vip,
  canManageVip,
  canManageRoles,
  onSetVip,
  onCycleRole,
  onPromotePresident,
  onHoverName,
  onLeave,
}) {
  // Which drop target the badge is hovering over (a name or PILL), for styling.
  const [dropTarget, setDropTarget] = useState(null);

  // Minimal room shape for roleOf (creator fallback + mode default + overrides).
  const roomLite = { creatorName, status, mode };
  const names = getParticipantNames({ creatorName, participants, votes });
  // Creator first, then alphabetical — stable and predictable.
  names.sort((a, b) => {
    if (a === creatorName) return -1;
    if (b === creatorName) return 1;
    return a.localeCompare(b);
  });

  // The single VIP badge. Draggable only while the creator can manage it.
  function vipBadge() {
    return (
      <span
        className="vip-badge"
        draggable={canManageVip}
        onDragStart={
          canManageVip
            ? (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'vip'); // Firefox needs data set
              }
            : undefined
        }
        onDragEnd={canManageVip ? () => setDropTarget(null) : undefined}
        title={
          canManageVip
            ? 'Drag onto a name to make them a VIP (their vote counts double)'
            : 'VIP — this vote counts double'
        }
      >
        ★ VIP
      </span>
    );
  }

  // Per-person role chip. Presidents get an interactive chip on non-presidents:
  // click toggles Voter<->Minister; the 👑 button promotes to president (which
  // is irreversible, so Room.jsx confirms it). Presidents (incl. yourself) show
  // a locked chip. Non-presidents just read others' roles; the default "Voter"
  // is hidden for them to keep the roster quiet.
  function roleChip(name) {
    const role = roleOf(roomLite, name);
    const meta = ROLE_META[role];
    const canChangeThis = canManageRoles && name !== me && role !== 'president';
    if (!canChangeThis && !canManageRoles && role === 'voter') return null;
    const text = `${meta.emoji ? `${meta.emoji} ` : ''}${meta.label}`;
    const cls = `role-pill role-pill--${role}`;
    if (!canChangeThis) {
      return (
        <span
          className={`${cls} role-pill--static`}
          title={role === 'president' ? 'President — can’t be demoted' : meta.label}
        >
          {text}
        </span>
      );
    }
    return (
      <span className="role-controls">
        <button
          type="button"
          className={cls}
          onClick={() => onCycleRole(name)}
          title="Click to switch between Voter and Minister"
        >
          {text}
        </button>
        <button
          type="button"
          className="role-promote"
          onClick={() => onPromotePresident(name)}
          title="Make president (can’t be undone)"
          aria-label={`Make ${name} a president`}
        >
          👑
        </button>
      </span>
    );
  }

  // Drop wiring for a target; a no-op object when the creator can't manage VIP.
  function dropProps(target, onDropHere) {
    if (!canManageVip) return {};
    return {
      onDragOver: (e) => {
        e.preventDefault(); // allow dropping
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(target);
      },
      onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
      onDrop: (e) => {
        e.preventDefault();
        setDropTarget(null);
        onDropHere();
      },
    };
  }

  return (
    <aside className="card participants">
      <h2 className="section-title">In the room</h2>
      <ul className="participant-list">
        {names.map((name) => {
          const { tag, cls, label } = statusFor(votes?.[name]);
          const isVip = vip === name;
          const hasVoted = votes?.[name]?.submitted === true;
          return (
            <li
              className={
                'participant-row' +
                (isVip ? ' participant-row--vip' : '') +
                (dropTarget === name ? ' participant-row--drop' : '')
              }
              key={name}
              // Hovering a name highlights that person's dots on every bar.
              onMouseEnter={() => onHoverName?.(name)}
              onMouseLeave={() => onHoverName?.(null)}
              onFocus={() => onHoverName?.(name)}
              onBlur={() => onHoverName?.(null)}
              {...dropProps(name, () => {
                if (vip !== name) onSetVip(name);
              })}
            >
              <VoterDot name={name} isMe={name === me} isVip={isVip} voted={hasVoted} />
              <span className="participant-name">{name}</span>
              {name === me && <span className="participant-you">you</span>}
              <span className={`status-tag ${cls}`} title={`${name} ${label}`}>
                {tag}
              </span>
              {roleChip(name)}
              {isVip && vipBadge()}
            </li>
          );
        })}
      </ul>

      {canManageVip && (
        <div
          className={'vip-pill' + (dropTarget === PILL ? ' vip-pill--drop' : '')}
          {...dropProps(PILL, () => {
            if (vip) onSetVip(null);
          })}
        >
          <span className="vip-pill__text">
            Is someone more equal than the rest? Make them a VIP
            {vip && <span className="vip-pill__hint"> — drag ★ back here to remove</span>}
          </span>
          {!vip && vipBadge()}
        </div>
      )}

      {onLeave && (
        <button
          type="button"
          className="btn btn--block participants__leave"
          onClick={onLeave}
        >
          Leave room
        </button>
      )}
    </aside>
  );
}
