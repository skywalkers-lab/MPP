import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import type { ArchiveSummary } from '../types';
import { fetchArchives } from '../lib/api';
import { safe, fmtDateTime, fmtDuration } from '../lib/formatters';

export default function ArchivesPage() {
  const [archives, setArchives] = useState<ArchiveSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchArchives()
      .then(d => { setArchives(d.archives); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-4xl font-['Rajdhani'] text-white uppercase tracking-widest mb-1">Archives</h1>
        <p className="text-sm text-[#5e7a94]">완료된 세션 기록을 확인하고 분석합니다.</p>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-20 text-[#5e7a94]">Loading archives...</div>
      ) : archives.length === 0 ? (
        <div className="text-center py-20 text-[#5e7a94]">
          <div className="text-5xl mb-4 opacity-20">📦</div>
          <div className="text-sm">아직 아카이브된 세션이 없습니다.</div>
          <div className="text-xs mt-2 text-[#3a5570]">레이스가 종료되면 여기에 자동으로 저장됩니다.</div>
        </div>
      ) : (
        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1a2e42]">
                {['Room', 'Driver / Car', 'Track', 'Laps', 'Duration', 'Archived', 'Session ID'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-mono tracking-widest text-[#4a6478] uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {archives.map((a, i) => (
                <tr key={a.sessionId} className={`border-b border-[#1a2e42]/50 hover:bg-[#0f1e2e] transition-colors ${i % 2 === 0 ? '' : 'bg-[#0a1520]'}`}>
                  <td className="px-4 py-3">
                    <div className="font-['Rajdhani'] font-bold text-white">{a.roomTitle || 'Untitled'}</div>
                    <div className="text-[10px] font-mono text-[#4a6478] mt-0.5">{a.joinCode || a.sessionId.slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-[#5e7a94]">
                    {safe(a.driverLabel)} / {safe(a.carLabel)}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#dce8f5]">{safe(a.track)}</td>
                  <td className="px-4 py-3 text-sm font-mono text-[#dce8f5] font-bold">{safe(a.totalLaps)}</td>
                  <td className="px-4 py-3 text-sm font-mono text-[#5e7a94]">{fmtDuration(a.durationMs)}</td>
                  <td className="px-4 py-3 text-xs font-mono text-[#4a6478]">{fmtDateTime(a.archivedAt)}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-mono text-[#3a5570]">{a.sessionId.slice(0, 8)}…</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
