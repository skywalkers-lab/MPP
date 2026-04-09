import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import HealthBadge from '../components/HealthBadge';
import MetricCard from '../components/MetricCard';
import type { StrategyData, SessionNote, TimelineEvent, SessionHealthData, SessionAccessRecord } from '../types';
import {
  fetchStrategy, fetchNotes, addNote, deleteNote, fetchTimeline,
  fetchSessionAccess, fetchSessionHealth, fetchRelayInfo, patchSessionAccess
} from '../lib/api';
import { safe, fmtLapTime, fmtPct, fmtRelTime, compoundColor, compoundShort } from '../lib/formatters';

interface SnapshotData {
  lap?: number; totalLaps?: number; position?: number; compound?: string;
  tyreAge?: number; fuelLaps?: number; fuelKg?: number; ersPercent?: number;
  lastLapMs?: number; bestLapMs?: number; speed?: number; sessionType?: string;
  track?: string;
}

const categoryColors: Record<string, string> = {
  strategy: 'text-cyan-400 border-cyan-800',
  incident: 'text-red-400 border-red-800',
  pit: 'text-amber-400 border-amber-800',
  risk: 'text-orange-400 border-orange-800',
  general: 'text-[#5e7a94] border-[#1a2e42]',
};

function ScoreBar({ value, max = 100 }: { value: number | undefined; max?: number }) {
  const pct = value != null ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = pct > 75 ? '#ff4444' : pct > 40 ? '#ffb300' : '#00e676';
  return (
    <div className="mt-1 h-1 rounded-full bg-[#1a2e42] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export default function HostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const qp = new URLSearchParams(location.search);
  const password = qp.get('password') || '';
  const permissionCode = qp.get('permissionCode') || '';

  const [strategy, setStrategy] = useState<StrategyData | null>(null);
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [health, setHealth] = useState<SessionHealthData | null>(null);
  const [access, setAccess] = useState<SessionAccessRecord | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);

  const [noteText, setNoteText] = useState('');
  const [noteAuthor, setNoteAuthor] = useState('Engineer');
  const [noteCategory, setNoteCategory] = useState('general');
  const [noteLap, setNoteLap] = useState('');
  const [noteMsg, setNoteMsg] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [roomTitle, setRoomTitle] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [permCode, setPermCode] = useState('');
  const [shareEnabled, setShareEnabled] = useState('false');
  const [visibility, setVisibility] = useState('private');
  const [saveMsg, setSaveMsg] = useState('');

  const [relayInfo, setRelayInfo] = useState<{ viewerBaseUrl?: string; relayLabel?: string } | null>(null);
  const [copyMsg, setCopyMsg] = useState('');

  const id = sessionId || '';

  const loadAccess = useCallback(async () => {
    try {
      const a = await fetchSessionAccess(id, password, permissionCode);
      setAccess(a);
      setRoomTitle(a.roomTitle || '');
      setRoomPassword('');
      setPermCode('');
      setShareEnabled(String(a.shareEnabled));
      setVisibility(a.visibility || 'private');
    } catch { }
  }, [id, password, permissionCode]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [strat, notesData, timelineData, healthData] = await Promise.all([
        fetchStrategy(id).catch(() => null),
        fetchNotes(id, password, permissionCode).catch(() => null),
        fetchTimeline(id, 80).catch(() => null),
        fetchSessionHealth(id).catch(() => null),
      ]);
      if (strat) setStrategy(strat);
      if (notesData) setNotes(notesData.notes);
      if (timelineData) setTimeline(timelineData.timeline);
      if (healthData) setHealth(healthData);
    } catch { }
  }, [id, password, permissionCode]);

  useEffect(() => {
    loadAccess();
    load();
    fetchRelayInfo().then(setRelayInfo).catch(() => { });
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSavingNote(true);
    setNoteMsg('');
    try {
      const lap = noteLap ? parseInt(noteLap, 10) : undefined;
      await addNote(id, { text: noteText.trim(), authorLabel: noteAuthor, category: noteCategory, lap }, password, permissionCode);
      setNoteText('');
      setNoteLap('');
      setNoteMsg('✓ Note added');
      load();
    } catch (e) {
      setNoteMsg('✗ ' + String(e));
    } finally {
      setSavingNote(false);
      setTimeout(() => setNoteMsg(''), 3000);
    }
  }

  async function handleDeleteNote(noteId: string) {
    try {
      await deleteNote(id, noteId, password, permissionCode);
      setNotes(prev => prev.filter(n => n.id !== noteId));
    } catch { }
  }

  async function handleSaveAccess() {
    setSaveMsg('');
    try {
      await patchSessionAccess(id, {
        roomTitle,
        shareEnabled: shareEnabled === 'true',
        visibility: visibility as 'private' | 'code',
        ...(roomPassword ? { roomPassword } : {}),
        ...(permCode ? { permissionCode: permCode } : {}),
      } as Partial<SessionAccessRecord>);
      setSaveMsg('✓ Saved');
      loadAccess();
    } catch (e) {
      setSaveMsg('✗ ' + String(e));
    } finally {
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopyMsg(`✓ ${label} copied`);
      setTimeout(() => setCopyMsg(''), 2000);
    });
  }

  const base = relayInfo?.viewerBaseUrl || '';
  const joinUrl = access?.joinCode ? `${base}/join/${access.joinCode}` : '';
  const overlayUrl = access?.joinCode ? `${base}/overlay/join/${access.joinCode}` : '';

  const s = snapshot || {};
  const compColor = compoundColor(s.compound);
  const compShort = compoundShort(s.compound);
  const m = strategy?.metrics;

  const primaryCall = strategy?.primaryCall || 'Awaiting telemetry...';
  const isPitNow = primaryCall.includes('PIT NOW') || primaryCall.includes('BOX');
  const isStayOut = primaryCall.includes('STAY');
  const callColor = isPitNow ? 'text-red-400' : isStayOut ? 'text-emerald-400' : 'text-cyan-300';

  return (
    <div className="min-h-screen bg-[#050a0f] text-[#dce8f5]">
      <header className="sticky top-0 z-50 border-b border-[#1a2e42] bg-[#070e18]/95 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-3 h-11 flex items-center gap-4">
          <Link to="/rooms" className="flex items-center gap-1.5 mr-2">
            <div className="h-5 w-0.5 rounded-full bg-cyan-400" />
            <span className="font-['Rajdhani'] text-sm font-bold tracking-widest text-white uppercase">MPP</span>
          </Link>
          <div className="flex gap-2">
            {[{ to: '/rooms', label: 'rooms' }, { to: '/ops', label: 'ops' }, { to: '/archives', label: 'archives' }].map(l => (
              <Link key={l.to} to={l.to} className="text-[10px] px-2.5 py-1 rounded-full border border-[#1a2e42] text-[#5e7a94] hover:text-[#9bb8cc] hover:bg-white/5 tracking-widest uppercase transition-colors">
                {l.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {health && <HealthBadge level={health.healthLevel} size="sm" />}
            <span className="text-xs font-mono text-[#4a6478]">{access?.roomTitle || id}</span>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-3 space-y-3">
        <section className="rounded-xl border border-[#243d56] bg-gradient-to-r from-[#0c1a28] to-[#0a1520] p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="text-[10px] font-mono tracking-[0.14em] text-[#4a6478] uppercase mb-1">Strategy Command Bar</div>
              <div className={`font-['Rajdhani'] text-3xl font-bold tracking-wide ${callColor}`}>
                {primaryCall}
              </div>
              <div className="text-sm text-[#5e7a94] mt-0.5">{strategy?.secondaryCall || '-'}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {health && <HealthBadge level={health.healthLevel} />}
              {strategy?.confidence != null && (
                <div className="text-xs font-mono text-[#4a6478]">conf. {fmtPct(strategy.confidence)}</div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {[
              { label: 'Call Confidence', value: m?.trafficExposure, fmt: () => fmtPct(strategy?.confidence) },
              { label: 'Stability', value: undefined, fmt: () => safe(strategy?.stability) },
              { label: 'Pit Window ETA', value: undefined, fmt: () => safe(strategy?.pitWindowEta) },
              { label: 'Traffic Exposure', value: m?.trafficExposure, fmt: () => fmtPct(m?.trafficExposure) },
              { label: 'Tyre/Fuel Stress', value: m?.tyreFuelStress, fmt: () => fmtPct(m?.tyreFuelStress) },
              { label: 'Execution Ready', value: m?.executionReadiness, fmt: () => fmtPct(m?.executionReadiness) },
              { label: 'Clean Air Prob.', value: m?.cleanAirProbability, fmt: () => fmtPct(m?.cleanAirProbability) },
            ].map(({ label, value, fmt }) => (
              <div key={label} className="border border-[#1a2e42] bg-[#0a1724] p-2.5">
                <div className="text-[9px] font-mono tracking-[0.12em] text-[#4a6478] uppercase mb-1.5">{label}</div>
                <div className="font-mono text-lg font-bold text-[#dce8f5] leading-none">{fmt()}</div>
                {value != null && <ScoreBar value={value} />}
              </div>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-3">
          <section className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-3 space-y-3">
            <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase">Driver / Car State</div>
            <div className="grid grid-cols-2 gap-1.5">
              <MetricCard label="Lap" value={safe(s.lap)} sub={s.totalLaps ? `/ ${s.totalLaps}` : undefined} />
              <MetricCard label="Position" value={safe(s.position)} sub={s.bestLapMs ? `best ${fmtLapTime(s.bestLapMs)}` : undefined} />
              <MetricCard
                label="Compound"
                value={<span style={{ color: compColor }}>{compShort}</span>}
                sub={s.tyreAge != null ? `age ${s.tyreAge} laps` : undefined}
              />
              <MetricCard
                label="Fuel Laps"
                value={safe(s.fuelLaps)}
                sub={s.fuelKg != null ? `${s.fuelKg.toFixed(1)} kg` : undefined}
                accent={s.fuelLaps != null && s.fuelLaps < 3 ? 'red' : 'default'}
              />
              <MetricCard
                label="ERS"
                value={s.ersPercent != null ? fmtPct(s.ersPercent) : '-'}
                sub="energy store"
                accent={s.ersPercent != null && s.ersPercent < 20 ? 'amber' : 'default'}
              />
              <MetricCard label="Last Lap" value={fmtLapTime(s.lastLapMs)} sub={s.track || undefined} />
            </div>

            <div className="rounded border border-[#1a2e42] bg-[#0a1724] p-3 space-y-2 text-xs">
              <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Relay / Share</div>
              <div className="flex justify-between">
                <span className="text-[#4a6478]">Relay</span>
                <span className="font-mono text-[#dce8f5] text-[10px]">{relayInfo?.relayLabel || '-'}</span>
              </div>
              {access?.joinCode && (
                <>
                  <div className="flex justify-between">
                    <span className="text-[#4a6478]">Join Code</span>
                    <span className="font-mono text-cyan-400 font-bold">{access.joinCode}</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mt-1">
                    <button onClick={() => copyToClipboard(joinUrl, 'Join URL')}
                      className="px-2 py-1 rounded border border-[#1a2e42] text-[10px] text-[#5e7a94] hover:bg-white/5 transition-colors">
                      copy link
                    </button>
                    <button onClick={() => copyToClipboard(access.joinCode, 'Code')}
                      className="px-2 py-1 rounded border border-[#1a2e42] text-[10px] text-[#5e7a94] hover:bg-white/5 transition-colors">
                      copy code
                    </button>
                    <a href={overlayUrl} target="_blank" rel="noopener"
                      className="px-2 py-1 rounded border border-purple-800 text-[10px] text-purple-400 hover:bg-purple-950/30 transition-colors">
                      overlay
                    </a>
                  </div>
                  {copyMsg && <div className="text-[10px] text-emerald-400 font-mono">{copyMsg}</div>}
                </>
              )}
            </div>

            <div className="rounded border border-[#1a2e42] bg-[#0a1724] p-3 space-y-2">
              <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Room Profile</div>
              <input value={roomTitle} onChange={e => setRoomTitle(e.target.value)} placeholder="Room Title"
                className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700" />
              <input value={roomPassword} onChange={e => setRoomPassword(e.target.value)} placeholder="Password (optional)" type="text"
                className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700" />
              <input value={permCode} onChange={e => setPermCode(e.target.value)} placeholder="Permission Code"
                className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700" />
              <div className="flex gap-2 items-center">
                <select value={shareEnabled} onChange={e => setShareEnabled(e.target.value)}
                  className="flex-1 bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] focus:outline-none">
                  <option value="false">Share OFF</option>
                  <option value="true">Share ON</option>
                </select>
                <select value={visibility} onChange={e => setVisibility(e.target.value)}
                  className="flex-1 bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] focus:outline-none">
                  <option value="private">private</option>
                  <option value="code">code</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveAccess}
                  className="flex-1 py-1.5 rounded bg-cyan-800/50 border border-cyan-700 text-xs text-cyan-300 hover:bg-cyan-700/50 transition-colors">
                  Apply
                </button>
                <button onClick={loadAccess}
                  className="px-3 py-1.5 rounded border border-[#1a2e42] text-xs text-[#5e7a94] hover:bg-white/5 transition-colors">
                  Reload
                </button>
              </div>
              {saveMsg && (
                <div className={`text-[10px] font-mono ${saveMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-3">
            <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase mb-3">Main Tactical Area</div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 h-full">
              <div className="rounded border border-[#1a2e42] bg-[#0a1724] p-3">
                <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Strategy / Notes</div>
                <div className="space-y-2 max-h-[320px] overflow-y-auto scrollbar-thin pr-1">
                  {strategy && !strategy.strategyUnavailable && (
                    <div className="rounded border border-cyan-900/60 bg-cyan-950/20 p-2.5 mb-3">
                      <div className={`font-['Rajdhani'] text-xl font-bold mb-1 ${isPitNow ? 'text-red-400' : isStayOut ? 'text-emerald-400' : 'text-cyan-300'}`}>
                        {strategy.primaryCall}
                      </div>
                      {strategy.secondaryCall && <div className="text-xs text-[#5e7a94]">{strategy.secondaryCall}</div>}
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        {[
                          { l: 'Undercut', v: m?.undercutScore },
                          { l: 'Overcut', v: m?.overcutScore },
                          { l: 'Tyre Urgency', v: m?.tyreUrgency },
                          { l: 'Fuel Risk', v: m?.fuelRisk },
                        ].map(({ l, v }) => v != null && (
                          <div key={l} className="text-[10px] font-mono text-[#4a6478]">
                            {l}: <span className="text-[#8899aa]">{fmtPct(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {notes.slice().reverse().map(note => (
                    <div key={note.id} className={`rounded border bg-[#0a1520] p-2.5 ${categoryColors[note.category || 'general'] || categoryColors.general}`}>
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <div className="flex gap-1.5 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-wider ${categoryColors[note.category || 'general']}`}>
                            {note.category || 'general'}
                          </span>
                          {note.authorLabel && <span className="text-[9px] font-mono text-[#4a6478]">{note.authorLabel}</span>}
                          {note.lap != null && <span className="text-[9px] font-mono text-[#4a6478]">L{note.lap}</span>}
                        </div>
                        <button onClick={() => handleDeleteNote(note.id)} className="text-[9px] text-[#3a5570] hover:text-red-400 transition-colors">✕</button>
                      </div>
                      <div className="text-xs text-[#dce8f5] leading-relaxed">{note.text}</div>
                      <div className="text-[9px] font-mono text-[#3a5570] mt-1">{fmtRelTime(note.createdAt)}</div>
                    </div>
                  ))}
                  {notes.length === 0 && <div className="text-center py-6 text-[#3a5570] text-xs">No notes yet.</div>}
                </div>
              </div>

              <div className="rounded border border-[#1a2e42] bg-[#0a1724] p-3">
                <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Timeline / Ops Events</div>
                <div className="space-y-1.5 max-h-[360px] overflow-y-auto scrollbar-thin pr-1">
                  {timeline.slice().reverse().map((ev, i) => (
                    <div key={ev.eventId || i} className="rounded border border-[#1a2e42] bg-[#0a1520] px-2.5 py-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono font-bold text-sky-400">{ev.type}</span>
                        <span className="text-[9px] font-mono text-[#3a5570]">{fmtRelTime(ev.timestamp)}</span>
                      </div>
                      {ev.lap != null && <div className="text-[9px] font-mono text-[#4a6478] mt-0.5">lap {ev.lap}</div>}
                    </div>
                  ))}
                  {timeline.length === 0 && <div className="text-center py-6 text-[#3a5570] text-xs">No events yet.</div>}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-3 space-y-3">
            <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase">Analysis + Notes</div>
            <div className="space-y-1.5">
              {[
                { label: 'Undercut Score', value: m?.undercutScore },
                { label: 'Overcut Score', value: m?.overcutScore },
                { label: 'Tyre Urgency', value: m?.tyreUrgency },
                { label: 'Fuel Risk', value: m?.fuelRisk },
                { label: 'Traffic Exposure', value: m?.trafficExposure },
                { label: 'Clean Air Prob.', value: m?.cleanAirProbability },
              ].map(({ label, value }) => (
                <div key={label} className="rounded border border-[#1a2e42] bg-[#0a1724] px-3 py-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-[#4a6478]">{label}</span>
                    <span className="text-xs font-mono font-bold text-[#dce8f5]">{value != null ? fmtPct(value) : '-'}</span>
                  </div>
                  <ScoreBar value={value} />
                </div>
              ))}
            </div>

            <form onSubmit={handleAddNote} className="space-y-2 border-t border-[#1a2e42] pt-3">
              <div className="text-[10px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Add Note</div>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="예: undercut 준비, outlap traffic 재평가 필요"
                maxLength={400}
                rows={3}
                className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-2.5 py-2 text-xs text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700 resize-y"
              />
              <div className="grid grid-cols-3 gap-1.5">
                <select value={noteAuthor} onChange={e => setNoteAuthor(e.target.value)}
                  className="bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] focus:outline-none">
                  {['Engineer', 'Strategist', 'Pit Wall', 'Observer'].map(v => <option key={v}>{v}</option>)}
                </select>
                <select value={noteCategory} onChange={e => setNoteCategory(e.target.value)}
                  className="bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] focus:outline-none">
                  {['general', 'strategy', 'incident', 'pit', 'risk'].map(v => <option key={v}>{v}</option>)}
                </select>
                <input value={noteLap} onChange={e => setNoteLap(e.target.value)} type="number" min="0" placeholder="lap"
                  className="bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none" />
              </div>
              <button type="submit" disabled={savingNote || !noteText.trim()}
                className="w-full py-2 rounded border border-cyan-800 bg-cyan-950/40 text-xs text-cyan-400 hover:bg-cyan-900/40 transition-colors disabled:opacity-40 font-mono font-bold tracking-wide uppercase">
                {savingNote ? 'Adding...' : 'Add Note'}
              </button>
              {noteMsg && (
                <div className={`text-[10px] font-mono ${noteMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{noteMsg}</div>
              )}
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
