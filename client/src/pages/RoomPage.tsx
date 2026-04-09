import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import HealthBadge from '../components/HealthBadge';
import type {
  CarSnapshot,
  DriverSnapshot,
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
  fetchSessionSnapshot, patchSessionAccess,
} from '../lib/api';
import { fmtPct, fmtRelTime } from '../lib/formatters';

type ConsoleTab = 'live' | 'strategy' | 'notes' | 'timeline' | 'settings';

const CONSOLE_TABS: { id: ConsoleTab; label: string }[] = [
  { id: 'live', label: 'LIVE TELEMETRY' },
  { id: 'strategy', label: 'STRATEGY' },
  { id: 'notes', label: 'NOTES' },
  { id: 'timeline', label: 'TIMELINE' },
  { id: 'settings', label: 'SETTINGS' },
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

function TyreDegradationChart({ tyreAge, urgency }: {
  tyreAge?: number | null;
  urgency?: number | null;
}) {
  const age = tyreAge ?? 0;
  const urg = urgency ?? 35;
  const pitOffset = Math.max(2, Math.round((100 - urg) / 10));

  const pointsA: string[] = [];
  const pointsB: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const x = 20 + i * 32;
    const ya = 32 + i * (5 + urg / 90) + age * 0.35;
    const yb = 48 + i * 3.4;
    pointsA.push(`${x},${Math.min(130, ya).toFixed(1)}`);
    pointsB.push(`${x},${Math.min(130, yb).toFixed(1)}`);
  }
  const pitX = 20 + Math.max(0, Math.min(8, pitOffset)) * 32;

  return (
    <svg viewBox="0 0 300 140" className="w-full" style={{ height: 110 }} role="img" aria-label="degradation chart">
      <rect x="0" y="0" width="300" height="140" fill="rgba(6,11,18,0.92)" />
      <polyline points={pointsB.join(' ')} fill="none" stroke="#b8bec8" strokeWidth="2" strokeDasharray="5 3" opacity="0.85" />
      <polyline points={pointsA.join(' ')} fill="none" stroke="#61d6df" strokeWidth="2" />
      <line x1={pitX.toFixed(1)} y1="8" x2={pitX.toFixed(1)} y2="132" stroke="#f3bf52" strokeWidth="1" strokeDasharray="4 4" />
      <text x="8" y="18" fill="#8d9db2" fontSize="8" fontFamily="monospace">SOFT</text>
      <text x="8" y="138" fill="#8d9db2" fontSize="8" fontFamily="monospace">0%</text>
      <text x={pitX - 4} y="6" fill="#f3bf52" fontSize="7" fontFamily="monospace">PIT</text>
    </svg>
  );
}

function TrackMapSvg({ rows, playerPos }: { rows: CarSnapshot[]; playerPos?: number | null }) {
  const maxPos = Math.max(1, rows.length || 20);
  const markers = rows.slice(0, 15).map((row) => {
    const pos = Number.isFinite(row.position) && row.position != null ? row.position : 20;
    const angle = ((pos - 1) / maxPos) * Math.PI * 2 - Math.PI / 2;
    const x = 150 + Math.cos(angle) * 96;
    const y = 150 + Math.sin(angle) * 74;
    const isPlayer = pos === playerPos;
    if (isPlayer) {
      return (
        <polygon
          key={row.carIndex}
          points={`${x},${y - 6} ${x + 5},${y + 4} ${x - 5},${y + 4}`}
          fill="#61d6df"
        />
      );
    }
    return (
      <polygon
        key={row.carIndex}
        points={`${x},${y - 4} ${x + 3.5},${y + 3} ${x - 3.5},${y + 3}`}
        fill="#8d9db2"
        opacity="0.7"
      />
    );
  });

  return (
    <svg viewBox="0 0 300 300" className="w-full" style={{ maxHeight: 260 }} role="img" aria-label="circuit map">
      <ellipse cx="150" cy="150" rx="110" ry="84" fill="rgba(14,22,33,0.55)" stroke="rgba(97,214,223,0.25)" strokeWidth="2" />
      <ellipse cx="150" cy="150" rx="96" ry="72" fill="rgba(6,11,18,0.95)" stroke="rgba(49,71,96,0.52)" strokeWidth="1" />
      <line x1="150" y1="30" x2="150" y2="270" stroke="rgba(243,191,82,0.28)" strokeWidth="1" strokeDasharray="4 4" />
      <line x1="40" y1="150" x2="260" y2="150" stroke="rgba(243,191,82,0.28)" strokeWidth="1" strokeDasharray="4 4" />
      <circle cx="150" cy="150" r="3" fill="rgba(97,214,223,0.7)" />
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
  const base = relayInfo?.viewerBaseUrl || '';
  const joinUrl = access?.joinCode ? `${base}/join/${access.joinCode}` : '';
  const overlayUrl = access?.joinCode ? `${base}/overlay/join/${access.joinCode}` : '';
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

        {tab === 'live' && <StrategicConsoleTab s={s} strategy={strategy} health={health} timeline={timeline} access={access} sessionId={id} password={password} permissionCode={permissionCode} />}
        {tab === 'strategy' && <StrategyTab strategy={strategy} />}
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
          </div>
        )}
      </main>
    </div>
  );
}

