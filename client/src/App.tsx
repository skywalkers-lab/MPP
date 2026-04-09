import { Routes, Route, Navigate } from 'react-router-dom';
import RoomsPage from './pages/RoomsPage';
import RoomPage from './pages/RoomPage';
import OpsPage from './pages/OpsPage';
import ArchivesPage from './pages/ArchivesPage';
import OverlayPage from './pages/OverlayPage';
import JoinRedirect from './pages/JoinRedirect';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/rooms" replace />} />
      <Route path="/rooms" element={<RoomsPage />} />
      <Route path="/room/:sessionId" element={<RoomPage />} />
      <Route path="/join/:joinCode" element={<JoinRedirect />} />
      <Route path="/ops" element={<OpsPage />} />
      <Route path="/archives" element={<ArchivesPage />} />
      <Route path="/overlay/:sessionId" element={<OverlayPage />} />
      <Route path="/overlay/join/:joinCode" element={<OverlayPage />} />
      <Route path="/hud/:sessionId" element={<OverlayPage />} />
      <Route path="/hud/join/:joinCode" element={<OverlayPage />} />
      <Route path="/host/:sessionId" element={<Navigate to="/rooms" replace />} />
      <Route path="/viewer/:sessionId" element={<Navigate to="/rooms" replace />} />
    </Routes>
  );
}
