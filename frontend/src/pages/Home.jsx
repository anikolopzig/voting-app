import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import JoinRoom from '../components/JoinRoom.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

// The landing screen is join-focused: enter a code to join, or head to the
// dedicated create screen. Creating a room lives on its own route (/create).
export default function Home() {
  // Shared banner for unexpected Firebase errors bubbled up from the join form.
  const [error, setError] = useState('');
  // Leaving a room sends us here with the name, so the form starts pre-filled
  // and the "new vote" hand-off carries it onward to the create screen.
  const location = useLocation();
  const navigate = useNavigate();
  const initialName = location.state?.name || '';

  return (
    <div className="page page--home">
      <header className="home-header">
        <h1 className="brand">GroupVote</h1>
        <p className="tagline">
          Rate every option 1–10. See the best outcome for the group, live.
        </p>
      </header>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="landing">
        <JoinRoom onError={setError} initialName={initialName} />

        <div className="or-divider">
          <span>or</span>
        </div>

        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => navigate('/create', { state: { name: initialName } })}
        >
          Start a new vote
        </button>
      </div>

      <footer className="home-footer">
        <p>Rooms expire 15 minutes after they are created.</p>
      </footer>
    </div>
  );
}
