import type { TrackMapCarData } from '../types';

type TrackPoint = readonly [number, number];

const TRACK_PATH_PRESETS: Record<string, TrackPoint[]> = {
  monza: [[42, 168], [58, 84], [120, 54], [196, 70], [250, 52], [264, 102], [230, 128], [264, 182], [228, 230], [148, 246], [88, 216], [56, 182], [42, 168]],
  silverstone: [[38, 188], [54, 122], [88, 78], [138, 52], [198, 64], [248, 100], [264, 146], [232, 174], [258, 214], [214, 246], [150, 228], [110, 248], [64, 226], [38, 188]],
  spa: [[36, 220], [52, 144], [84, 88], [138, 44], [212, 58], [260, 98], [240, 144], [262, 196], [216, 244], [138, 256], [82, 222], [52, 246], [36, 220]],
  suzuka: [[54, 202], [88, 128], [64, 86], [120, 52], [182, 76], [144, 126], [198, 156], [248, 116], [262, 176], [210, 222], [148, 248], [96, 224], [54, 202]],
  monaco: [[70, 226], [56, 164], [82, 116], [74, 66], [130, 52], [178, 88], [222, 74], [248, 124], [214, 154], [238, 206], [184, 236], [130, 214], [96, 244], [70, 226]],
  generic: [[40, 184], [58, 112], [96, 64], [154, 48], [216, 70], [258, 110], [246, 154], [264, 212], [212, 248], [150, 232], [104, 248], [68, 220], [40, 184]],
};

function resolveTrackPath(trackId?: number | null, trackName?: string | null): TrackPoint[] {
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

function pointOnPolyline(points: TrackPoint[], progress: number) {
  const normalized = ((progress % 1) + 1) % 1;
  let totalLength = 0;
  const segments = [] as Array<{ start: TrackPoint; end: TrackPoint; length: number }>;

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    totalLength += length;
    segments.push({ start, end, length });
  }

  const target = normalized * totalLength;
  let cursor = 0;
  for (const segment of segments) {
    if (cursor + segment.length >= target) {
      const ratio = segment.length === 0 ? 0 : (target - cursor) / segment.length;
      return {
        x: segment.start[0] + (segment.end[0] - segment.start[0]) * ratio,
        y: segment.start[1] + (segment.end[1] - segment.start[1]) * ratio,
      };
    }
    cursor += segment.length;
  }

  const last = points[points.length - 1] ?? [150, 150];
  return { x: last[0], y: last[1] };
}

function dotColor(car: TrackMapCarData): string {
  if (car.isPlayer) return '#61d6df';
  const status = String(car.driverStatus || '').toUpperCase();
  if (status.includes('FLYING')) return '#f3bf52';
  if (status.includes('OUT')) return '#7fd7a2';
  if (status.includes('IN')) return '#f27979';
  return '#8d9db2';
}

export default function MiniTrackMap({
  cars,
  trackId,
  trackName,
  title = 'MINI TRACK MAP',
}: {
  cars: TrackMapCarData[];
  trackId?: number | null;
  trackName?: string | null;
  title?: string;
}) {
  const path = resolveTrackPath(trackId, trackName);
  const pathLine = path.map(([x, y]) => `${x},${y}`).join(' ');
  const start = path[0] ?? ([40, 184] as TrackPoint);
  const visibleCars = cars.filter((car) => car.progressPct != null).slice(0, 20);

  return (
    <div className="rounded-xl border border-[#1a2e42] bg-[#0c1520] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[9px] font-mono tracking-widest text-[#4a6478] uppercase">{title}</div>
        <div className="text-[9px] font-mono text-[#5e7a94] uppercase">{trackName || 'Track layout'}</div>
      </div>
      <svg viewBox="0 0 300 300" className="w-full" style={{ maxHeight: 250 }} role="img" aria-label="mini track map">
        <rect x="0" y="0" width="300" height="300" fill="rgba(6,11,18,0.95)" />
        <polyline points={pathLine} fill="none" stroke="rgba(97,214,223,0.14)" strokeWidth="18" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={pathLine} fill="none" stroke="rgba(49,71,96,0.95)" strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={pathLine} fill="none" stroke="#61d6df" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={String(start[0] - 8)} y1={String(start[1] - 10)} x2={String(start[0] + 8)} y2={String(start[1] + 10)} stroke="#f3bf52" strokeWidth="2" />
        <circle cx={String(start[0])} cy={String(start[1])} r="3" fill="rgba(97,214,223,0.7)" />

        {visibleCars.map((car) => {
          const progress = (car.progressPct ?? 0) / 100;
          const { x, y } = pointOnPolyline(path, progress);
          const radius = car.isPlayer ? 5.5 : 4;
          return (
            <g key={car.carIndex}>
              <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r={String(radius + 2)} fill="rgba(6,11,18,0.8)" />
              <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r={String(radius)} fill={dotColor(car)} />
              {car.isPlayer && (
                <text x={(x + 8).toFixed(1)} y={(y - 8).toFixed(1)} fill="#61d6df" fontSize="8" fontFamily="monospace">
                  YOU
                </text>
              )}
            </g>
          );
        })}

        {visibleCars.length === 0 && (
          <text x="150" y="154" fill="#5e7a94" fontSize="11" fontFamily="monospace" textAnchor="middle">
            Waiting for live lap-distance telemetry
          </text>
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[9px] font-mono text-[#5e7a94]">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#61d6df]" />PLAYER</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f3bf52]" />FLYING</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#7fd7a2]" />OUT LAP</span>
      </div>
    </div>
  );
}
