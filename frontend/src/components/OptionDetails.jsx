import { useState } from 'react';
import { mapsUrlFor, hostLabel } from '../utils/optionMeta.js';

// Which options currently have their detail expanded. A SET, not a single label:
// "show all" is only meaningful if more than one can be open at once, and letting
// people pin two rows open to compare them is the point of the feature.
// Shared by every surface that lists options (create form, options editor,
// ballot, results) so expanding behaves identically in all of them.
export function useOpenDetails() {
  const [open, setOpen] = useState(() => new Set());
  return {
    isOpen: (label) => open.has(label),
    toggle: (label) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      }),
    openAll: (labels) => setOpen(new Set(labels)),
    closeAll: () => setOpen(new Set()),
  };
}

// "Show all option details" — sits above an option list and expands every ⓘ at
// once. Renders nothing when no option has details, so a room that was never
// expanded looks exactly as it did before the feature existed. The count doubles
// as an at-a-glance answer to "how many of these actually have details?".
export function ShowAllDetails({ labels, view }) {
  if (!labels.length) return null;
  const allOpen = labels.every((label) => view.isOpen(label));
  return (
    <button
      type="button"
      className="btn btn--ghost details-all"
      onClick={() => (allOpen ? view.closeAll() : view.openAll(labels))}
      aria-expanded={allOpen}
    >
      {allOpen ? '▴ Hide all option details' : `ⓘ Show all option details (${labels.length})`}
    </button>
  );
}

// The one renderer for an option's AI-researched detail, shared by the ballot,
// the results and the AI suggestion panel.
//
// `detail` must ALREADY be sanitized (utils/optionMeta.js sanitizeDetail) — the
// caller owns that, so there is a single audit point rather than one per surface.
// Every field is optional and absent fields render nothing at all: a specific
// venue shows a website + map, a general concept shows a picture, and an option
// nothing was found for renders no detail block whatsoever.
export default function OptionDetails({ detail }) {
  if (!detail) return null;

  const mapsUrl = mapsUrlFor(detail.place);

  return (
    // draggable={false} matters: this block sits inside the draggable .rank-card
    // <li>, and a browser natively drags images/links — which would hijack the
    // ranked-choice reorder drag.
    <div className="option-detail" draggable={false}>
      {detail.image && (
        <img
          className="option-detail__thumb"
          src={detail.image.url}
          alt={detail.image.alt || ''}
          title={detail.image.credit || undefined}
          width="44"
          height="44"
          loading="lazy"
          decoding="async"
          draggable={false}
          // The room URL IS the access credential — don't ship it to third parties.
          referrerPolicy="no-referrer"
        />
      )}
      <div className="option-detail__text">
        {detail.summary && <span className="option-detail__summary">{detail.summary}</span>}
        {detail.place?.address && (
          <span className="option-detail__addr">📍 {detail.place.address}</span>
        )}
        {(detail.link || mapsUrl) && (
          <div className="option-detail__chips">
            {detail.link && (
              <a
                className="option-chip"
                href={detail.link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                referrerPolicy="no-referrer"
                draggable={false}
                title={detail.link.url}
              >
                {/* The visible text is the real hostname, never the model's own
                    title — a link claiming to be "Official site" while pointing at
                    evil.example must read as evil.example. */}
                🔗 {hostLabel(detail.link.url)} ↗
              </a>
            )}
            {mapsUrl && (
              <a
                className="option-chip"
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                referrerPolicy="no-referrer"
                draggable={false}
                title={detail.place.address}
              >
                📍 Map ↗
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
