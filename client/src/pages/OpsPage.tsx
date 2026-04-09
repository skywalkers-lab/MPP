import { useEffect, useState, useCallback } from 'react';
import Layout from '../components/Layout';
import HealthBadge from '../components/HealthBadge';
import type { OpsSession, TimelineEvent, DiagnosticsData } from '../types';
import { fetchOpsSessions, fetchOpsEvents, fetchDiagnostics } from '../lib/api';
import { safe, fmtRelTime } from '../lib/formatters';

export default function OpsPage() {
  const [sessions, setSessions] = useState<OpsSession[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [diag, setDiag] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [sessData, evtData, diagData] = await Promise.all([
        fetchOpsSessions().catch(() => ({ sessions: [], count: 0 })),
        fetchOpsEvents(60).catch(() => ({ events: [], count: 0 })),
        fetchDiagnostics().catch(() => null),
      ]);
      setSessions(sessData.sessions);
      setEvents(evtData.events);
      setDiag(diagData);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const udpOk = diag?.embeddedAgent?.udpBindSucceeded && (diag.embeddedAgent.recentPackets10s ?? 0) > 0;
  const activeSessions = sessions.filter(s => s.relayStatus !== 'closed');

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-4xl font-['Rajdhani'] text-white uppercase tracking-widest mb-1">Ops Control Plane</h1>
        <p className="text-sm text-[#5e7a94]">세션 헬스, 릴레이 상태, 이벤트 로그를 모니터링합니다.</p>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[10px] font-mono tracking-widest text-[#5e7a94] uppercase mb-3">Relay Status</div>
          {diag ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">Label</span>
                <span className="font-mono text-[#dce8f5]">{safe(diag.relay.label)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">WS Port</span>
                <span className="font-mono text-[#dce8f5]">{diag.relay.wsPort}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">HTTP Port</span>
                <span className="font-mono text-[#dce8f5]">{diag.relay.viewerPort}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">Public URL</span>
                <span className="font-mono text-cyan-400 text-xs truncate max-w-[160px]">{diag.relay.viewerBaseUrl}</span>
              </div>
            </div>
          ) : <div className="text-sm text-[#5e7a94]">Loading...</div>}
        </div>

        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[10px] font-mono tracking-widest text-[#5e7a94] uppercase mb-3">Embedded Agent</div>
          {diag?.embeddedAgent ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">UDP Bind</span>
                <span className={`font-mono font-bold ${diag.embeddedAgent.udpBindSucceeded ? 'text-emerald-400' : 'text-red-400'}`}>
                  {diag.embeddedAgent.udpBindSucceeded ? 'OK' : 'FAILED'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">UDP Port</span>
                <span className="font-mono text-[#dce8f5]">{diag.embeddedAgent.udpPort}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">Pkts/10s</span>
                <span className={`font-mono font-bold ${udpOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {diag.embeddedAgent.recentPackets10s}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">Parse Fails</span>
                <span className={`font-mono ${diag.embeddedAgent.parseFailureCount > 0 ? 'text-red-400' : 'text-[#dce8f5]'}`}>
                  {diag.embeddedAgent.parseFailureCount}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#5e7a94]">Last Packet</span>
                <span className="font-mono text-[#dce8f5] text-xs">{fmtRelTime(diag.embeddedAgent.lastPacketAt ?? undefined)}</span>
              </div>
            </div>
          ) : <div className="text-sm text-[#5e7a94]">Loading...</div>}
        </div>

        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[10px] font-mono tracking-widest text-[#5e7a94] uppercase mb-3">Session Summary</div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#5e7a94]">Total</span>
              <span className="font-mono text-[#dce8f5] font-bold">{sessions.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#5e7a94]">Active</span>
              <span className="font-mono text-emerald-400 font-bold">{activeSessions.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#5e7a94]">Closed</span>
              <span className="font-mono text-[#5e7a94]">{sessions.length - activeSessions.length}</span>
            </div>
            <div className="mt-3 flex gap-2 flex-wrap">
              <a href="/diagnostics" target="_blank" className="text-xs text-cyan-500 hover:text-cyan-300">Diagnostics JSON →</a>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <section className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <h2 className="text-sm font-mono font-bold tracking-[0.12em] text-[#5e7a94] uppercase mb-3">Sessions</h2>
          {loading && sessions.length === 0 ? (
            <div className="text-center py-8 text-[#5e7a94] text-sm">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 text-[#5e7a94] text-sm">No sessions found.</div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin pr-1">
              {sessions.map(s => (
                <div key={s.sessionId} className="rounded-lg border border-[#1a2e42] bg-[#0f1e2e] p-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="font-['Rajdhani'] text-base font-bold text-white">{s.roomTitle || 'Untitled'}</span>
                    <HealthBadge level={s.healthLevel} size="sm" />
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-mono text-[#5e7a94] mb-2">
                    <span>driver {safe(s.driverLabel)}</span>
                    <span>·</span>
                    <span>car {safe(s.carLabel)}</span>
                    <span>·</span>
                    <span>{fmtRelTime(s.updatedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${s.relayStatus === 'active' ? 'border-emerald-800 text-emerald-400' : 'border-[#1a2e42] text-[#4a6478]'}`}>
                      {s.relayStatus}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#1a2e42] text-[#4a6478] font-mono">
                      {s.joinCode}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${s.shareEnabled ? 'border-sky-800 text-sky-400' : 'border-[#1a2e42] text-[#4a6478]'}`}>
                      share {String(s.shareEnabled)}
                    </span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <a href={`/host/${s.sessionId}`} className="text-cyan-500 hover:text-cyan-300">Host →</a>
                    <a href={`/viewer/${s.sessionId}`} className="text-sky-500 hover:text-sky-300">Viewer →</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <h2 className="text-sm font-mono font-bold tracking-[0.12em] text-[#5e7a94] uppercase mb-3">
            Recent Ops Events
          </h2>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto scrollbar-thin pr-1">
            {events.length === 0 ? (
              <div className="text-center py-8 text-[#5e7a94] text-sm">No events.</div>
            ) : (
              events.slice().reverse().map((ev, i) => (
                <div key={`${ev.eventId || i}`} className="rounded border border-[#1a2e42] bg-[#0a1724] px-3 py-2">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-xs font-mono font-bold text-cyan-400">{ev.type}</span>
                    <span className="text-[10px] font-mono text-[#4a6478]">{fmtRelTime(ev.timestamp)}</span>
                  </div>
                  {ev.sessionId && (
                    <div className="text-[10px] font-mono text-[#4a6478]">{ev.sessionId}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </Layout>
  );
}
