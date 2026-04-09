import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { fetchJoinRoom, fetchSessionSnapshot, fetchStrategy } from '../lib/api';
import { safe, fmtLapTime, fmtPct, compoundColor, compoundShort } from '../lib/formatters';
import type { StrategyData } from '../types';

interface SnapshotData {
  lap?: number; totalLaps?: number; position?: number; compound?: string;
  tyreAge?: number; fuelLaps?: number; fuelKg?: number; ersPercent?: number;
  lastLapMs?: number; bestLapMs?: number; speed?: number; gear?: number;
}

export default function OverlayPage() {
  const { joinCode, sessionId: paramSessionId } = useParams<{ joinCode?: string; sessionId?: string }>();
  const location = useLocation();
  const qp = new URLSearchParams(location.search);
  const password = qp.get('password') || '';
  const permissionCode = qp.get('permissionCode') || '';

  const [resolvedId, setResolvedId] = useState<string | null>(paramSessionId || null);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [strategy, setStrategy] = useState<StrategyData | null>(null);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async (sid: string) => {
    try {
      const [snap, strat] = await Promise.all([
        fetchSessionSnapshot(sid, password, permissionCode).catch(() => null),
        fetchStrategy(sid).catch(() => null),
      ]);
      setSnapshot(snap as SnapshotData);
      setStrategy(strat as StrategyData);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [password, permissionCode]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    async function init() {
      let sid = resolvedId;
      if (joinCode) {
        try {
          const data = await fetchJoinRoom(joinCode, password, permissionCode);
          sid = data.sessionId;
          setResolvedId(sid);
        } catch {
          return;
        }
      }
      if (!sid) return;
      load(sid);
      timer = setInterval(() => load(sid!), 2000);
    }
    init();
    return () => { if (timer) clearInterval(timer); };
  }, []);

  const s = snapshot || {};
  const compColor = compoundColor(s.compound);
  const compShort = compoundShort(s.compound);

  const primaryCall = strategy?.primaryCall;
  const isPitNow = primaryCall?.includes('PIT NOW') || primaryCall?.includes('BOX');
  const isStayOut = primaryCall?.includes('STAY');
  const callColor = isPitNow ? '#ff4444' : isStayOut ? '#00e676' : '#00c8ff';

  return (
    <div className="fixed inset-0 bg-transparent font-['IBM_Plex_Mono',_Consolas,_monospace]"
      style={{ fontFamily: "'IBM Plex Mono', Consolas, monospace" }}>
      <div className="absolute bottom-4 left-4 right-4">
        <div className="flex items-end justify-between gap-4">
          <div
            className="rounded-lg overflow-hidden"
            style={{ background: 'rgba(5, 10, 15, 0.88)', border: '1px solid rgba(0,200,255,0.25)', backdropFilter: 'blur(10px)' }}
          >
            <div style={{ background: 'rgba(0,200,255,0.08)', borderBottom: '1px solid rgba(0,200,255,0.15)', padding: '4px 10px' }}>
              <span style={{ fontSize: 9, color: '#00c8ff', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                {connected ? '● LIVE' : '○ connecting'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, auto)', gap: '1px', background: 'rgba(0,200,255,0.06)' }}>
              {[
                { l: 'LAP', v: `${safe(s.lap)}${s.totalLaps ? `/${s.totalLaps}` : ''}` },
                { l: 'POS', v: safe(s.position) },
                {
                  l: 'TYRE',
                  v: compShort,
                  color: compColor,
                  sub: s.tyreAge != null ? `AGE ${s.tyreAge}` : undefined,
                },
                {
                  l: 'FUEL',
                  v: safe(s.fuelLaps),
                  color: s.fuelLaps != null && s.fuelLaps < 3 ? '#ff4444' : '#dce8f5',
                  sub: s.fuelKg != null ? `${s.fuelKg.toFixed(1)}kg` : undefined,
                },
                {
                  l: 'ERS',
                  v: s.ersPercent != null ? fmtPct(s.ersPercent) : '-',
                  color: s.ersPercent != null && s.ersPercent < 20 ? '#ffb300' : '#dce8f5',
                },
                { l: 'LAST', v: fmtLapTime(s.lastLapMs) },
              ].map(({ l, v, color, sub }) => (
                <div key={l} style={{ padding: '8px 12px', background: 'rgba(5,10,15,0.6)', minWidth: 64, textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#5e7a94', letterSpacing: '0.12em', marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: color || '#dce8f5', lineHeight: 1 }}>{v}</div>
                  {sub && <div style={{ fontSize: 9, color: '#4a6478', marginTop: 2 }}>{sub}</div>}
                </div>
              ))}
            </div>
          </div>

          {primaryCall && (
            <div
              className="rounded-lg px-4 py-3 text-right"
              style={{
                background: 'rgba(5, 10, 15, 0.88)',
                border: `1px solid ${callColor}40`,
                backdropFilter: 'blur(10px)',
                boxShadow: `0 0 20px ${callColor}20`,
              }}
            >
              <div style={{ fontSize: 9, color: '#5e7a94', letterSpacing: '0.15em', marginBottom: 4 }}>STRATEGY</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: callColor, letterSpacing: '0.04em', lineHeight: 1 }}>
                {primaryCall}
              </div>
              {strategy?.secondaryCall && (
                <div style={{ fontSize: 11, color: '#5e7a94', marginTop: 4 }}>{strategy.secondaryCall}</div>
              )}
              {strategy?.confidence != null && (
                <div style={{ fontSize: 10, color: '#3a5570', marginTop: 2 }}>
                  conf. {fmtPct(strategy.confidence)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
