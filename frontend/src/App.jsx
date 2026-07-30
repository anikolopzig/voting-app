import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Create from './pages/Create.jsx';
import Room from './pages/Room.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<Create />} />
      <Route path="/room/:code" element={<Room />} />
      {/* Anything else -> home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
