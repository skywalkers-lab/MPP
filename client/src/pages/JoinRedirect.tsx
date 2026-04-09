import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { fetchJoinRoom } from '../lib/api';

export default function JoinRedirect() {
  const { joinCode } = useParams<{ joinCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const qp = new URLSearchParams(location.search);
  const password = qp.get('password') || '';
  const permissionCode = qp.get('permissionCode') || '';
  const [error, setError] = useState('');

  useEffect(() => {
    if (!joinCode) { navigate('/rooms', { replace: true }); return; }
    fetchJoinRoom(joinCode, password, permissionCode)
      .then(data => {
        const params = new URLSearchParams();
        if (password) params.set('password', password);
        if (permissionCode) params.set('permissionCode', permissionCode);
        const q = params.toString();
        navigate(`/room/${data.sessionId}${q ? '?' + q : ''}`, { replace: true });
      })
      .catch(e => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-[#050a0f] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="text-red-400 font-mono text-sm">{error}</div>
          <a href="/rooms" className="text-xs text-cyan-500 hover:text-cyan-300 transition-colors">← 로비로 돌아가기</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050a0f] flex items-center justify-center">
      <div className="text-[#4a6478] font-mono text-sm">Joining room...</div>
    </div>
  );
}
