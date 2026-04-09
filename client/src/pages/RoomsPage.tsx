import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import HealthBadge from '../components/HealthBadge';
import type { Room, RelayInfo, DiagnosticsData } from '../types';
import { fetchRooms, fetchDiagnostics } from '../lib/api';
import { safe, fmtRelTime } from '../lib/formatters';

export default function RoomsPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [relay, setRelay] = useState<RelayInfo | null>(null);
  const [diag, setDiag] = useState<DiagnosticsData | null>(null);
  const [selected, setSelected] = useState<Room | null>(null);
  const [password, setPassword] = useState('');
  const [permCode, setPermCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [diagDismissed, setDiagDismissed] = useState(() => localStorage.getItem('mpp.diagDismissed.v2') === '1');

  const load = useCallback(async () => {
    try {
      const [roomsData, diagData] = await Promise.all([
        fetchRooms(),
        fetchDiagnostics().catch(() => null),
      ]);
      setRooms(roomsData.rooms);
      setRelay(roomsData.relay);
      setDiag(diagData);
      if (!selected && roomsData.rooms.length > 0) setSelected(roomsData.rooms[0]);
      else if (selected) {
        const found = roomsData.rooms.find(r => r.joinCode === selected.joinCode);
        setSelected(found || null);
      }
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  const udpOk = diag?.embeddedAgent?.udpBindSucceeded && (diag.embeddedAgent.recentPackets10s ?? 0) > 0;
  const showDiagBanner = !diagDismissed && diag && !udpOk;

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const params = new URLSearchParams();
    if (password) params.set('password', password);
    if (permCode) params.set('permissionCode', permCode);
    const q = params.toString();
    navigate(`/join/${selected.joinCode}${q ? '?' + q : ''}`);
  }

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-['Rajdhani'] text-white uppercase tracking-widest mb-1">
            Room Lobby
          </h1>
          <p className="text-sm text-[#5e7a94]">
            Engineer는 방을 선택하고 Password 또는 Permission Code를 입력해 즉시 입장합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {relay && (
            <span className="px-3 py-1.5 rounded-full border border-[#1a2e42] bg-[#0c1520] text-[#5e7a94] font-mono">
              {safe(relay.relayLabel)} @ {safe(relay.viewerBaseUrl || relay.relayNamespace)}
            </span>
          )}
          <span className="px-3 py-1.5 rounded-full border border-[#1a2e42] bg-[#0c1520] text-[#5e7a94] font-mono">
            rooms: {rooms.length}
          </span>
          <span className={`px-3 py-1.5 rounded-full border font-mono ${diag ? (udpOk ? 'border-emerald-800 bg-emerald-950/40 text-emerald-400' : 'border-amber-800 bg-amber-950/40 text-amber-400') : 'border-[#1a2e42] bg-[#0c1520] text-[#5e7a94]'}`}>
            diag: {diag ? (udpOk ? 'ok' : 'warning') : '-'}
          </span>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded border border-[#1a2e42] bg-[#0c1520] text-[#9bb8cc] hover:bg-[#112030] transition-colors font-semibold text-xs tracking-wide uppercase"
          >
            Refresh
          </button>
        </div>
      </div>

      {showDiagBanner && (
        <div className="mb-4 rounded-lg border border-amber-800/60 bg-amber-950/30 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-mono font-bold tracking-widest text-amber-400 uppercase mb-1">
                ⚠ UDP Quick Check
              </div>
              <p className="text-sm text-amber-200/80 mb-2">
                게임 Telemetry UDP가 켜져 있고 포트가 20777인지 확인하세요. 방화벽/보안 정책 차단 여부를 점검해야 Room 데이터가 표시됩니다.
              </p>
              {diag?.embeddedAgent && (
                <p className="text-xs font-mono text-amber-400/70">
                  bind={String(diag.embeddedAgent.udpBindSucceeded)} | pkts10s={diag.embeddedAgent.recentPackets10s} | fails={diag.embeddedAgent.parseFailureCount}
                  {diag.embeddedAgent.udpBindError ? ` | err=${diag.embeddedAgent.udpBindError}` : ''}
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <a href="/diagnostics" target="_blank" className="px-3 py-1.5 text-xs rounded border border-amber-700 text-amber-300 hover:bg-amber-900/30 transition-colors">
                Diagnostics
              </a>
              <button
                onClick={() => { setDiagDismissed(true); localStorage.setItem('mpp.diagDismissed.v2', '1'); }}
                className="px-3 py-1.5 text-xs rounded border border-[#2a3e50] text-[#5e7a94] hover:bg-white/5 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && rooms.length === 0 && (
        <div className="text-center py-20 text-[#5e7a94]">Loading rooms...</div>
      )}
      {error && (
        <div className="mb-4 rounded border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
        <section className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <h2 className="text-sm font-mono font-bold tracking-[0.12em] text-[#5e7a94] uppercase mb-3">
            Active Rooms
          </h2>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto scrollbar-thin pr-1">
            {rooms.length === 0 && !loading && (
              <div className="text-center py-12 text-[#5e7a94] text-sm">
                현재 표시할 Room이 없습니다.
              </div>
            )}
            {rooms.map((room) => {
              const isActive = selected?.joinCode === room.joinCode;
              return (
                <button
                  key={room.joinCode}
                  onClick={() => setSelected(room)}
                  className={`w-full text-left rounded-lg border p-3 transition-all ${
                    isActive
                      ? 'border-cyan-600 bg-cyan-950/30 shadow-[0_0_0_1px_rgba(0,200,255,0.15)_inset]'
                      : 'border-[#1a2e42] bg-[#0f1e2e] hover:border-[#243d56] hover:bg-[#112030]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className={`font-['Rajdhani'] text-lg font-bold tracking-wide ${isActive ? 'text-cyan-300' : 'text-white'}`}>
                      {room.roomTitle || 'Untitled Room'}
                    </span>
                    <HealthBadge level={room.healthLevel} size="sm" />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-[#5e7a94] font-mono mb-1">
                    <span>driver {safe(room.driverLabel)}</span>
                    <span>·</span>
                    <span>car {safe(room.carLabel)}</span>
                    <span>·</span>
                    <span>{room.passwordEnabled ? '🔒 password' : '🔓 open'}</span>
                    <span>·</span>
                    <span>{fmtRelTime(room.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${room.relayStatus === 'active' ? 'border-emerald-800 text-emerald-400' : 'border-[#1a2e42] text-[#4a6478]'}`}>
                      relay {room.relayStatus}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${room.shareEnabled ? 'border-sky-800 text-sky-400' : 'border-[#1a2e42] text-[#4a6478]'}`}>
                      share {String(room.shareEnabled)}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#1a2e42] text-[#4a6478] font-mono">
                      {room.joinCode}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <h2 className="text-sm font-mono font-bold tracking-[0.12em] text-[#5e7a94] uppercase mb-3">
            Join Room
          </h2>

          {selected ? (
            <div className="mb-4 rounded-lg border border-[#1a2e42] bg-[#0f1e2e] p-3">
              <div className="font-['Rajdhani'] text-lg font-bold text-white mb-1">{selected.roomTitle}</div>
              <div className="text-xs font-mono text-[#5e7a94]">
                driver={safe(selected.driverLabel)} | car={safe(selected.carLabel)} | join={selected.joinCode}
              </div>
              <div className="mt-2">
                <HealthBadge level={selected.healthLevel} size="sm" />
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-lg border border-[#1a2e42] bg-[#0f1e2e] p-3 text-sm text-[#5e7a94]">
              왼쪽에서 Room을 선택하세요.
            </div>
          )}

          <form onSubmit={handleJoin} className="space-y-3">
            <div>
              <label className="block text-[10px] font-mono tracking-widest text-[#5e7a94] uppercase mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="문을 여는 열쇠"
                className="w-full bg-[#0a1724] border border-[#1a2e42] rounded px-3 py-2 text-sm text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700 transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono tracking-widest text-[#5e7a94] uppercase mb-1">Permission Code</label>
              <input
                type="text"
                value={permCode}
                onChange={e => setPermCode(e.target.value)}
                placeholder="제어 권한 키 (선택)"
                className="w-full bg-[#0a1724] border border-[#1a2e42] rounded px-3 py-2 text-sm text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700 transition-colors"
              />
            </div>
            <div className="rounded border border-[#1a2e42] bg-[#0a1724] p-3 text-xs text-[#4a6478] leading-relaxed">
              <span className="text-cyan-600">Password</span> — Room 입장을 허용하는 기본 키<br />
              <span className="text-purple-500">Permission Code</span> — 노트/전략/host급 제어 권한을 부여하는 고급 키
            </div>
            <button
              type="submit"
              disabled={!selected}
              className="w-full py-2.5 rounded bg-gradient-to-r from-cyan-800 to-cyan-700 border border-cyan-600 text-white font-['Rajdhani'] font-bold text-base tracking-widest uppercase hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Join Room
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-[#1a2e42] flex flex-wrap gap-3">
            <a href="/console/live" className="text-xs text-cyan-500 hover:text-cyan-300 transition-colors">Live Strategic Console →</a>
            <a href="/console/replay" className="text-xs text-cyan-500 hover:text-cyan-300 transition-colors">Replay Console →</a>
          </div>
        </section>
      </div>
    </Layout>
  );
}
