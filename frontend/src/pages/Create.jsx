import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import CreateRoom from '../components/CreateRoom.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

// Dedicated "start a new vote" screen. A thin wrapper: back link + heading +
// the CreateRoom form, which reserves a code, writes the room, and navigates
// straight to /room/:code on success.
export default function Create() {
  const [error, setError] = useState('');
  // The landing hands the typed/remembered name over via router state.
  const location = useLocation();
  const initialName = location.state?.name || '';

  return (
    <div className="page page--create">
      <header className="create-header">
        <Link to="/" className="back-link" aria-label="Back to home">
          ‹
        </Link>
        <h1 className="create-title">New vote</h1>
      </header>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      <div className="create-body">
        <CreateRoom onError={setError} initialName={initialName} />
      </div>
    </div>
  );
}
