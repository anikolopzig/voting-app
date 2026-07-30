import { useState } from 'react';
import { getParticipantNames } from '../utils/room.js';
import { roleOf, ROLE_META } from '../utils/roles.js';
import VoterDot from './VoterDot.jsx';

// Vertical roster of everyone in the room. Each person's voting status shows as a
// small emoji badge tucked into the bottom-right corner of their avatar dot (the
// word shows on hover), keeping the row uncluttered:
//   💭 deciding — hasn't voted yet · ✏️ editing their vote · ✅ voted (submitted).
//
// "Everyone in the room" = the creator + anyone who registered presence on entry
// + anyone who has a vote entry (presence is written in Room.jsx on room load).
// Status comes from the vote entry, which only exists once a person has acted:
//   no entry        -> deciding            (💭)
//   submitted:false -> submitted then editing again, not counting (✏️)
//   submitted:true  -> counting (✅)
//
// President-only VIP: a room can have SEVERAL VIPs (each vote counts double, see
// ResultsSection). The pill hosts a reusable source badge — drag it onto a name
// to add that person; each VIP also gets their own badge, which drags back onto
// the pill to remove just them. `vips` is room-wide state, so the weighting is
// the same for everyone; non-presidents just see the badges as read-only markers.

const STATUS = {
  none: { tag: 'Deciding', emoji: '💭', cls: 'status-emoji--none' },
  editing: { tag: 'Editing', emoji: '✏️', cls: 'status-emoji--editing' },
  voted: { tag: 'Voted', emoji: '✅', cls: 'status-emoji--voted' },
};

function statusFor(vote) {
  if (vote?.submitted === true) return STATUS.voted;
  if (vote) return STATUS.editing;
  return STATUS.none;
}

const PILL = '__pill__'; // sentinel drop target: dropping a VIP's badge here removes them
const SOURCE = '__source__'; // drag payload for the pill's reusable "add a VIP" badge

export default function ParticipantsList({
  creatorName,
  participants,
  votes,
  status,
  mode,
  me,
  vips,
  canManageVip,
  canManageRoles,
  onAddVip,
  onRemoveVip,
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

  // A ★ VIP badge, draggable only while the president can manage VIPs. `dragValue`
  // is what a drop reads: SOURCE for the pill's reusable add-badge (drop on a name
  // to add them), or a person's name for their own badge (drop on the pill to
  // remove them).
  function vipBadge(dragValue) {
    const isSource = dragValue === SOURCE;
    return (
      <span
        className="vip-badge"
        draggable={canManageVip}
        onDragStart={
          canManageVip
            ? (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragValue); // Firefox needs data set
              }
            : undefined
        }
        onDragEnd={canManageVip ? () => setDropTarget(null) : undefined}
        title={
          canManageVip
            ? isSource
              ? 'Drag onto a name to make them a VIP (their vote counts double)'
              : 'Drag back to the box to remove this VIP'
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
        onDropHere(e.dataTransfer.getData('text/plain')); // the dragged payload
      },
    };
  }

  return (
    <aside className="card participants">
      <h2 className="section-title">In the room</h2>
      <ul className="participant-list">
        {names.map((name) => {
          const { tag, emoji, cls } = statusFor(votes?.[name]);
          const isVip = vips.has(name);
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
                // Dropping any ★ badge on a name adds that person as a VIP.
                if (!vips.has(name)) onAddVip(name);
              })}
            >
              <span className="participant-avatar">
                <VoterDot name={name} isMe={name === me} isVip={isVip} voted={hasVoted} />
                <span
                  className={`status-emoji ${cls}`}
                  role="img"
                  title={tag}
                  aria-label={`${name} — ${tag}`}
                >
                  {emoji}
                </span>
              </span>
              <span className="participant-name">{name}</span>
              {name === me && <span className="participant-you">you</span>}
              {roleChip(name)}
              {isVip && vipBadge(name)}
            </li>
          );
        })}
      </ul>

      {canManageVip && (
        <div
          className={'vip-pill' + (dropTarget === PILL ? ' vip-pill--drop' : '')}
          {...dropProps(PILL, (dragged) => {
            // A person's badge dropped here removes just them; the source is a no-op.
            if (dragged && dragged !== SOURCE) onRemoveVip(dragged);
          })}
        >
          <span className="vip-pill__text">
            Anyone celebrating? Make them a VIP to double their vote.
            {vips.size > 0 && <span className="vip-pill__hint"> — drag ★ back here to remove</span>}
          </span>
          {vipBadge(SOURCE)}
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