function StrategicConsoleTab({ s, strategy, health, timeline, access, sessionId, password, permissionCode }: {
  s: SessionSnapshot;
  strategy: StrategyData | null;
  health: SessionHealthData | null;
  timeline: TimelineEvent[];
  access: SessionAccessRecord | null;
  sessionId: string;
  password: string;
  permissionCode: string;
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
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  async function dispatchAction(label: string, category: string) {
    const lap = s.lap ?? undefined;
    try {
      await addNote(sessionId, { text: `[ACTION] ${label}`, authorLabel: 'Engineer', category, lap }, password, permissionCode);
      setActionMsg(`✓ ${label}`);
    } catch {
      setActionMsg(`✗ ${label} failed`);
    } finally {
      setTimeout(() => setActionMsg(null), 3000);
    }
  }

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
      if (item.type === 'note' && data['text']) {
        const cat = String(data['category'] || '').toLowerCase();
        if (cat === 'strategy') strategyLogs.push({ time, text: String(data['text']) });
        else radio.push({ time, text: String(data['text']) });
      } else {
        const t = (item.type ?? '').toLowerCase();
        if (t.includes('flag') || t.includes('incident') || t.includes('vsc') || t.includes('sc')) {
          raceControl.push({ time, text: item.type ?? t });
        } else {
          strategyLogs.push({ time, text: item.type ?? t });
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

  return (
    <div className="flex flex-col min-h-0">
      <div className="p-2 border-b border-[#243247] bg-[#0a1118] flex items-center gap-3 flex-wrap">
        <span className="text-[9px] font-mono text-[#4a6478] uppercase">Health</span>
        {health && <HealthBadge level={health.healthLevel} size="sm" />}
        {primaryCall && (
          <>
            <div className="w-px h-4 bg-[#243247]" />
            <span className={`text-sm font-bold font-mono tracking-widest ${callCls}`}>{primaryCall}</span>
            {(strategy?.confidenceScore ?? strategy?.confidence) != null && (
              <span className="text-[9px] font-mono text-[#4a6478]">conf. {fmtPct((strategy.confidenceScore ?? strategy.confidence) as number)}</span>
            )}
          </>
        )}
        {simMeta && (
          <span className="ml-auto text-[9px] font-mono text-[#4a6478]">
            MC {simMeta.iterations} iters{simMeta.converged ? ' ✓' : ' …'}
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 180px)', minHeight: 600 }}>
        <aside className="w-72 flex-shrink-0 border-r border-[#243247] overflow-y-auto bg-[#080d15]">
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

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-2 overflow-auto">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2 flex items-center justify-between">
              <span>LIVE TRACK SIMULATION</span>
              <span className="flex gap-3">
                <span>SECTOR 1-3</span>
                {s.lap != null && <span>LAP {s.lap}/{s.totalLaps ?? '--'}</span>}
                <span className="text-emerald-400">VSC READY</span>
              </span>
            </div>

            <div className="border border-[#243247] bg-[#060b12] relative" style={{ minHeight: 280 }}>
              <TrackMapSvg rows={rows} playerPos={playerPos} />
              <div className="absolute right-2 bottom-2 flex flex-col gap-1.5 w-44">
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
              <table className="w-full" style={{ fontFamily: 'monospace', fontSize: 11, borderCollapse: 'collapse' }}>
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

          <div className="border-t border-[#243247] grid grid-cols-3 divide-x divide-[#243247]" style={{ maxHeight: 140 }}>
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

        <aside className="w-72 flex-shrink-0 border-l border-[#243247] flex flex-col overflow-y-auto bg-[#080d15]">
          <div className="p-2 border-b border-[#243247]">
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2">TYRE DEGRADATION PROJECTION</div>
            <TyreDegradationChart
              tyreAge={tyreAge}
              urgency={m?.tyreUrgency}
            />
            <div className="flex gap-3 mt-2 text-[9px] font-mono">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#61d6df] inline-block" />SOFT</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#b8bec8] inline-block" />HARD</span>
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
              <div className="text-[9px] font-mono text-[#4a6478] uppercase">PIT LOSS HEURISTIC</div>
              <div className="flex items-center gap-2">
                <span className="text-[#61d6df] font-mono font-bold text-xl">
                  {sig?.pitLossHeuristic != null ? `${Math.round(sig.pitLossHeuristic)}/100` : '--'}
                </span>
                <span className={`text-[9px] border px-1.5 py-0.5 ${
                  sig?.pitLossHeuristic != null && sig.pitLossHeuristic >= 82
                    ? 'text-[#f27979] border-[#7a3838]'
                    : 'text-[#7fd7a2] border-[#2d6c45]'
                }`}>
                  {sig?.pitLossHeuristic != null && sig.pitLossHeuristic >= 82 ? 'HIGH' : 'NOMINAL'}
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
            <div className="text-[9px] font-mono text-[#4a6478] uppercase mb-2 flex items-center justify-between">
              <span>ACTIONS</span>
              {!permissionCode && <span className="text-[8px] text-[#3a5570]">PERMISSION REQUIRED</span>}
            </div>
            {actionMsg && (
              <div className="mb-1.5 text-[10px] font-mono text-[#61d6df] text-center">{actionMsg}</div>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: 'BOX THIS LAP', tone: 'danger', category: 'pit' },
                { label: 'PUSH NOW', tone: 'primary', category: 'strategy' },
                { label: 'HARVEST MODE', tone: 'warn', category: 'strategy' },
                { label: 'HOLD POS', tone: 'secondary', category: 'strategy' },
              ].map(({ label, tone, category }) => (
                <button key={label}
                  disabled={!permissionCode}
                  onClick={() => dispatchAction(label, category)}
                  className={`min-h-10 text-[10px] font-mono tracking-widest uppercase border transition-colors ${
                    !permissionCode
                      ? 'border-[#1a2e42] bg-transparent text-[#3a5570] cursor-not-allowed opacity-50'
                      : tone === 'danger' ? 'border-[#9a4f46] bg-[rgba(118,51,43,0.5)] text-[#ffd1ca] hover:bg-[rgba(118,51,43,0.7)] cursor-pointer' :
                      tone === 'primary' ? 'border-[#2f9ea7] bg-[rgba(28,95,102,0.5)] text-[#bffeff] hover:bg-[rgba(28,95,102,0.7)] cursor-pointer' :
                      tone === 'warn' ? 'border-[#917130] bg-[rgba(98,76,26,0.5)] text-[#ffe5a4] hover:bg-[rgba(98,76,26,0.7)] cursor-pointer' :
                      'border-[#314760] bg-[rgba(16,26,39,0.82)] text-[#e6edf6] hover:border-[#61d6df] cursor-pointer'
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                disabled={!permissionCode}
                onClick={() => dispatchAction('EXECUTE SCENARIO B', 'strategy')}
                className={`col-span-2 min-h-9 text-[10px] font-mono tracking-widest uppercase border transition-colors ${
                  !permissionCode
                    ? 'border-[#1a2e42] text-[#3a5570] cursor-not-allowed opacity-50'
                    : 'border-[#314760] bg-[rgba(16,26,39,0.82)] text-[#e6edf6] hover:border-[#61d6df] cursor-pointer'
                }`}
              >
                EXECUTE SCENARIO B
              </button>
            </div>
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
            {[
              { label: 'Viewer Join URL', value: joinUrl, accent: 'text-cyan-400/80' },
              { label: 'OBS Overlay URL', value: overlayUrl, accent: 'text-purple-400/80' },
            ].map(({ label, value, accent }) => (
              <div key={label}>
                <div className="text-[10px] font-mono text-[#4a6478] mb-1">{label}</div>
                <div className="flex gap-2">
                  <input readOnly value={value} className={`${inp} text-[11px] ${accent} cursor-text`} />
                  <button onClick={() => onCopy(value, label)} className="px-3 rounded border border-[#1a2e42] text-xs text-[#5e7a94] hover:bg-white/5 whitespace-nowrap transition-colors">Copy</button>
                </div>
              </div>
            ))}
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
