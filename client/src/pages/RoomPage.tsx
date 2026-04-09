import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import HealthBadge from '../components/HealthBadge';
import MetricCard from '../components/MetricCard';
import type {
  StrategyData, SessionNote, TimelineEvent, SessionHealthData,
  SessionAccessRecord, SessionSnapshot,
} from '../types';
import {
  fetchStrategy, fetchNotes, addNote, deleteNote, fetchTimeline,
  fetchSessionAccess, fetchSessionHealth, fetchRelayInfo,
  fetchSessionSnapshot, patchSessionAccess,
} from '../lib/api';
import { safe, fmtLapTime, fmtPct, fmtRelTime, compoundColor, compoundShort } from '../lib/formatters';

type Tab = 'live' | 'strategy' | 'notes' | 'timeline' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'notes', label: 'Notes' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'settings', label: 'Settings' },
];

const categoryColors: Record<string, string> = {
  strategy: 'text-cyan-400 border-cyan-800 bg-cyan-950/20',
  incident: 'text-red-400 border-red-800 bg-red-950/20',
  pit: 'text-amber-400 border-amber-800 bg-amber-950/20',
  risk: 'text-orange-400 border-orange-800 bg-orange-950/20',
  general: 'text-[#5e7a94] border-[#1a2e42] bg-[#0a1520]',
};

