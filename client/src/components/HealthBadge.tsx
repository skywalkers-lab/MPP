import type { HealthLevel } from '../types';
import { healthLabel } from '../lib/formatters';

const styles: Record<string, string> = {
  healthy: 'text-emerald-400 border-emerald-700 bg-emerald-950/60',
  delayed: 'text-amber-400 border-amber-700 bg-amber-950/60',
  stale_risk: 'text-orange-400 border-orange-700 bg-orange-950/60',
  stale: 'text-red-400 border-red-800 bg-red-950/60',
  connecting: 'text-sky-400 border-sky-700 bg-sky-950/60',
};

interface Props {
  level: HealthLevel | string | null | undefined;
  size?: 'sm' | 'md';
}

export default function HealthBadge({ level, size = 'md' }: Props) {
  const key = level || 'connecting';
  const cls = styles[key] || styles.connecting;
  const sizeClass = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-[11px] px-2.5 py-0.5';
  return (
    <span className={`inline-flex items-center rounded-full border font-mono font-semibold tracking-widest uppercase ${sizeClass} ${cls}`}>
      {size === 'md' && (
        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${level === 'healthy' ? 'bg-emerald-400 animate-pulse' : 'bg-current'}`} />
      )}
      {healthLabel(key)}
    </span>
  );
}
