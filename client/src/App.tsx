import { Routes, Route, Navigate } from 'react-router-dom';
import RoomsPage from './pages/RoomsPage';
import HostPage from './pages/HostPage';
import ViewerPage from './pages/ViewerPage';
import OpsPage from './pages/OpsPage';
import OverlayPage from './pages/OverlayPage';
import ArchivesPage from './pages/ArchivesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/rooms" replace />} />
      <Route path="/rooms" element={<RoomsPage />} />
      <Route path="/host/:sessionId" element={<HostPage />} />
      <Route path="/viewer/:sessionId" element={<ViewerPage />} />
      <Route path="/join/:joinCode" element={<ViewerPage />} />
      <Route path="/ops" element={<OpsPage />} />
      <Route path="/archives" element={<ArchivesPage />} />
      <Route path="/overlay/:sessionId" element={<OverlayPage />} />
      <Route path="/overlay/join/:joinCode" element={<OverlayPage />} />
      <Route path="/hud/:sessionId" element={<OverlayPage />} />
    </Routes>
  );
}
