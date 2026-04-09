import { useEffect, useState, useCallback, useRef, useMemo, type FormEvent } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import HealthBadge from '../components/HealthBadge';
import type {
  CarSnapshot,
  DriverSnapshot,
  StrategyActionName,
  StrategyData,
  StrategySimulationMeta,
  SessionNote,
  TimelineEvent,
  SessionHealthData,
  SessionAccessRecord,
  SessionSnapshot,
} from '../types';
import {
  fetchStrategy, fetchNotes, addNote, deleteNote, fetchTimeline,
  fetchSessionAccess, fetchSessionHealth, fetchRelayInfo,
  fetchSessionSnapshot, patchSessionAccess, executeSessionAction,
} from '../lib/api';
import { fmtPct, fmtRelTime } from '../lib/formatters';

type ConsoleTab = 'live' | 'strategy' | 'replay' | 'notes' | 'timeline' | 'settings';

const CONSOLE_TABS: { id: ConsoleTab; label: string }[] = [
  { id: 'live', label: '실시간 현황' },
  { id: 'strategy', label: '전략' },
  { id: 'replay', label: '리플레이' },
  { id: 'notes', label: '무전내역' },
  { id: 'timeline', label: '타임라인' },
  { id: 'settings', label: '설정' },
];

const categoryColors: Record<string, string> = {
  strategy: 'text-cyan-400 border-cyan-800 bg-cyan-950/20',
  incident: 'text-red-400 border-red-800 bg-red-950/20',
  pit: 'text-amber-400 border-amber-800 bg-amber-950/20',
  risk: 'text-orange-400 border-orange-800 bg-orange-950/20',
  general: 'text-[#5e7a94] border-[#1a2e42] bg-[#0a1520]',
};

function ScoreBar({ value }: { value?: number | null }) {
  const pct = value != null ? Math.min(100, Math.max(0, value)) : 0;
  const color = pct > 75 ? '#ef4444' : pct > 40 ? '#f59e0b' : '#10b981';
  return (
    <div className="mt-1.5 h-1 rounded-full bg-[#1a2e42] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function callColor(call?: string | null) {
  if (!call) return 'text-[#5e7a94]';
  if (call.includes('PIT NOW') || call.includes('BOX')) return 'text-red-400';
  if (call.includes('STAY OUT') || call.includes('STAY')) return 'text-emerald-400';
  return 'text-cyan-300';
}

function TyreGauge({ label, temp, wear }: { label: string; temp?: number | null; wear?: number | null }) {
  const wearPct = wear != null ? Math.min(100, Math.max(0, wear)) : 0;
  const tempColor = temp != null ? (temp > 110 ? '#ef4444' : temp > 90 ? '#f59e0b' : '#61d6df') : '#5e7a94';
  return (
    <div className="border border-[#1a2e42] bg-[#070e18] p-2 text-center">
      <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-1">{label}</div>
      <div className="text-sm font-mono font-bold" style={{ color: tempColor }}>
        {temp != null ? `${Math.round(temp)}°` : '--'}
      </div>
      <div className="mt-1 text-[8px] font-mono text-[#4a6478]">
        {wear != null ? `${Math.round(wear)}% CARC` : 'CARC --'}
      </div>
      <div className="mt-1 h-1 bg-[#1a2e42] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${100 - wearPct}%`, background: tempColor }} />
      </div>
    </div>
  );
}

type TrackPoint = readonly [number, number];

interface TrackPathData {
  id: string;
  label: string;
  source: 'preset' | 'external';
  points: TrackPoint[];
}

interface TyreChartSeriesData {
  baselineSeries: TrackPoint[];
  modelSeries: TrackPoint[];
  pitMarkerX: number;
  baselineLabel?: string;
  modelLabel?: string;
}

const TRACK_PATH_PRESETS: Record<string, TrackPathData> = {
  monza: { id: 'monza', label: 'Monza', source: 'preset', points: [[42, 168], [58, 84], [120, 54], [196, 70], [250, 52], [264, 102], [230, 128], [264, 182], [228, 230], [148, 246], [88, 216], [56, 182], [42, 168]] },
  silverstone: { id: 'silverstone', label: 'Silverstone', source: 'preset', points: [[38, 188], [54, 122], [88, 78], [138, 52], [198, 64], [248, 100], [264, 146], [232, 174], [258, 214], [214, 246], [150, 228], [110, 248], [64, 226], [38, 188]] },
  spa: { id: 'spa', label: 'Spa', source: 'preset', points: [[36, 220], [52, 144], [84, 88], [138, 44], [212, 58], [260, 98], [240, 144], [262, 196], [216, 244], [138, 256], [82, 222], [52, 246], [36, 220]] },
  suzuka: { id: 'suzuka', label: 'Suzuka', source: 'preset', points: [[54, 202], [88, 128], [64, 86], [120, 52], [182, 76], [144, 126], [198, 156], [248, 116], [262, 176], [210, 222], [148, 248], [96, 224], [54, 202]] },
  monaco: { id: 'monaco', label: 'Monaco', source: 'preset', points: [[70, 226], [56, 164], [82, 116], [74, 66], [130, 52], [178, 88], [222, 74], [248, 124], [214, 154], [238, 206], [184, 236], [130, 214], [96, 244], [70, 226]] },
  generic: { id: 'generic', label: 'Generic Circuit', source: 'preset', points: [[40, 184], [58, 112], [96, 64], [154, 48], [216, 70], [258, 110], [246, 154], [264, 212], [212, 248], [150, 232], [104, 248], [68, 220], [40, 184]] },
};

function buildTrackPathData(trackId?: number | null, trackName?: string | null): TrackPathData {
  const name = String(trackName || '').toLowerCase();
  if (name.includes('monza') || name.includes('italy')) return TRACK_PATH_PRESETS.monza;
  if (name.includes('silverstone') || name.includes('brit')) return TRACK_PATH_PRESETS.silverstone;
  if (name.includes('spa') || name.includes('belg')) return TRACK_PATH_PRESETS.spa;
  if (name.includes('suzuka') || name.includes('japan')) return TRACK_PATH_PRESETS.suzuka;
  if (name.includes('monaco')) return TRACK_PATH_PRESETS.monaco;

  switch (trackId) {
    case 7:
    case 11:
      return TRACK_PATH_PRESETS.monza;
    case 8:
    case 9:
      return TRACK_PATH_PRESETS.silverstone;
    case 10:
      return TRACK_PATH_PRESETS.spa;
    case 14:
      return TRACK_PATH_PRESETS.suzuka;
    case 5:
      return TRACK_PATH_PRESETS.monaco;
    default:
      return TRACK_PATH_PRESETS.generic;
  }
}

function buildTyreChartSeriesData({
  tyreAge,
  urgency,
  degradationTrend,
}: {
  tyreAge?: number | null;
  urgency?: number | null;
  degradationTrend?: number | null;
}): TyreChartSeriesData {
  const age = tyreAge ?? 0;
  const urg = urgency ?? 35;
  const trend = Math.max(0, Math.min(100, degradationTrend ?? urg));
  const pitMarkerX = 20 + Math.max(0, Math.min(8, Math.max(1, Math.round((100 - ((urg * 0.55) + (trend * 0.45))) / 11)))) * 32;

  const baselineSeries: TrackPoint[] = [];
  const modelSeries: TrackPoint[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = 20 + i * 32;
    const modelY = 28 + i * (4.4 + trend / 60) + age * 0.42;
    const baselineY = 36 + i * 3.8 + age * 0.18;
    modelSeries.push([x, Number(Math.min(130, modelY).toFixed(1))]);
    baselineSeries.push([x, Number(Math.min(130, baselineY).toFixed(1))]);
  }

  return {
    baselineSeries,
    modelSeries,
    pitMarkerX,
    baselineLabel: 'BASELINE',
    modelLabel: 'MODEL',
  };
}

function pointOnPolyline(points: TrackPoint[], progress: number) {
  const normalized = ((progress % 1) + 1) % 1;
  const segments: Array<{ start: TrackPoint; end: TrackPoint; length: number }> = [];
  let totalLength = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    segments.push({ start, end, length });
    totalLength += length;
  }

  const target = normalized * totalLength;
  let cursor = 0;
  for (const segment of segments) {
    if (cursor + segment.length >= target) {
      const local = segment.length === 0 ? 0 : (target - cursor) / segment.length;
      const x = segment.start[0] + (segment.end[0] - segment.start[0]) * local;
      const y = segment.start[1] + (segment.end[1] - segment.start[1]) * local;
      const angle = Math.atan2(segment.end[1] - segment.start[1], segment.end[0] - segment.start[0]);
      return { x, y, angle };
    }
    cursor += segment.length;
  }

  const last = segments[segments.length - 1] ?? { start: [150, 150] as TrackPoint, end: [150, 150] as TrackPoint, length: 0 };
  return { x: last.end[0], y: last.end[1], angle: Math.atan2(last.end[1] - last.start[1], last.end[0] - last.start[0]) };
}

