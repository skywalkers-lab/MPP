import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'default' | 'green' | 'amber' | 'red' | 'cyan';
  className?: string;
}

const accentMap = {
  default: 'text-[#dce8f5]',
  green: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  cyan: 'text-cyan-400',
};

export default function MetricCard({ label, value, sub, accent = 'default', className = '' }: Props) {
  return (
    <div className={`border border-[#1a2e42] bg-[#0a1724] p-3 ${className}`}>
      <div className="mb-1.5 text-[9px] font-mono tracking-[0.14em] text-[#4a6478] uppercase">
        {label}
      </div>
      <div className={`font-mono text-xl font-bold leading-none ${accentMap[accent]}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 text-[10px] text-[#4a6478] leading-snug">
          {sub}
        </div>
      )}
    </div>
  );
}
