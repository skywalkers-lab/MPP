import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import HealthBadge from '../components/HealthBadge';
import MetricCard from '../components/MetricCard';
import { fetchJoinRoom, fetchSessionSnapshot, fetchSessionHealth, fetchStrategy } from '../lib/api';
import { safe, fmtLapTime, fmtPct, fmtRelTime, compoundColor, compoundShort } from '../lib/formatters';
import type { SessionHealthData, StrategyData } from '../types';

interface SnapshotData {
  lap?: number; totalLaps?: number; position?: number; compound?: string;
  tyreAge?: number; fuelLaps?: number; fuelKg?: number; ersPercent?: number;
  lastLapMs?: number; bestLapMs?: number; speed?: number; gear?: number;
  throttle?: number; brake?: number; track?: string; sessionType?: string;
  weather?: string;
}

export default function ViewerPage() {
  const { joinCode, sessionId: paramSessionId } = useParams<{ joinCode?: string; sessionId?: string }>();
  const location = useLocation();
  const qp = new URLSearchParams(location.search);
  const password = qp.get('password') || '';
  const permissionCode = qp.get('permissionCode') || '';

  const [resolvedId, setResolvedId] = useState<string | null>(paramSessionId || null);
  const [roomTitle, setRoomTitle] = useState('');
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [health, setHealth] = useState<SessionHealthData | null>(null);
  const [strategy, setStrategy] = useState<StrategyData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const resolveSession = useCallback(async () => {
    if (joinCode) {
      try {
        const data = await fetchJoinRoom(joinCode, password, permissionCode);
        setResolvedId(data.sessionId);
        setRoomTitle(data.roomTitle || '');
        return data.sessionId;
      } catch (e) {
        setError(String(e));
        setLoading(false);
        return null;
      }
    }
    return paramSessionId || null;
  }, [joinCode, paramSessionId, password, permissionCode]);

  const load = useCallback(async (sid: string) => {
    try {
      const [snap, healthData, stratData] = await Promise.all([
        fetchSessionSnapshot(sid, password, permissionCode).catch(() => null),
        fetchSessionHealth(sid).catch(() => null),
        fetchStrategy(sid).catch(() => null),
      ]);
      setSnapshot(snap as SnapshotData);
      setHealth(healthData as SessionHealthData);
      setStrategy(stratData as StrategyData);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [password, permissionCode]);

  useEffect(() => {
    let sid = resolvedId;
    let timer: ReturnType<typeof setInterval>;

    resolveSession().then(id => {
      if (!id) return;
      sid = id;
      load(id);
      timer = setInterval(() => load(id), 2000);
    });

    return () => { if (timer) clearInterval(timer); };
  }, []);

  const s = snapshot || {};
  const compColor = compoundColor(s.compound);
  const compShort = compoundShort(s.compound);

  const callStyle = strategy?.primaryCall?.includes('PIT NOW') || strategy?.primaryCall?.includes('BOX')
    ? 'text-red-400' : strategy?.primaryCall?.includes('STAY')
    ? 'text-emerald-400' : 'text-cyan-400';

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-['Rajdhani'] text-white uppercase tracking-widest">
            {roomTitle || 'Live Viewer'}
          </h1>
          {resolvedId && (
            <p className="text-xs font-mono text-[#5e7a94] mt-0.5">{resolvedId}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {health && <HealthBadge level={health.healthLevel} />}
          {s.track && (
            <span className="px-3 py-1.5 text-xs font-mono rounded-full border border-[#1a2e42] bg-[#0c1520] text-[#5e7a94]">
              {s.track}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {loading && !snapshot && (
        <div className="text-center py-16 text-[#5e7a94]">Connecting to session...</div>
      )}

      {strategy && !strategy.strategyUnavailable && (
        <div className="mb-4 rounded-xl border border-[#243d56] bg-gradient-to-r from-[#0c1a28] to-[#0a1520] p-4">
          <div className="text-[10px] font-mono tracking-widest text-[#5e7a94] uppercase mb-2">Strategy Command</div>
          <div className={`font-['Rajdhani'] text-3xl font-bold tracking-wide mb-1 ${callStyle}`}>
            {strategy.primaryCall || 'Awaiting data...'}
          </div>
          <div className="text-sm text-[#5e7a94]">{strategy.secondaryCall}</div>
          {strategy.confidence != null && (
            <div className="mt-2 text-xs font-mono text-[#4a6478]">
              confidence {fmtPct(strategy.confidence)} · stability {safe(strategy.stability)}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <MetricCard
          label="Lap"
          value={safe(s.lap)}
          sub={s.totalLaps ? `/ ${s.totalLaps} total` : undefined}
        />
        <MetricCard
          label="Position"
          value={safe(s.position)}
          sub={s.lastLapMs ? `last ${fmtLapTime(s.lastLapMs)}` : undefined}
          accent={s.position === 1 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Compound"
          value={
            <span style={{ color: compColor }}>
              {compShort}
            </span>
          }
          sub={s.tyreAge != null ? `age ${s.tyreAge} laps` : undefined}
        />
        <MetricCard
          label="Fuel Laps"
          value={safe(s.fuelLaps)}
          sub={s.fuelKg != null ? `${s.fuelKg?.toFixed(1)} kg` : undefined}
          accent={s.fuelLaps != null && s.fuelLaps < 3 ? 'red' : 'default'}
        />
        <MetricCard
          label="ERS"
          value={s.ersPercent != null ? fmtPct(s.ersPercent) : '-'}
          sub="energy store"
          accent={s.ersPercent != null && s.ersPercent < 20 ? 'amber' : 'default'}
        />
        <MetricCard
          label="Speed"
          value={s.speed != null ? `${Math.round(s.speed)}` : '-'}
          sub={s.gear != null ? `gear ${s.gear}` : undefined}
        />
      </div>

      {strategy?.metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Traffic Exposure', key: 'trafficExposure' },
            { label: 'Tyre/Fuel Stress', key: 'tyreFuelStress' },
            { label: 'Execution Readiness', key: 'executionReadiness' },
            { label: 'Clean Air Prob.', key: 'cleanAirProbability' },
          ].map(({ label, key }) => {
            const v = strategy.metrics?.[key as keyof typeof strategy.metrics];
            const pct = Number(v);
            const accent: 'default' | 'red' | 'amber' | 'green' = pct > 75 ? 'red' : pct > 40 ? 'amber' : 'green';
            return (
              <MetricCard
                key={key}
                label={label}
                value={v != null ? fmtPct(pct) : '-'}
                accent={v != null ? accent : 'default'}
              />
            );
          })}
        </div>
      )}
    </Layout>
  );
}