function TyreDegradationChart({ baselineSeries, modelSeries, pitMarkerX, baselineLabel = 'BASELINE', modelLabel = 'MODEL' }: TyreChartSeriesData) {
  const baselinePoints = baselineSeries.map(([x, y]) => `${x},${y}`).join(' ');
  const modelPoints = modelSeries.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <svg viewBox="0 0 300 140" className="w-full" style={{ height: 110 }} role="img" aria-label="degradation chart">
      <rect x="0" y="0" width="300" height="140" fill="rgba(6,11,18,0.92)" />
      <polyline points={baselinePoints} fill="none" stroke="#8d9db2" strokeWidth="2" strokeDasharray="5 3" opacity="0.85" />
      <polyline points={modelPoints} fill="none" stroke="#61d6df" strokeWidth="2.2" />
      <line x1={pitMarkerX.toFixed(1)} y1="8" x2={pitMarkerX.toFixed(1)} y2="132" stroke="#f3bf52" strokeWidth="1" strokeDasharray="4 4" />
      <text x="8" y="18" fill="#8d9db2" fontSize="8" fontFamily="monospace">{baselineLabel}</text>
      <text x="8" y="138" fill="#8d9db2" fontSize="8" fontFamily="monospace">{modelLabel}</text>
      <text x={pitMarkerX - 4} y="6" fill="#f3bf52" fontSize="7" fontFamily="monospace">PIT</text>
    </svg>
  );
}

function TrackMapSvg({ rows, playerPos, trackPath }: { rows: CarSnapshot[]; playerPos?: number | null; trackPath: TrackPoint[] }) {
  const maxPos = Math.max(1, rows.length || 20);
  const points = trackPath.length > 1 ? trackPath : TRACK_PATH_PRESETS.generic.points;
  const trackLine = points.map((point) => `${point[0]},${point[1]}`).join(' ');
  const start = points[0] ?? ([40, 184] as TrackPoint);

  const markers = rows.slice(0, 15).map((row) => {
    const pos = Number.isFinite(row.position) && row.position != null ? row.position : maxPos;
    const progress = maxPos <= 1 ? 0 : (pos - 1) / Math.max(1, maxPos - 1);
    const { x, y, angle } = pointOnPolyline(points, progress);
    const isPlayer = pos === playerPos;
    const rotation = (angle * 180) / Math.PI + 90;
    const markerPoints = isPlayer
      ? `${x},${y - 6} ${x + 5},${y + 4} ${x - 5},${y + 4}`
      : `${x},${y - 4} ${x + 3.5},${y + 3} ${x - 3.5},${y + 3}`;

    return (
      <polygon
        key={row.carIndex}
        points={markerPoints}
        fill={isPlayer ? '#61d6df' : '#8d9db2'}
        opacity={isPlayer ? 1 : 0.78}
        transform={`rotate(${rotation.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})`}
      />
    );
  });

  return (
    <svg viewBox="0 0 300 300" className="w-full" style={{ maxHeight: 260 }} role="img" aria-label="circuit map">
      <rect x="0" y="0" width="300" height="300" fill="rgba(6,11,18,0.95)" />
      <polyline points={trackLine} fill="none" stroke="rgba(97,214,223,0.18)" strokeWidth="18" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={trackLine} fill="none" stroke="rgba(49,71,96,0.95)" strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={trackLine} fill="none" stroke="#61d6df" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={String(start[0] - 8)} y1={String(start[1] - 10)} x2={String(start[0] + 8)} y2={String(start[1] + 10)} stroke="#f3bf52" strokeWidth="2" />
      <circle cx={String(start[0])} cy={String(start[1])} r="3" fill="rgba(97,214,223,0.7)" />
      {markers}
    </svg>
  );
}

