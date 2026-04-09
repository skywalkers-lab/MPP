import MiniTrackMap from './MiniTrackMap';
import { fmtPct } from '../lib/formatters';
import type { SessionSnapshot, StrategyData } from '../types';

function MetricTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-[#e6edf6]';
  return (
    <div className="rounded-lg border border-[#1a2e42] bg-[#070e18] p-3">
      <div className="text-[8px] font-mono tracking-widest text-[#4a6478] uppercase">{label}</div>
      <div className={`mt-1 text-lg font-bold ${color}`} style={{ fontFamily: 'Rajdhani,sans-serif' }}>{value}</div>
    </div>
  );
}

export default function QualiStrategy({
  strategy,
  snapshot,
}: {
  strategy: StrategyData;
  snapshot: SessionSnapshot | null;
}) {
  const quali = strategy.qualifying;
  if (!quali) {
    return null;
  }

  const trackName = snapshot?.track ?? snapshot?.sessionMeta?.track ?? null;
  const trackId = snapshot?.sessionMeta?.trackId ?? null;
  const trafficTone = (quali.trafficScore ?? 0) >= 65 ? 'warn' : (quali.clearLapProbability ?? 0) >= 70 ? 'good' : 'default';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-3">
      <div className="space-y-3">
        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div>
              <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase">Qualifying traffic planner</div>
              <div className="mt-1 text-xl font-bold text-[#61d6df]" style={{ fontFamily: 'Rajdhani,sans-serif' }}>
                {quali.releaseLabel}
              </div>
            </div>
            <span className="px-2 py-1 border border-[#314760] bg-[#070e18] text-[10px] font-mono text-[#9bb8cc] uppercase">
              {quali.sessionPhase}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
            <MetricTile label="Traffic risk" value={fmtPct(quali.trafficScore)} tone={trafficTone} />
            <MetricTile label="Clear lap" value={fmtPct(quali.clearLapProbability)} tone={(quali.clearLapProbability ?? 0) >= 70 ? 'good' : 'default'} />
            <MetricTile label="Gap ahead" value={quali.predictedGapAheadMeters != null ? `${quali.predictedGapAheadMeters}m` : '--'} />
            <MetricTile label="Cars ahead" value={String(quali.predictedCarsOnOutLap)} tone={(quali.predictedCarsOnOutLap ?? 0) >= 5 ? 'warn' : 'default'} />
          </div>

          <div className="rounded-lg border border-[#1a2e42] bg-[#070e18] p-3">
            <div className="text-[8px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Track distribution</div>
            <div className="space-y-2">
              {quali.trafficBands.map((band) => (
                <div key={band.key}>
                  <div className="mb-1 flex items-center justify-between text-[10px] font-mono text-[#8d9db2]">
                    <span>{band.label}</span>
                    <span>{band.carCount} cars</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#121e2c] overflow-hidden">
                    <div className="h-full rounded-full bg-[#61d6df]" style={{ width: `${Math.max(4, band.density)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Engineer notes</div>
          <div className="space-y-1.5 text-sm text-[#c7d8e8]">
            <div>{quali.trafficSummary}</div>
            <div>{quali.outLapSummary}</div>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs text-[#9bb8cc] list-disc pl-4">
            {quali.rationale.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <MiniTrackMap
        cars={quali.trackMapCars}
        trackId={trackId}
        trackName={trackName}
        title="QUALI TRAFFIC MAP"
      />
    </div>
  );
}
