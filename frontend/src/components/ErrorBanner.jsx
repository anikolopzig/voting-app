// Small dismissible error banner used for Firebase read/write failures.
export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <span className="error-banner__text">{message}</span>
      <button
        type="button"
        className="error-banner__close"
        onClick={onDismiss}
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
