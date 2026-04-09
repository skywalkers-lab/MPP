export function safe(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  return String(v);
}

export function fmtMs(ms: number | null | undefined): string {
  if (!Number.isFinite(ms) || ms == null || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export function fmtLapTime(ms: number | null | undefined): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '-';
  const totalSec = n / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  return `${min}:${sec.toFixed(3).padStart(6, '0')}`;
}

export function fmtPct(v: number | null | undefined): string {
  if (!Number.isFinite(v) || v == null) return '-';
  return `${Math.round(Math.max(0, Math.min(100, v)))}%`;
}

export function fmtRelTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  if (diff < 1000) return 'now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString();
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '-';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export function healthLabel(level: string | null | undefined): string {
  switch (level) {
    case 'healthy': return 'HEALTHY';
    case 'delayed': return 'DELAYED';
    case 'stale_risk': return 'STALE RISK';
    case 'stale': return 'STALE';
    case 'connecting': return 'CONNECTING';
    default: return 'UNKNOWN';
  }
}

export function compoundColor(compound: string | null | undefined): string {
  const c = (compound || '').toUpperCase();
  if (c.includes('SOFT')) return '#ff4444';
  if (c.includes('MEDIUM')) return '#ffcc00';
  if (c.includes('HARD')) return '#e0e0e0';
  if (c.includes('INTER')) return '#66cc33';
  if (c.includes('WET')) return '#3399ff';
  return '#8899aa';
}

export function compoundShort(compound: string | null | undefined): string {
  const c = (compound || '').toUpperCase();
  if (c.includes('SOFT')) return 'S';
  if (c.includes('MEDIUM')) return 'M';
  if (c.includes('HARD')) return 'H';
  if (c.includes('INTER')) return 'I';
  if (c.includes('WET')) return 'W';
  return compound?.charAt(0) || '-';
}