export default function RoomPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const qp = new URLSearchParams(location.search);
  const password = qp.get('password') || '';
  const permissionCode = qp.get('permissionCode') || '';
  const hasPermission = !!permissionCode;

  const [tab, setTab] = useState<ConsoleTab>('live');
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
  const [actionMsg, setActionMsg] = useState('');
  const [pendingAction, setPendingAction] = useState<StrategyActionName | null>(null);

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
  }, [loadAll, loadAccess]);

  async function handleAddNote(e: FormEvent<HTMLFormElement>) {
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
      setNotes((prev: SessionNote[]) => prev.filter((n: SessionNote) => (n.id ?? n.noteId) !== noteId));
    } catch { }
  }

  async function handleExecuteAction(action: StrategyActionName) {
    if (!id || pendingAction) return;
    setPendingAction(action);
    setActionMsg('');
    try {
      const currentLapRaw = snapshot?.sessionMeta?.currentLap ?? snapshot?.lap;
      const currentLap = Number.isFinite(currentLapRaw) ? Number(currentLapRaw) : undefined;
      const response = await executeSessionAction(
        id,
        {
          action,
          lap: currentLap,
          authorLabel: hasPermission ? 'Strategist' : 'Engineer',
        },
        password,
        permissionCode
      );
      setActionMsg(`✓ ${response.action.label} logged`);
      await loadAll();
    } catch (e) {
      setActionMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPendingAction(null);
      setTimeout(() => setActionMsg(''), 3500);
    }
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
  const base = relayInfo?.viewerBaseUrl || '';
  const joinUrl = access?.joinCode ? `${base}/join/${access.joinCode}` : '';
  const title = access?.roomTitle || id;

  return (
    <div className="min-h-screen bg-[#060b12] text-[#e6edf6] flex flex-col" style={{ fontFamily: '"Rajdhani","DIN Alternate","Segoe UI",sans-serif' }}>
      <header className="sticky top-0 z-50 border-b border-[#243247] bg-[#080d15]/95 backdrop-blur-sm">
        <div className="w-full px-3 h-14 flex items-center gap-0" style={{ background: 'rgba(8,13,21,0.92)' }}>
          <Link to="/rooms" className="flex items-center gap-1.5 mr-3 text-[#4a6478] hover:text-[#9bb8cc] transition-colors">
            <span className="text-lg leading-none">‹</span>
            <span className="text-[10px] font-mono tracking-widest uppercase">Rooms</span>
          </Link>
          <div className="w-px h-5 bg-[#243247] mr-3" />
          <div className="text-[#61d6df] font-bold text-xl uppercase tracking-widest">MPP STRATEGIC CONSOLE</div>
          <div className="ml-4 hidden sm:flex items-center gap-2">
            <span className="text-[10px] font-mono text-[#4a6478] uppercase">SESSION {title}</span>
            {s.track && (
              <span className="text-[10px] font-mono text-[#4a6478] border border-[#243247] px-2 py-0.5">{s.track}</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {health && <HealthBadge level={health.healthLevel} size="sm" />}
            {s.lap != null && s.totalLaps != null && (
              <span className="text-[10px] font-mono text-[#8d9db2] border border-[#243247] px-2 py-1">
                LAPS {s.lap}/{s.totalLaps}
              </span>
            )}
          </div>
        </div>
        <div className="w-full flex border-t border-[#243247] overflow-x-auto">
          {CONSOLE_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2.5 text-[11px] font-mono tracking-widest uppercase border-b-2 whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'border-[#61d6df] text-[#61d6df] bg-[rgba(97,214,223,0.07)]'
                  : 'border-transparent text-[#8d9db2] hover:text-[#e6edf6] hover:bg-[rgba(97,214,223,0.05)]'
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

      <main className="flex-1 w-full">
        {loading && !snapshot && (
          <div className="flex items-center justify-center py-24 text-[#4a6478] text-sm font-mono">
            Connecting to session...
          </div>
        )}
        {error && (
          <div className="m-3 rounded border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {tab === 'live' && (
          <StrategicConsoleTab
            s={s}
            strategy={strategy}
            health={health}
            timeline={timeline}
            access={access}
            hasPermission={hasPermission}
            pendingAction={pendingAction}
            actionMsg={actionMsg}
            onExecuteAction={handleExecuteAction}
          />
        )}
        {tab === 'strategy' && <StrategyTab strategy={strategy} />}
        {tab === 'replay' && (
          <div className="flex flex-col items-center justify-center py-24 text-[#4a6478] gap-3">
            <div className="text-4xl opacity-20">⏮</div>
            <div className="text-sm font-mono uppercase tracking-widest">REPLAY MODE</div>
            {access?.joinCode && (
              <a
                href={`/console/replay?sessionId=${encodeURIComponent(id)}`}
                className="mt-2 px-4 py-2 border border-[#61d6df] text-[#61d6df] text-xs font-mono tracking-widest uppercase hover:bg-[rgba(97,214,223,0.08)] transition-colors"
              >
                OPEN KINETIC INSTRUMENT V1 →
              </a>
            )}
          </div>
        )}
        {tab === 'notes' && (
          <div className="p-3">
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
          </div>
        )}
        {tab === 'timeline' && (
          <div className="p-3">
            <TimelineTab events={timeline} />
          </div>
        )}
        {tab === 'settings' && (
          <div className="p-3">
            <SettingsTab
              hasPermission={hasPermission}
              access={access}
              relayInfo={relayInfo}
              joinUrl={joinUrl}
              copyMsg={copyMsg} onCopy={copy}
              roomTitle={roomTitle} setRoomTitle={setRoomTitle}
              roomPassword={roomPassword} setRoomPassword={setRoomPassword}
              newPermCode={newPermCode} setNewPermCode={setNewPermCode}
              shareEnabled={shareEnabled} setShareEnabled={setShareEnabled}
              visibility={visibility} setVisibility={setVisibility}
              saveMsg={saveMsg} onSave={handleSaveSettings}
              onReload={loadAccess}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function StrategicConsoleTab({ s, strategy, health, timeline, access, hasPermission, pendingAction, actionMsg, onExecuteAction }: {
  s: SessionSnapshot;
  strategy: StrategyData | null;
  health: SessionHealthData | null;
  timeline: TimelineEvent[];
  access: SessionAccessRecord | null;
  hasPermission: boolean;
  pendingAction: StrategyActionName | null;
  actionMsg: string;
  onExecuteAction: (action: StrategyActionName) => void;
}) {
  const m = strategy?.metrics;
  const sig = strategy?.signals;
  const simMeta = strategy?.simulationMeta;
  const primaryCall = strategy?.primaryRecommendation ?? strategy?.recommendation ?? strategy?.primaryCall;
  const callCls = callColor(primaryCall);

  const allCars: CarSnapshot[] = s.cars ? Object.values(s.cars) : [];
  const allDrivers: Record<number, DriverSnapshot> = s.drivers ?? {};
  const playerIdx = s.playerCarIndex;

  const [selectedCarIndex, setSelectedCarIndex] = useState<number | null>(null);

  const rows = useMemo(() =>
    allCars
      .filter(c => c != null && Number.isFinite(c.position))
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
    [allCars]
  );

  const activeCarIndex = selectedCarIndex ?? playerIdx ?? null;
  const activeCar = activeCarIndex != null ? (s.cars?.[activeCarIndex] ?? null) : null;
  const playerCar = playerIdx != null ? (s.cars?.[playerIdx] ?? null) : null;
  const playerPos = playerCar?.position ?? s.position;
  const trackId = s.sessionMeta?.trackId ?? null;
  const trackName = s.track ?? s.sessionMeta?.track ?? null;
  const trackPathData = useMemo(() => buildTrackPathData(trackId, trackName), [trackId, trackName]);

  const temps = activeCar?.tyreTemp ?? s.tyreTemps ?? s.tyreSurfaceTemp;
  const wears = activeCar?.tyreWear ?? s.tyreWear ?? s.tyreCarcassDamage;
  const tyreLabels = ['FL', 'FR', 'RL', 'RR'];

  const fuelLaps = s.fuelLapsRemaining ?? s.fuelLaps;
  const lapsRemaining = s.totalLaps != null && s.lap != null ? s.totalLaps - s.lap : null;
  const fuelMargin = fuelLaps != null && lapsRemaining != null ? (fuelLaps - lapsRemaining) : null;
  const fuelText = fuelMargin != null ? ((fuelMargin >= 0 ? '+' : '') + fuelMargin.toFixed(2) + ' LAPS') : '-';

  const tyreAge = s.tyreAge ?? (activeCar?.tyreAgeLaps ?? null);
  const stintPhaseParts = tyreAge != null ? `L${Math.round(tyreAge)}` : 'L-';

  const damage = activeCar?.damage;
  const wingLossText = (() => {
    if (!damage) return '-';
    const fl = damage.frontWingLeft;
    const fr = damage.frontWingRight;
    if (!Number.isFinite(fl) || !Number.isFinite(fr) || fl == null || fr == null) return '-';
    return (((fl + fr) / 200) * 0.15).toFixed(3) + 's/LAP';
  })();

  const engineWear = (() => {
    const eng = damage?.engine;
    if (!Number.isFinite(eng) || eng == null) return 'UNKNOWN';
    if (eng < 20) return 'NOMINAL';
    if (eng < 50) return 'ELEVATED';
    return 'CRITICAL';
  })();

  const worst = (() => {
    if (!Array.isArray(wears)) return null;
    const nums = wears.filter(Number.isFinite);
    return nums.length > 0 ? Math.max(...nums) : null;
  })();
  const worstWearPct = worst != null ? Math.max(0, 100 - worst) : null;

  const ersValue = s.ersPercent ?? (activeCar?.ersLevel ?? null);
  const ersEndLap = sig?.ersEndLapPct ?? (() => {
    if (ersValue == null) return null;
    return Math.max(0, ersValue - 1.5);
  })();

  const classified = (() => {
    const items = timeline.slice(-24).reverse();
    const radio: { time: string; text: string }[] = [];
    const raceControl: { time: string; text: string }[] = [];
    const strategyLogs: { time: string; text: string }[] = [];
    items.forEach((item: TimelineEvent) => {
      const time = new Date(item.timestamp || Date.now()).toLocaleTimeString();
      const data = item.data ?? {};
      const itemType = typeof item.type === 'string' && item.type ? item.type : 'unknown';
      if (itemType === 'note' && data['text']) {
        const cat = String(data['category'] || '').toLowerCase();
        if (cat === 'strategy') strategyLogs.push({ time, text: String(data['text']) });
        else radio.push({ time, text: String(data['text']) });
      } else {
        const t = itemType.toLowerCase();
        if (t.includes('flag') || t.includes('incident') || t.includes('vsc') || t.includes('sc')) {
          raceControl.push({ time, text: itemType });
        } else {
          strategyLogs.push({ time, text: itemType });
        }
      }
    });
    return {
      radio: radio.slice(0, 6),
      raceControl: raceControl.slice(0, 6),
      strategy: strategyLogs.slice(0, 6),
    };
  })();

  const pitWindowDisplay = sig?.pitWindowHint === 'open_now' ? 'OPEN NOW' :
    sig?.pitWindowHint === 'open_soon' ? 'SOON' : 'LAP --';

  const rejoin = sig?.expectedRejoinBand ?? '-';
  const undercutScore = sig?.undercutScore ?? m?.undercutScore;
  const cleanAirProb = sig?.cleanAirProbability ?? m?.cleanAirProbability;
  const trafficExp = sig?.trafficRiskScore ?? m?.trafficExposure;
  const confidenceScore = strategy?.confidenceScore ?? strategy?.confidence ?? null;
  const tyreChartData = useMemo(
    () => buildTyreChartSeriesData({
      tyreAge,
      urgency: m?.tyreUrgency,
      degradationTrend: sig?.degradationTrend,
    }),
    [tyreAge, m?.tyreUrgency, sig?.degradationTrend]
  );

  return (
    <div className="flex flex-col min-h-0">
      <div className="p-2 border-b border-[#243247] bg-[#0a1118] flex items-center gap-3 flex-wrap">
        <span className="text-[9px] font-mono text-[#4a6478] uppercase">Health</span>
        {health && <HealthBadge level={health.healthLevel} size="sm" />}
        {primaryCall && (
          <>
            <div className="w-px h-4 bg-[#243247]" />
            <span className={`text-sm font-bold font-mono tracking-widest ${callCls}`}>{primaryCall}</span>
            {confidenceScore != null && (
              <span className="text-[9px] font-mono text-[#4a6478]">conf. {fmtPct(confidenceScore)}</span>
            )}
          </>
        )}
        {simMeta && (
          <span className="ml-auto text-[9px] font-mono text-[#4a6478]">
            MC {simMeta.iterations} iters{simMeta.converged ? ' ✓' : ' …'}
          </span>
        )}
      </div>

      <div className="flex flex-1 min-h-0 flex-col xl:flex-row overflow-hidden xl:min-h-[640px]">
        <aside className="w-full xl:w-64 2xl:w-72 xl:flex-shrink-0 border-b xl:border-b-0 xl:border-r border-[#243247] overflow-y-visible xl:overflow-y-auto bg-[#080d15]">
          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-1">Driver Focus</div>
            <select
              value={activeCarIndex ?? ''}
              onChange={e => {
                const v = e.target.value;
                setSelectedCarIndex(v === '' ? null : parseInt(v, 10));
              }}
              className="w-full bg-[#070e18] border border-[#1a2e42] rounded px-2 py-1.5 text-xs text-[#61d6df] font-mono font-bold focus:outline-none focus:border-cyan-700 cursor-pointer"
            >
              {playerIdx != null && (
                <option value={playerIdx}>
                  P{playerCar?.position ?? '-'} · {allDrivers[playerIdx]?.driverName ?? `CAR ${playerIdx}`} (MY CAR)
                </option>
              )}
              {rows
                .filter(row => row.carIndex !== playerIdx)
                .map(row => (
                  <option key={row.carIndex} value={row.carIndex}>
                    P{row.position ?? '-'} · {allDrivers[row.carIndex]?.driverName ?? `CAR ${row.carIndex}`}
                  </option>
                ))}
            </select>
          </div>

          <div className="p-2 space-y-0 border-b border-[#243247]">
            <VitalRow label="FUEL MARGIN" value={fuelText} tone={fuelMargin != null && fuelMargin < 0 ? 'neg' : fuelMargin != null && fuelMargin < 2 ? 'warn' : 'pos'} />
            <VitalRow label="STINT PHASE" value={stintPhaseParts} />
            <VitalRow label="WING AERO LOSS" value={wingLossText} tone="warn" />
            <VitalRow label="ENGINE WEAR TREND" value={engineWear} tone={engineWear === 'CRITICAL' ? 'neg' : engineWear === 'ELEVATED' ? 'warn' : undefined} />
          </div>

          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2">TYRE TEMPS · CARC</div>
            <div className="grid grid-cols-2 gap-1">
              {tyreLabels.map((lbl, i) => (
                <TyreGauge
                  key={lbl}
                  label={lbl}
                  temp={Array.isArray(temps) ? temps[i] : null}
                  wear={Array.isArray(wears) ? wears[i] : null}
                />
              ))}
            </div>
          </div>

          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-1">EST. TYRE WEAR (WORST WHEEL)</div>
            <div className="flex items-end gap-2">
              <span className="text-xl font-mono font-bold text-[#f3bf52]">
                {worstWearPct != null ? `${Math.round(worstWearPct)}%` : '--'}
              </span>
              <span className="text-[9px] font-mono text-[#4a6478] mb-1">remaining</span>
            </div>
            {worstWearPct != null && (
              <div className="mt-1 h-1.5 bg-[#1a2e42] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${worstWearPct}%` }} />
              </div>
            )}
          </div>

          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-1">EST. BATTERY (ERS) END-LAP</div>
            <div className="flex items-end gap-2">
              <span className="text-xl font-mono font-bold text-[#62a9ff]">
                {ersEndLap != null ? `${Math.round(ersEndLap)}%` : ersValue != null ? fmtPct(ersValue) : '--'}
              </span>
              <span className="text-[9px] font-mono text-[#4a6478] mb-1">predicted</span>
            </div>
            {(ersEndLap ?? ersValue) != null && (
              <div className="mt-1 h-1.5 bg-[#1a2e42] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${ersEndLap ?? ersValue}%` }} />
              </div>
            )}
          </div>

          <div className="p-2">
            <div className="grid grid-cols-2 gap-1.5">
              <SmallMetric label="SPEED" value={s.speed != null ? `${Math.round(s.speed)}` : '--'} unit="km/h" />
              <SmallMetric label="GEAR" value={s.gear != null ? String(s.gear) : '--'} />
              <SmallMetric label="THROTTLE" value={s.throttle != null ? `${Math.round(s.throttle)}%` : '--'} />
              <SmallMetric label="BRAKE" value={s.brake != null ? `${Math.round(s.brake)}%` : '--'} accent={s.brake != null && s.brake > 50 ? 'red' : undefined} />
            </div>
          </div>
        </aside>

        <main className="order-1 xl:order-none min-w-0 flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-2 overflow-auto">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2 flex items-center justify-between">
              <span>LIVE TRACK SIMULATION</span>
              <span className="flex gap-3">
                <span>SECTOR 1-3</span>
                {s.lap != null && <span>LAP {s.lap}/{s.totalLaps ?? '--'}</span>}
                <span className="text-emerald-400">VSC READY</span>
              </span>
            </div>

            <div className="border border-[#243247] bg-[#060b12] relative overflow-hidden" style={{ minHeight: 280 }}>
              <TrackMapSvg rows={rows} playerPos={playerPos} trackPath={trackPathData.points} />
              <div className="absolute left-2 top-2 border border-[#314760] bg-[rgba(7,12,18,0.88)] px-2 py-1 text-[9px] font-mono text-[#61d6df] tracking-widest uppercase">
                {trackPathData.label}
              </div>
              <div className="absolute right-2 bottom-2 flex flex-col gap-1.5 w-40 sm:w-44">
                <div className="border border-[#314760] bg-[rgba(7,12,18,0.9)] p-2">
                  <div className="text-[9px] font-mono text-[#61d6df] tracking-widest uppercase mb-1">CLEAN AIR WINDOW</div>
                  <div className="flex justify-between text-[10px] font-mono text-[#8d9db2]">
                    <span>Prob</span>
                    <span>{cleanAirProb != null ? fmtPct(cleanAirProb) : '-'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-[#8d9db2]">
                    <span>Band</span>
                    <span>{rejoin !== '-' ? String(rejoin).toUpperCase() : '-'}</span>
                  </div>
                </div>
                <div className="border border-[#314760] bg-[rgba(7,12,18,0.9)] p-2">
                  <div className="text-[9px] font-mono text-[#61d6df] tracking-widest uppercase mb-1">UNDERCUT RISK</div>
                  <div className="flex justify-between text-[10px] font-mono text-[#8d9db2]">
                    <span>Score</span>
                    <span>{undercutScore != null ? `${Math.round(undercutScore)}/100` : '-'}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-[#8d9db2]">
                    <span>Traffic</span>
                    <span>{trafficExp != null ? `${Math.round(trafficExp)}/100` : '-'}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[860px]" style={{ fontFamily: 'monospace', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="border-b border-[#243247]">
                    {['POS', 'DRIVER', 'GAP', 'INTERVAL', 'REJOIN RISK', 'THREAT', 'STINT', 'TYRE', 'ERS', 'TARGET LAP', 'PIT'].map(h => (
                      <th key={h} className="px-2 py-1.5 text-left text-[9px] font-mono text-[#4a6478] uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={11} className="px-2 py-3 text-[#4a6478] text-xs font-mono">classification unavailable</td></tr>
                  ) : rows.slice(0, 20).map((row) => {
                    const isPlayer = row.position === playerPos;
                    const driverInfo = allDrivers[row.carIndex];
                    const driverName = driverInfo?.driverName ?? `CAR ${row.carIndex}`;
                    const undProb = undercutScore ?? 0;
                    const overcutProb = m?.overcutScore ?? 0;
                    const relPos = Math.abs((row.position ?? 99) - (playerPos ?? 99));
                    const threatLabel = relPos <= 1 && undProb >= 55 ? 'ATTACK' :
                      relPos <= 2 && overcutProb >= 55 ? 'DEFEND' :
                      relPos <= 4 ? 'BOUND' : 'IGNORE';
                    const threatColor = threatLabel === 'ATTACK' ? '#f3bf52' :
                      threatLabel === 'DEFEND' ? '#62a9ff' :
                      threatLabel === 'BOUND' ? '#7fd7a2' : '#8d9db2';

                    const gap = typeof row.gapToLeader === 'number'
                      ? row.gapToLeader.toFixed(3)
                      : String(row.gapToLeader ?? '-');
                    const interval = typeof row.gapToFront === 'number'
                      ? row.gapToFront.toFixed(3)
                      : String(row.gapToFront ?? '-');

                    return (
                      <tr key={row.carIndex}
                        className={`border-b border-[#1a2535]/50 ${isPlayer ? 'bg-[rgba(97,214,223,0.07)]' : 'hover:bg-[#0a1118]'}`}
                        style={isPlayer ? { boxShadow: 'inset 2px 0 0 #61d6df' } : undefined}
                      >
                        <td className="px-2 py-1.5 text-[#61d6df] font-bold">{row.position ?? '-'}</td>
                        <td className="px-2 py-1.5 font-bold">{driverName}</td>
                        <td className="px-2 py-1.5 text-[#8d9db2]">{gap}</td>
                        <td className="px-2 py-1.5 text-[#8d9db2]">{interval}</td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[9px] px-1.5 py-0.5 border border-[#243247] ${
                            relPos <= 2 ? 'text-[#f3bf52]' : relPos <= 4 ? 'text-[#7fd7a2]' : 'text-[#8d9db2]'
                          }`}>{relPos <= 2 ? 'HIGH' : relPos <= 4 ? 'MED' : 'LOW'}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="text-[9px] px-1.5 py-0.5 border border-[#243247]" style={{ color: threatColor }}>{threatLabel}</span>
                        </td>
                        <td className="px-2 py-1.5 text-[#8d9db2]">L{row.tyreAgeLaps ?? '-'}</td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[9px] px-1 ${
                            String(row.tyreCompound ?? '').toUpperCase().startsWith('S') ? 'text-red-400' :
                            String(row.tyreCompound ?? '').toUpperCase().startsWith('M') ? 'text-amber-400' :
                            'text-[#e6edf6]'
                          }`}>{row.tyreCompound ?? '-'}</span>
                        </td>
                        <td className="px-2 py-1.5 text-[#62a9ff]">
                          {row.ersLevel != null ? `${Math.round(row.ersLevel)}%` : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-[#f3bf52]">
                          {row.tyreAgeLaps != null
                            ? `L${Math.round(row.tyreAgeLaps) + Math.max(1, Math.round((100 - (m?.tyreUrgency ?? 70)) / 10))}`
                            : '-'}
                        </td>
                        <td className="px-2 py-1.5 text-[#8d9db2]">{row.pitStatus ?? '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-[#243247] grid grid-cols-1 md:grid-cols-3 md:divide-x divide-[#243247]" style={{ maxHeight: 220 }}>
            {(['TEAM RADIO', 'RACE CONTROL', 'STRATEGY ENGINE'] as const).map((head, ci) => {
              const items = ci === 0 ? classified.radio : ci === 1 ? classified.raceControl : classified.strategy;
              return (
                <div key={head}>
                  <div className="px-2 py-1 border-b border-[#243247] text-[9px] font-mono text-[#4a6478] uppercase tracking-widest bg-[#0a1118]">{head}</div>
                  <div className="overflow-y-auto" style={{ maxHeight: 110 }}>
                    {items.length === 0 ? (
                      <div className="px-2 py-2 text-[#3a5570] text-[10px] font-mono">empty</div>
                    ) : items.map((item, i) => (
                      <div key={i} className="grid px-2 py-1 border-b border-[#1a2535]/30 text-[10px] font-mono" style={{ gridTemplateColumns: '68px 1fr', gap: 6 }}>
                        <span className="text-[#4a6478]">{item.time}</span>
                        <span className="text-[#8d9db2] truncate">{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        <aside className="w-full xl:w-64 2xl:w-72 xl:flex-shrink-0 border-t xl:border-t-0 xl:border-l border-[#243247] flex flex-col overflow-y-visible xl:overflow-y-auto bg-[#080d15]">
          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2">TYRE TREND MODEL</div>
            <TyreDegradationChart {...tyreChartData} />
            <div className="flex gap-3 mt-2 text-[9px] font-mono">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#61d6df] inline-block" />MODEL</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#8d9db2] inline-block" />BASELINE</span>
            </div>
          </div>

          <div className="p-2 border-b border-[#243247] space-y-2">
            <div>
              <div className="text-[9px] font-mono text-[#4a6478] uppercase">PIT WINDOW OPEN</div>
              <div className="text-[#f3bf52] font-mono font-bold text-lg">{pitWindowDisplay}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-[#4a6478] uppercase">REJOIN POS (EST)</div>
              <div className="text-[#61d6df] font-mono font-bold text-lg">{rejoin !== '-' ? String(rejoin).toUpperCase() : '--'}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono text-[#4a6478] uppercase">MODEL CONFIDENCE</div>
              <div className="flex items-center gap-2">
                <span className="text-[#61d6df] font-mono font-bold text-xl">
                  {(strategy?.confidenceScore ?? strategy?.confidence) != null ? fmtPct((strategy?.confidenceScore ?? strategy?.confidence) as number) : '--'}
                </span>
                <span className={`text-[9px] border px-1.5 py-0.5 ${
                  (strategy?.stabilityScore ?? 0) >= 70
                    ? 'text-[#7fd7a2] border-[#2d6c45]'
                    : 'text-[#f3bf52] border-[#7d6227]'
                }`}>
                  {(strategy?.stabilityScore ?? 0) >= 70 ? 'STABLE' : 'WATCH'}
                </span>
              </div>
            </div>
          </div>

          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2">STRATEGY METRICS</div>
            {[
              { label: 'Undercut Score', value: sig?.undercutScore ?? m?.undercutScore },
              { label: 'Overcut Score', value: sig?.overcutScore ?? m?.overcutScore },
              { label: 'Traffic Exposure', value: sig?.trafficRiskScore ?? m?.trafficExposure },
              { label: 'Clean Air Prob.', value: sig?.cleanAirProbability ?? m?.cleanAirProbability },
              { label: 'Tyre Urgency', value: m?.tyreUrgency },
            ].map(({ label, value }) => (
              <div key={label} className="mb-1.5">
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="font-mono text-[#4a6478]">{label}</span>
                  <span className="font-mono font-bold text-[#e6edf6]">{value != null ? fmtPct(value) : '-'}</span>
                </div>
                <ScoreBar value={value} />
              </div>
            ))}
          </div>

          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2">ACTIONS</div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { action: 'BOX_THIS_LAP' as const, label: 'BOX THIS LAP', tone: 'danger' },
                { action: 'PUSH_NOW' as const, label: 'PUSH NOW', tone: 'primary' },
                { action: 'HARVEST_MODE' as const, label: 'HARVEST MODE', tone: 'warn' },
                { action: 'HOLD_POS' as const, label: 'HOLD POS', tone: 'secondary' },
              ].map(({ action, label, tone }) => (
                <button
                  key={action}
                  onClick={() => onExecuteAction(action)}
                  disabled={pendingAction === action}
                  className={`min-h-10 text-[10px] font-mono tracking-widest uppercase border transition-colors ${
                    tone === 'danger' ? 'border-[#9a4f46] bg-[rgba(118,51,43,0.5)] text-[#ffd1ca] hover:bg-[rgba(118,51,43,0.7)]' :
                    tone === 'primary' ? 'border-[#2f9ea7] bg-[rgba(28,95,102,0.5)] text-[#bffeff] hover:bg-[rgba(28,95,102,0.7)]' :
                    tone === 'warn' ? 'border-[#917130] bg-[rgba(98,76,26,0.5)] text-[#ffe5a4] hover:bg-[rgba(98,76,26,0.7)]' :
                    'border-[#314760] bg-[rgba(16,26,39,0.82)] text-[#e6edf6] hover:border-[#61d6df]'
                  } ${pendingAction === action ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}
                >
                  {pendingAction === action ? 'SENDING…' : label}
                </button>
              ))}
              <button
                onClick={() => onExecuteAction('EXECUTE_SCENARIO_B')}
                disabled={pendingAction === 'EXECUTE_SCENARIO_B'}
                className={`col-span-2 min-h-9 text-[10px] font-mono tracking-widest uppercase border border-[#314760] bg-[rgba(16,26,39,0.82)] text-[#e6edf6] hover:border-[#61d6df] transition-colors ${pendingAction === 'EXECUTE_SCENARIO_B' ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}
              >
                {pendingAction === 'EXECUTE_SCENARIO_B' ? 'SENDING…' : 'EXECUTE SCENARIO B'}
              </button>
            </div>
            {actionMsg && (
              <div className={`mt-2 text-[10px] font-mono ${actionMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{actionMsg}</div>
            )}
            {!hasPermission && access?.visibility === 'code' && (
              <div className="mt-1 text-[10px] font-mono text-[#4a6478]">Protected rooms may require a Permission Code to send actions.</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function VitalRow({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' | 'warn' }) {
  const toneColor = tone === 'pos' ? '#7fd7a2' : tone === 'neg' ? '#f27979' : tone === 'warn' ? '#f3bf52' : '#e6edf6';
  return (
    <div className="flex justify-between items-center py-1 border-b border-dotted border-[rgba(141,157,178,0.2)]">
      <span className="text-[9px] font-mono text-[#8d9db2] uppercase">{label}</span>
      <span className="text-xs font-mono font-bold" style={{ color: toneColor }}>{value}</span>
    </div>
  );
}

function SmallMetric({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: 'red' }) {
  return (
    <div className="border border-[#1a2e42] bg-[#070e18] p-1.5">
      <div className="text-[8px] font-mono text-[#4a6478] uppercase">{label}</div>
      <div className={`text-sm font-mono font-bold ${accent === 'red' ? 'text-red-400' : 'text-[#e6edf6]'}`}>
        {value}{unit && <span className="text-[8px] ml-0.5 text-[#4a6478]">{unit}</span>}
      </div>
    </div>
  );
}

function StrategyTab({ strategy }: { strategy: StrategyData | null }) {
  const m = strategy?.metrics;
  const sig = strategy?.signals;
  const simMeta: StrategySimulationMeta | undefined = strategy?.simulationMeta;
  const primaryCall = strategy?.primaryRecommendation ?? strategy?.recommendation ?? strategy?.primaryCall;
  const callCls = callColor(primaryCall);

  if (!strategy || strategy.strategyUnavailable) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-[#4a6478] text-sm font-mono gap-2 p-3">
        <div className="text-3xl">📡</div>
        <div>{strategy?.reason || 'Awaiting telemetry data...'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="border border-[#243247] bg-gradient-to-r from-[#0c1a28] to-[#0a1520] p-5">
        <div className="text-[9px] font-mono tracking-[0.16em] text-[#4a6478] uppercase mb-2">Primary Call</div>
        <div className={`text-4xl font-bold tracking-wide ${callCls}`} style={{ fontFamily: 'Rajdhani,sans-serif' }}>{primaryCall || '-'}</div>
        {(strategy.secondaryRecommendation ?? strategy.secondaryCall) && (
          <div className="text-base text-[#5e7a94] mt-1.5">{strategy.secondaryRecommendation ?? strategy.secondaryCall}</div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs font-mono text-[#4a6478]">
          {(strategy.confidenceScore ?? strategy.confidence) != null && <span>Confidence <span className="text-[#9bb8cc]">{fmtPct((strategy.confidenceScore ?? strategy.confidence) as number)}</span></span>}
          {(strategy.stabilityScore != null || strategy.stability) && <span>Stability <span className="text-[#9bb8cc]">{strategy.stability ?? String(strategy.stabilityScore)}</span></span>}
          {strategy.pitWindowEta != null && <span>Pit Window ETA <span className="text-amber-400">{strategy.pitWindowEta} laps</span></span>}
        </div>
        {simMeta && (
          <div className="mt-2 pt-2 border-t border-[#1a2e42] text-[9px] font-mono text-[#4a6478] flex gap-4 flex-wrap">
            <span>Monte Carlo: <span className="text-[#61d6df]">{simMeta.iterations} iterations</span></span>
            <span>Converged: <span className={simMeta.converged ? 'text-emerald-400' : 'text-amber-400'}>{simMeta.converged ? 'YES' : 'NO'}</span></span>
            {simMeta.optimalPitLap != null && <span>Optimal Pit Lap: <span className="text-amber-400">{Math.round(simMeta.optimalPitLap)}</span></span>}
            {simMeta.confidenceInterval && <span>CI: <span className="text-[#9bb8cc]">[{Math.round(simMeta.confidenceInterval[0])}, {Math.round(simMeta.confidenceInterval[1])}]</span></span>}
          </div>
        )}
        {sig && (
          <div className="mt-2 pt-2 border-t border-[#1a2e42] text-[9px] font-mono text-[#4a6478] flex gap-4 flex-wrap">
            {sig.undercutProbability != null && <span>Undercut prob: <span className="text-[#61d6df]">{fmtPct(sig.undercutProbability * 100)}</span></span>}
            {sig.overcutProbability != null && <span>Overcut prob: <span className="text-[#61d6df]">{fmtPct(sig.overcutProbability * 100)}</span></span>}
            {sig.ersEndLapPct != null && <span>ERS end-lap: <span className="text-[#62a9ff]">{Math.round(sig.ersEndLapPct)}%</span></span>}
          </div>
        )}
      </div>

      {m && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="border border-[#1a2e42] bg-[#0c1520] p-4 space-y-3">
            <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase">Race Position Metrics</div>
            {[
              { label: 'Undercut Score', value: sig?.undercutScore ?? m.undercutScore },
              { label: 'Overcut Score', value: sig?.overcutScore ?? m.overcutScore },
              { label: 'Traffic Exposure', value: sig?.trafficRiskScore ?? m.trafficExposure },
              { label: 'Clean Air Probability', value: sig?.cleanAirProbability ?? m.cleanAirProbability },
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
          <div className="border border-[#1a2e42] bg-[#0c1520] p-4 space-y-3">
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
  onAdd: (e: FormEvent<HTMLFormElement>) => void;
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
          {notes.slice().reverse().map((note, index) => {
            const noteKey = note.id ?? note.noteId ?? `${note.createdAt}-${index}`;
            const noteId = note.id ?? note.noteId ?? '';
            return (
              <div key={noteKey} className={`rounded-lg border p-3 ${categoryColors[note.category || 'general'] || categoryColors.general}`}>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex gap-1.5 flex-wrap">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase tracking-wider ${categoryColors[note.category || 'general']}`}>
                      {note.category || 'general'}
                    </span>
                    {note.authorLabel && <span className="text-[9px] font-mono text-[#4a6478]">{note.authorLabel}</span>}
                    {note.lap != null && <span className="text-[9px] font-mono text-[#4a6478]">L{note.lap}</span>}
                  </div>
                  {hasPermission && (
                    <button onClick={() => noteId && onDelete(noteId)} className="text-[9px] text-[#3a5570] hover:text-red-400 transition-colors flex-shrink-0">✕</button>
                  )}
                </div>
                <div className="text-sm text-[#dce8f5] leading-relaxed">{note.text}</div>
                <div className="text-[9px] font-mono text-[#3a5570] mt-1.5">{fmtRelTime(note.createdAt)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
        {hasPermission ? (
          <form onSubmit={onAdd} className="space-y-3">
            <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-2">Add Note</div>
            <textarea
              value={noteText} onChange={e => setNoteText(e.target.value)}
              placeholder="e.g. undercut ready, outlap traffic re-eval needed"
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
                    noteCategory === cat ? categoryColors[cat] : 'border-[#1a2e42] text-[#4a6478] hover:border-[#2a3e50]'
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
            <div className="text-sm text-[#3a5570] font-mono">Permission Code required</div>
            <div className="text-xs text-[#2a3e50]">Enter your Permission Code at the lobby to access notes.</div>
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
          {events.slice().reverse().map((ev, i) => {
            const eventType = typeof ev.type === 'string' && ev.type ? ev.type : 'unknown';
            return (
            <div key={ev.eventId || i} className="rounded border border-[#1a2e42] bg-[#0a1520] px-3 py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-mono font-bold ${typeColor[eventType] || 'text-sky-400'}`}>{eventType}</span>
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
          )})}
        </div>
      )}
    </div>
  );
}

interface SettingsTabProps {
  hasPermission: boolean;
  access: SessionAccessRecord | null;
  relayInfo: { viewerBaseUrl?: string; relayLabel?: string } | null;
  joinUrl: string;
  copyMsg: string; onCopy: (text: string, label: string) => void;
  roomTitle: string; setRoomTitle: (v: string) => void;
  roomPassword: string; setRoomPassword: (v: string) => void;
  newPermCode: string; setNewPermCode: (v: string) => void;
  shareEnabled: string; setShareEnabled: (v: string) => void;
  visibility: string; setVisibility: (v: string) => void;
  saveMsg: string; onSave: () => void;
  onReload: () => void;
}

function SettingsTab({ hasPermission, access, relayInfo, joinUrl, copyMsg, onCopy, roomTitle, setRoomTitle, roomPassword, setRoomPassword, newPermCode, setNewPermCode, shareEnabled, setShareEnabled, visibility, setVisibility, saveMsg, onSave, onReload }: SettingsTabProps) {
  const inp = "w-full bg-[#070e18] border border-[#1a2e42] rounded px-3 py-2 text-sm text-[#dce8f5] placeholder:text-[#2a4560] focus:outline-none focus:border-cyan-700 transition-colors";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="space-y-3">
        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-3">Room Info</div>
          <div className="space-y-2 text-xs font-mono">
            {[
              { label: 'Session ID', value: access?.sessionId || '-' },
              { label: 'Join Code', value: access?.joinCode || '-', bold: true },
              { label: 'Relay', value: relayInfo?.relayLabel || '-' },
              { label: 'Driver', value: access?.driverLabel || '-' },
              { label: 'Car', value: access?.carLabel || '-' },
            ].map(({ label, value, bold }) => (
              <div key={label} className="flex justify-between py-1.5 border-b border-[#1a2e42]">
                <span className="text-[#4a6478]">{label}</span>
                <span className={bold ? 'text-cyan-400 font-bold' : 'text-[#9bb8cc] truncate max-w-[200px]'}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-4">
          <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase mb-3">Share Links</div>
          <div className="space-y-2">
            <div>
              <div className="text-[10px] font-mono text-[#4a6478] mb-1">Viewer Join URL</div>
              <div className="flex gap-2">
                <input readOnly value={joinUrl} className={`${inp} text-[11px] text-cyan-400/80 cursor-text`} />
                <button onClick={() => onCopy(joinUrl, 'Viewer Join URL')} className="px-3 rounded border border-[#1a2e42] text-xs text-[#5e7a94] hover:bg-white/5 whitespace-nowrap transition-colors">Copy</button>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onCopy(access?.joinCode || '', 'Join Code')} className="px-3 py-1.5 rounded border border-[#1a2e42] text-xs text-[#5e7a94] hover:bg-white/5 transition-colors">Copy Code</button>
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
              <input value={roomPassword} onChange={e => setRoomPassword(e.target.value)} placeholder="Leave empty to keep current" type="text" className={inp} />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-[#4a6478] mb-1">New Permission Code</label>
              <input value={newPermCode} onChange={e => setNewPermCode(e.target.value)} placeholder="Leave empty to keep current" className={inp} />
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
                className="flex-1 py-2.5 rounded bg-gradient-to-r from-cyan-800 to-cyan-700 border border-cyan-600 text-sm text-white font-bold tracking-widest uppercase hover:brightness-110 transition-all" style={{ fontFamily: 'Rajdhani,sans-serif' }}>
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
            <div className="text-sm text-[#3a5570] font-mono">Permission Code required</div>
            <div className="text-xs text-[#2a3e50]">Enter your Permission Code at the lobby to manage room settings.</div>
          </div>
        )}
      </div>
    </div>
  );
}