function ScoreBar({ value, max = 100 }: { value?: number; max?: number }) {
  const pct = value != null ? Math.min(100, Math.max(0, (value / (max ?? 100)) * 100)) : 0;
  const color = pct > 75 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
  return (
    <div className="mt-1.5 h-1 rounded-full bg-[#1a2e42] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function callColor(call?: string) {
  if (!call) return 'text-[#5e7a94]';
  if (call.includes('PIT NOW') || call.includes('BOX')) return 'text-red-400';
  if (call.includes('STAY OUT') || call.includes('STAY')) return 'text-emerald-400';
  return 'text-cyan-300';
}

export default function RoomPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const qp = new URLSearchParams(location.search);
  const password = qp.get('password') || '';
  const permissionCode = qp.get('permissionCode') || '';
  const hasPermission = !!permissionCode;

  const [tab, setTab] = useState<Tab>('live');
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [strategy, setStrategy] = useState<StrategyData | null>(null);
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [health, setHealth] = useState<SessionHealthData | null>(null);
  const [access, setAccess] = useState<SessionAccessRecord | null>(null);
  const [relayInfo, setRelayInfo] = useState<{ viewerBaseUrl?: string; relayLabel?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [noteText, setNoteText] = useState('');
  const [noteAuthor, setNoteAuthor] = useState('Engineer');
  const [noteCategory, setNoteCategory] = useState('general');
  const [noteLap, setNoteLap] = useState('');
  const [noteMsg, setNoteMsg] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [roomTitle, setRoomTitle] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [newPermCode, setNewPermCode] = useState('');
  const [shareEnabled, setShareEnabled] = useState('false');
  const [visibility, setVisibility] = useState('private');
  const [saveMsg, setSaveMsg] = useState('');
  const [copyMsg, setCopyMsg] = useState('');

  const id = sessionId || '';
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    if (!id) return;
    try {
      const [snap, strat, notesData, timelineData, healthData] = await Promise.all([
        fetchSessionSnapshot(id, password, permissionCode).catch(() => null),
        fetchStrategy(id).catch(() => null),
        fetchNotes(id, password, permissionCode).catch(() => null),
        fetchTimeline(id, 100).catch(() => null),
        fetchSessionHealth(id).catch(() => null),
      ]);
      if (snap) setSnapshot(snap as SessionSnapshot);
      if (strat) setStrategy(strat);
      if (notesData) setNotes(notesData.notes);
      if (timelineData) setTimeline(timelineData.timeline);
      if (healthData) setHealth(healthData);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id, password, permissionCode]);

  const loadAccess = useCallback(async () => {
    if (!id) return;
    try {
      const a = await fetchSessionAccess(id, password, permissionCode);
      setAccess(a);
      setRoomTitle(a.roomTitle || '');
      setShareEnabled(String(a.shareEnabled));
      setVisibility(a.visibility || 'private');
    } catch { }
  }, [id, password, permissionCode]);

  useEffect(() => {
    loadAll();
    loadAccess();
    fetchRelayInfo().then(setRelayInfo).catch(() => { });
    intervalRef.current = setInterval(loadAll, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSavingNote(true); setNoteMsg('');
    try {
      const lap = noteLap ? parseInt(noteLap, 10) : undefined;
      await addNote(id, { text: noteText.trim(), authorLabel: noteAuthor, category: noteCategory, lap }, password, permissionCode);
      setNoteText(''); setNoteLap('');
      setNoteMsg('✓ Note added');
      loadAll();
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

  async function handleSaveSettings() {
    setSaveMsg('');
    try {
      await patchSessionAccess(id, {
        roomTitle,
        shareEnabled: shareEnabled === 'true',
        visibility: visibility as 'private' | 'code',
        ...(roomPassword ? { roomPassword } : {}),
        ...(newPermCode ? { permissionCode: newPermCode } : {}),
      } as Partial<SessionAccessRecord>);
      setSaveMsg('✓ Saved');
      setRoomPassword(''); setNewPermCode('');
      loadAccess();
    } catch (e) {
      setSaveMsg('✗ ' + String(e));
    } finally {
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopyMsg(`✓ ${label} copied`);
      setTimeout(() => setCopyMsg(''), 2000);
    });
  }

  const s = snapshot || ({} as SessionSnapshot);
  const m = strategy?.metrics;
  const base = relayInfo?.viewerBaseUrl || '';
  const joinUrl = access?.joinCode ? `${base}/join/${access.joinCode}` : '';
  const overlayUrl = access?.joinCode ? `${base}/overlay/join/${access.joinCode}` : '';
  const title = access?.roomTitle || id;
  const primaryCall = strategy?.primaryCall;
  const callCls = callColor(primaryCall);

  return (
    <div className="min-h-screen bg-[#050a0f] text-[#dce8f5] flex flex-col">
      <header className="sticky top-0 z-50 border-b border-[#1a2e42] bg-[#070e18]/95 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-3 h-11 flex items-center gap-3">
          <Link to="/rooms" className="flex items-center gap-1.5 mr-1 text-[#4a6478] hover:text-[#9bb8cc] transition-colors">
            <span className="text-lg leading-none">‹</span>
            <span className="text-[10px] font-mono tracking-widest uppercase">Rooms</span>
          </Link>
          <div className="w-px h-4 bg-[#1a2e42]" />
          <span className="font-['Rajdhani'] text-sm font-bold tracking-widest text-white uppercase truncate max-w-[200px]">
            {title}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {health && <HealthBadge level={health.healthLevel} size="sm" />}
            {s.track && (
              <span className="hidden sm:block text-[10px] font-mono text-[#4a6478] bg-[#0c1520] border border-[#1a2e42] rounded-full px-2.5 py-1">
                {s.track}
              </span>
            )}
            {s.sessionType && (
              <span className="hidden sm:block text-[10px] font-mono text-[#4a6478]">{s.sessionType}</span>
            )}
          </div>
        </div>

        <div className="max-w-[1600px] mx-auto px-3 flex gap-0.5 pb-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-[11px] font-mono tracking-widest uppercase border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-[#4a6478] hover:text-[#9bb8cc]'
              }`}
            >
              {t.label}
              {t.id === 'notes' && notes.length > 0 && (
                <span className="ml-1.5 text-[9px] bg-[#1a2e42] rounded-full px-1.5 py-0.5">{notes.length}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] mx-auto w-full p-3">
        {loading && !snapshot && (
          <div className="flex items-center justify-center py-24 text-[#4a6478] text-sm font-mono">
            Connecting to session...
          </div>
        )}
        {error && (
          <div className="mb-3 rounded border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {tab === 'live' && <LiveTab s={s} strategy={strategy} health={health} />}
        {tab === 'strategy' && <StrategyTab strategy={strategy} />}
        {tab === 'notes' && (
          <NotesTab
            notes={notes}
            hasPermission={hasPermission}
            noteText={noteText} setNoteText={setNoteText}
            noteAuthor={noteAuthor} setNoteAuthor={setNoteAuthor}
            noteCategory={noteCategory} setNoteCategory={setNoteCategory}
            noteLap={noteLap} setNoteLap={setNoteLap}
            noteMsg={noteMsg} savingNote={savingNote}
            onAdd={handleAddNote} onDelete={handleDeleteNote}
          />
        )}
        {tab === 'timeline' && <TimelineTab events={timeline} />}
        {tab === 'settings' && (
          <SettingsTab
            hasPermission={hasPermission}
            access={access}
            relayInfo={relayInfo}
            joinUrl={joinUrl} overlayUrl={overlayUrl}
            copyMsg={copyMsg} onCopy={copy}
            roomTitle={roomTitle} setRoomTitle={setRoomTitle}
            roomPassword={roomPassword} setRoomPassword={setRoomPassword}
            newPermCode={newPermCode} setNewPermCode={setNewPermCode}
            shareEnabled={shareEnabled} setShareEnabled={setShareEnabled}
            visibility={visibility} setVisibility={setVisibility}
            saveMsg={saveMsg} onSave={handleSaveSettings}
            onReload={loadAccess}
          />
        )}
      </main>
    </div>
  );
}

function LiveTab({ s, strategy, health }: { s: SessionSnapshot; strategy: StrategyData | null; health: SessionHealthData | null }) {
  const primaryCall = strategy?.primaryCall;
  const callCls = callColor(primaryCall);
  const m = strategy?.metrics;
  const compColor_ = compoundColor(s.compound);
  const compShort_ = compoundShort(s.compound);
  const hasCall = strategy && !strategy.strategyUnavailable && primaryCall;

  return (
    <div className="space-y-3">
      {hasCall && (
        <div className="rounded-xl border border-[#243d56] bg-gradient-to-r from-[#0c1a28] to-[#0a1520] p-4">
          <div className="text-[9px] font-mono tracking-[0.16em] text-[#4a6478] uppercase mb-1">Strategy Command</div>
          <div className={`font-['Rajdhani'] text-3xl font-bold tracking-wide ${callCls}`}>{primaryCall}</div>
          {strategy?.secondaryCall && (
            <div className="text-sm text-[#5e7a94] mt-0.5">{strategy.secondaryCall}</div>
          )}
          {strategy?.confidence != null && (
            <div className="mt-2 text-[10px] font-mono text-[#4a6478]">
              conf. {fmtPct(strategy.confidence)} · stability {safe(strategy.stability)}
              {strategy.pitWindowEta != null && ` · pit ETA ${strategy.pitWindowEta} laps`}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <MetricCard label="Lap" value={safe(s.lap)} sub={s.totalLaps ? `/ ${s.totalLaps} total` : undefined} />
        <MetricCard label="Position" value={safe(s.position)} sub={s.bestLapMs ? `best ${fmtLapTime(s.bestLapMs)}` : undefined} accent={s.position === 1 ? 'amber' : 'default'} />
        <MetricCard
          label="Tyre"
          value={<span style={{ color: compColor_ }}>{compShort_}</span>}
          sub={s.tyreAge != null ? `age ${s.tyreAge} laps` : undefined}
        />
        <MetricCard label="Fuel Laps" value={safe(s.fuelLaps)} sub={s.fuelKg != null ? `${s.fuelKg.toFixed(1)} kg` : undefined} accent={s.fuelLaps != null && s.fuelLaps < 3 ? 'red' : 'default'} />
        <MetricCard label="ERS" value={s.ersPercent != null ? fmtPct(s.ersPercent) : '-'} sub="energy store" accent={s.ersPercent != null && s.ersPercent < 20 ? 'amber' : 'default'} />
        <MetricCard label="Speed" value={s.speed != null ? `${Math.round(s.speed)}` : '-'} sub={s.gear != null ? `gear ${s.gear}` : undefined} />
      </div>

      {(s.throttle != null || s.brake != null || s.lastLapMs != null) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {s.lastLapMs != null && <MetricCard label="Last Lap" value={fmtLapTime(s.lastLapMs)} sub={s.track || undefined} />}
          {s.throttle != null && <MetricCard label="Throttle" value={`${Math.round(s.throttle)}%`} />}
          {s.brake != null && <MetricCard label="Brake" value={`${Math.round(s.brake)}%`} accent={s.brake > 50 ? 'red' : 'default'} />}
        </div>
      )}

      {m && (
        <div>
          <div className="text-[9px] font-mono tracking-[0.14em] text-[#3a5570] uppercase mb-2">Strategy Metrics</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Traffic Exposure', key: 'trafficExposure' },
              { label: 'Tyre/Fuel Stress', key: 'tyreFuelStress' },
              { label: 'Execution Readiness', key: 'executionReadiness' },
              { label: 'Clean Air Prob.', key: 'cleanAirProbability' },
            ].map(({ label, key }) => {
              const v = m?.[key as keyof typeof m] as number | undefined;
              return <MetricCard key={key} label={label} value={v != null ? fmtPct(v) : '-'} accent={v != null ? (v > 75 ? 'red' : v > 40 ? 'amber' : 'green') : 'default'} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StrategyTab({ strategy }: { strategy: StrategyData | null }) {
  const m = strategy?.metrics;
  const primaryCall = strategy?.primaryCall;
  const callCls = callColor(primaryCall);

  if (!strategy || strategy.strategyUnavailable) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-[#4a6478] text-sm font-mono gap-2">
        <div className="text-3xl">📡</div>
        <div>{strategy?.reason || 'Awaiting telemetry data...'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#243d56] bg-gradient-to-r from-[#0c1a28] to-[#0a1520] p-5">
        <div className="text-[9px] font-mono tracking-[0.16em] text-[#4a6478] uppercase mb-2">Primary Call</div>
        <div className={`font-['Rajdhani'] text-4xl font-bold tracking-wide ${callCls}`}>{primaryCall || '-'}</div>
        {strategy.secondaryCall && (
          <div className="text-base text-[#5e7a94] mt-1.5">{strategy.secondaryCall}</div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs font-mono text-[#4a6478]">
          {strategy.confidence != null && <span>Confidence <span className="text-[#9bb8cc]">{fmtPct(strategy.confidence)}</span></span>}
          {strategy.stability && <span>Stability <span className="text-[#9bb8cc]">{strategy.stability}</span></span>}
          {strategy.pitWindowEta != null && <span>Pit Window ETA <span className="text-amber-400">{strategy.pitWindowEta} laps</span></span>}
        </div>
      </div>

      {m && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4 space-y-3">
            <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase">Race Position Metrics</div>
            {[
              { label: 'Undercut Score', value: m.undercutScore },
              { label: 'Overcut Score', value: m.overcutScore },
              { label: 'Traffic Exposure', value: m.trafficExposure },
              { label: 'Clean Air Probability', value: m.cleanAirProbability },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="font-mono text-[#4a6478]">{label}</span>
                  <span className="font-mono font-bold text-[#dce8f5]">{value != null ? fmtPct(value) : '-'}</span>
                </div>
                <ScoreBar value={value} />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4 space-y-3">
            <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase">Car Condition Metrics</div>
            {[
              { label: 'Tyre Urgency', value: m.tyreUrgency },
              { label: 'Fuel Risk', value: m.fuelRisk },
              { label: 'Tyre/Fuel Stress', value: m.tyreFuelStress },
              { label: 'Execution Readiness', value: m.executionReadiness },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="font-mono text-[#4a6478]">{label}</span>
                  <span className="font-mono font-bold text-[#dce8f5]">{value != null ? fmtPct(value) : '-'}</span>
                </div>
                <ScoreBar value={value} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface NotesTabProps {
  notes: SessionNote[];
  hasPermission: boolean;
  noteText: string; setNoteText: (v: string) => void;
  noteAuthor: string; setNoteAuthor: (v: string) => void;
  noteCategory: string; setNoteCategory: (v: string) => void;
  noteLap: string; setNoteLap: (v: string) => void;
  noteMsg: string;
  savingNote: boolean;
  onAdd: (e: React.FormEvent) => void;
  onDelete: (id: string) => void;
}

function NotesTab({ notes, hasPermission, noteText, setNoteText, noteAuthor, setNoteAuthor, noteCategory, setNoteCategory, noteLap, setNoteLap, noteMsg, savingNote, onAdd, onDelete }: NotesTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
      <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
        <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-3">Session Notes</div>
        <div className="space-y-2 max-h-[70vh] overflow-y-auto scrollbar-thin pr-1">
          {notes.length === 0 && (
            <div className="text-center py-16 text-[#3a5570] text-sm font-mono">No notes yet.</div>
          )}
          {notes.slice().reverse().map(note => (
            <div key={note.id} className={`rounded-lg border p-3 ${categoryColors[note.category || 'general'] || categoryColors.general}`}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex gap-1.5 flex-wrap">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-wider ${categoryColors[note.category || 'general']}`}>
                    {note.category || 'general'}
                  </span>
                  {note.authorLabel && <span className="text-[9px] font-mono text-[#4a6478]">{note.authorLabel}</span>}
                  {note.lap != null && <span className="text-[9px] font-mono text-[#4a6478]">L{note.lap}</span>}
                </div>
                {hasPermission && (
                  <button onClick={() => onDelete(note.id)} className="text-[9px] text-[#3a5570] hover:text-red-400 transition-colors flex-shrink-0">✕</button>
                )}
              </div>
              <div className="text-sm text-[#dce8f5] leading-relaxed">{note.text}</div>
              <div className="text-[9px] font-mono text-[#3a5570] mt-1.5">{fmtRelTime(note.createdAt)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
        {hasPermission ? (
          <form onSubmit={onAdd} className="space-y-3">
            <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Add Note</div>
            <textarea
              value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="예: undercut 준비, outlap traffic 재평가 필요"
              maxLength={400} rows={4}
              className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-3 py-2.5 text-sm text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700 resize-none transition-colors"
            />
            <div className="grid grid-cols-3 gap-2">
              <select value={noteAuthor} onChange={e => setNoteAuthor(e.target.value)}
                className="bg-[#070e18] border border-[#1a2e42] rounded px-2 py-2 text-xs text-[#dce8f5] focus:outline-none col-span-2">
                {['Engineer', 'Strategist', 'Pit Wall', 'Observer'].map(v => <option key={v}>{v}</option>)}
              </select>
              <input value={noteLap} onChange={e => setNoteLap(e.target.value)} type="number" min="0" placeholder="lap"
                className="bg-[#070e18] border border-[#1a2e42] rounded px-2 py-2 text-xs text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none text-center" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {['general', 'strategy', 'incident', 'pit', 'risk'].map(cat => (
                <button key={cat} type="button" onClick={() => setNoteCategory(cat)}
                  className={`px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider rounded border transition-colors ${
                    noteCategory === cat
                      ? categoryColors[cat].replace('bg-', 'bg-opacity-60 bg-')
                      : 'border-[#1a2e42] text-[#4a6478] hover:border-[#2a3e50]'
                  }`}>
                  {cat}
                </button>
              ))}
            </div>
            <button type="submit" disabled={savingNote || !noteText.trim()}
              className="w-full py-2.5 rounded border border-cyan-800 bg-cyan-950/40 text-xs text-cyan-400 hover:bg-cyan-900/40 transition-colors disabled:opacity-40 font-mono font-bold tracking-widest uppercase">
              {savingNote ? 'Adding...' : 'Add Note'}
            </button>
            {noteMsg && (
              <div className={`text-[10px] font-mono ${noteMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{noteMsg}</div>
            )}
          </form>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center gap-3">
            <div className="text-3xl text-[#1a2e42]">🔒</div>
            <div className="text-sm text-[#3a5570] font-mono">Permission Code가 필요합니다</div>
            <div className="text-xs text-[#2a3e50]">로비에서 Permission Code를 입력하고 재입장하세요.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineTab({ events }: { events: TimelineEvent[] }) {
  const typeColor: Record<string, string> = {
    pit_stop: 'text-amber-400',
    fastest_lap: 'text-purple-400',
    safety_car: 'text-yellow-400',
    session_started: 'text-emerald-400',
    session_ended: 'text-red-400',
  };

  return (
    <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
      <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-3">Event Timeline</div>
      {events.length === 0 ? (
        <div className="text-center py-20 text-[#3a5570] text-sm font-mono">No events yet.</div>
      ) : (
        <div className="space-y-1.5 max-h-[70vh] overflow-y-auto scrollbar-thin pr-1">
          {events.slice().reverse().map((ev, i) => (
            <div key={ev.eventId || i} className="rounded border border-[#1a2e42] bg-[#0a1520] px-3 py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-mono font-bold ${typeColor[ev.type] || 'text-sky-400'}`}>{ev.type}</span>
                  {ev.lap != null && <span className="text-[9px] font-mono text-[#4a6478]">Lap {ev.lap}</span>}
                </div>
                {ev.data && Object.keys(ev.data).length > 0 && (
                  <div className="mt-0.5 text-[9px] font-mono text-[#3a5570] truncate">
                    {Object.entries(ev.data).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </div>
                )}
              </div>
              <span className="text-[9px] font-mono text-[#3a5570] flex-shrink-0">{fmtRelTime(ev.timestamp)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsTabProps {
  hasPermission: boolean;
  access: SessionAccessRecord | null;
  relayInfo: { viewerBaseUrl?: string; relayLabel?: string } | null;
  joinUrl: string; overlayUrl: string;
  copyMsg: string; onCopy: (text: string, label: string) => void;
  roomTitle: string; setRoomTitle: (v: string) => void;
  roomPassword: string; setRoomPassword: (v: string) => void;
  newPermCode: string; setNewPermCode: (v: string) => void;
  shareEnabled: string; setShareEnabled: (v: string) => void;
  visibility: string; setVisibility: (v: string) => void;
  saveMsg: string; onSave: () => void;
  onReload: () => void;
}

function SettingsTab({ hasPermission, access, relayInfo, joinUrl, overlayUrl, copyMsg, onCopy, roomTitle, setRoomTitle, roomPassword, setRoomPassword, newPermCode, setNewPermCode, shareEnabled, setShareEnabled, visibility, setVisibility, saveMsg, onSave, onReload }: SettingsTabProps) {
  const inp = "w-full bg-[#070e18] border border-[#1a2e42] rounded px-3 py-2 text-sm text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700 transition-colors";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="space-y-3">
        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-3">Room Info</div>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between py-1.5 border-b border-[#1a2e42]">
              <span className="text-[#4a6478]">Session ID</span>
              <span className="text-[#dce8f5] truncate max-w-[200px]">{access?.sessionId || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1a2e42]">
              <span className="text-[#4a6478]">Join Code</span>
              <span className="text-cyan-400 font-bold">{access?.joinCode || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1a2e42]">
              <span className="text-[#4a6478]">Relay</span>
              <span className="text-[#9bb8cc]">{relayInfo?.relayLabel || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1a2e42]">
              <span className="text-[#4a6478]">Driver</span>
              <span className="text-[#9bb8cc]">{access?.driverLabel || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#4a6478]">Car</span>
              <span className="text-[#9bb8cc]">{access?.carLabel || '-'}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-3">Share Links</div>
          <div className="space-y-2">
            <div>
              <div className="text-[10px] font-mono text-[#4a6478] mb-1">Viewer Join URL</div>
              <div className="flex gap-2">
                <input readOnly value={joinUrl} className={inp + ' text-[11px] text-cyan-400/80 cursor-text'} />
                <button onClick={() => onCopy(joinUrl, 'Join URL')} className="px-3 rounded border border-[#1a2e42] text-xs text-[#5e7a94] hover:bg-white/5 whitespace-nowrap transition-colors">Copy</button>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono text-[#4a6478] mb-1">OBS Overlay URL</div>
              <div className="flex gap-2">
                <input readOnly value={overlayUrl} className={inp + ' text-[11px] text-purple-400/80 cursor-text'} />
                <button onClick={() => onCopy(overlayUrl, 'Overlay URL')} className="px-3 rounded border border-[#1a2e42] text-xs text-[#5e7a94] hover:bg-white/5 whitespace-nowrap transition-colors">Copy</button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onCopy(access?.joinCode || '', 'Join Code')} className="px-3 py-1.5 rounded border border-[#1a2e42] text-xs text-[#5e7a94] hover:bg-white/5 transition-colors">Copy Code</button>
              {overlayUrl && (
                <a href={overlayUrl} target="_blank" rel="noopener" className="px-3 py-1.5 rounded border border-purple-800 text-xs text-purple-400 hover:bg-purple-950/30 transition-colors">Open Overlay ↗</a>
              )}
            </div>
            {copyMsg && <div className="text-[10px] font-mono text-emerald-400">{copyMsg}</div>}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
        {hasPermission ? (
          <div className="space-y-3">
            <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase">Room Settings</div>
            <div>
              <label className="block text-[10px] font-mono text-[#4a6478] mb-1">Room Title</label>
              <input value={roomTitle} onChange={e => setRoomTitle(e.target.value)} placeholder="Room Title" className={inp} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-[#4a6478] mb-1">New Password</label>
              <input value={roomPassword} onChange={e => setRoomPassword(e.target.value)} placeholder="변경할 경우 입력 (선택)" type="text" className={inp} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-[#4a6478] mb-1">New Permission Code</label>
              <input value={newPermCode} onChange={e => setNewPermCode(e.target.value)} placeholder="변경할 경우 입력 (선택)" className={inp} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-mono text-[#4a6478] mb-1">Share</label>
                <select value={shareEnabled} onChange={e => setShareEnabled(e.target.value)}
                  className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-3 py-2 text-sm text-[#dce8f5] focus:outline-none focus:border-cyan-700">
                  <option value="false">OFF</option>
                  <option value="true">ON</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-mono text-[#4a6478] mb-1">Visibility</label>
                <select value={visibility} onChange={e => setVisibility(e.target.value)}
                  className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-3 py-2 text-sm text-[#dce8f5] focus:outline-none focus:border-cyan-700">
                  <option value="private">Private</option>
                  <option value="code">By Code</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={onSave}
                className="flex-1 py-2.5 rounded bg-gradient-to-r from-cyan-800 to-cyan-700 border border-cyan-600 text-sm text-white font-['Rajdhani'] font-bold tracking-widest uppercase hover:brightness-110 transition-all">
                Apply Changes
              </button>
              <button onClick={onReload}
                className="px-4 py-2.5 rounded border border-[#1a2e42] text-sm text-[#5e7a94] hover:bg-white/5 transition-colors">
                Reload
              </button>
            </div>
            {saveMsg && (
              <div className={`text-[10px] font-mono ${saveMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg}</div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center gap-3">
            <div className="text-3xl text-[#1a2e42]">🔒</div>
            <div className="text-sm text-[#3a5570] font-mono">Permission Code가 필요합니다</div>
            <div className="text-xs text-[#2a3e50]">룸 설정을 변경하려면<br />Permission Code로 재입장하세요.</div>
          </div>
        )}
      </div>
    </div>
  );
}
