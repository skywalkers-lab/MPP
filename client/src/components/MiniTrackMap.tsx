import type { CarTrackPosition, TrackZone } from '../types';

interface MiniTrackMapProps {
  carPositions: CarTrackPosition[];
  hotZones?: TrackZone[];
  size?: 'sm' | 'md' | 'lg';
}

function getCarColor(car: CarTrackPosition): string {
  if (car.isPlayer) return '#3b82f6'; // blue-500
  if (car.driverStatus === 'FLYING_LAP') return '#22c55e'; // green-500
  if (car.pitStatus === 'IN_PIT' || car.driverStatus === 'IN_GARAGE') return '#6b7280'; // gray-500
  return '#eab308'; // yellow-500 (out/in lap)
}

function getCarRadius(car: CarTrackPosition, baseRadius: number): number {
  return car.isPlayer ? baseRadius * 1.6 : baseRadius;
}

export default function MiniTrackMap({ carPositions, hotZones = [], size = 'md' }: MiniTrackMapProps) {
  const dimensions = {
    sm: { width: 120, height: 120, trackRadius: 40, carRadius: 2.5 },
    md: { width: 180, height: 180, trackRadius: 60, carRadius: 3.5 },
    lg: { width: 240, height: 240, trackRadius: 80, carRadius: 4 },
  };

  const { width, height, trackRadius, carRadius } = dimensions[size];
  const center = width / 2;
  const pitRadius = trackRadius * 0.7;

  // Filter out cars in garage for track visualization
  const visibleCars = carPositions.filter(
    car => car.pitStatus !== 'IN_PIT' && car.driverStatus !== 'IN_GARAGE'
  );

  return (
    <div className="relative" style={{ width, height }}>
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className="w-full h-full"
        role="img" 
        aria-label="Track position map"
      >
        {/* Background */}
        <rect x="0" y="0" width={width} height={height} fill="rgba(6,11,18,0.95)" rx="8" />
        
        {/* Track outline (outer) */}
        <circle 
          cx={center} 
          cy={center} 
          r={trackRadius + 6} 
          fill="none" 
          stroke="rgba(49,71,96,0.3)" 
          strokeWidth="1"
        />
        
        {/* Track surface */}
        <circle 
          cx={center} 
          cy={center} 
          r={trackRadius} 
          fill="none" 
          stroke="#1a2e42" 
          strokeWidth="10"
        />
        
        {/* Hot zones */}
        {hotZones.map((zone, i) => {
          const startAngle = zone.start * 2 * Math.PI - Math.PI / 2;
          const endAngle = zone.end * 2 * Math.PI - Math.PI / 2;
          const largeArc = (zone.end - zone.start) > 0.5 ? 1 : 0;
          
          const x1 = center + trackRadius * Math.cos(startAngle);
          const y1 = center + trackRadius * Math.sin(startAngle);
          const x2 = center + trackRadius * Math.cos(endAngle);
          const y2 = center + trackRadius * Math.sin(endAngle);
          
          return (
            <path
              key={`zone-${i}`}
              d={`M ${x1} ${y1} A ${trackRadius} ${trackRadius} 0 ${largeArc} 1 ${x2} ${y2}`}
              fill="none"
              stroke="rgba(239, 68, 68, 0.5)"
              strokeWidth="10"
            />
          );
        })}
        
        {/* Start/Finish line */}
        <line 
          x1={center} 
          y1={center - trackRadius - 8} 
          x2={center} 
          y2={center - trackRadius + 8} 
          stroke="#f3bf52" 
          strokeWidth="2"
        />
        
        {/* Pit lane (simplified arc at bottom) */}
        <path
          d={`M ${center - pitRadius} ${center + trackRadius * 0.85} Q ${center} ${center + trackRadius * 1.1} ${center + pitRadius} ${center + trackRadius * 0.85}`}
          fill="none"
          stroke="#4a6478"
          strokeWidth="4"
          strokeDasharray="4 3"
        />
        
        {/* Pit entry marker */}
        <circle 
          cx={center + pitRadius} 
          cy={center + trackRadius * 0.85} 
          r="3" 
          fill="#4a6478"
        />
        
        {/* Car markers */}
        {visibleCars.map((car) => {
          const angle = car.lapDistance * 2 * Math.PI - Math.PI / 2;
          const x = center + trackRadius * Math.cos(angle);
          const y = center + trackRadius * Math.sin(angle);
          const r = getCarRadius(car, carRadius);
          
          return (
            <g key={car.carIndex}>
              {/* Glow effect for player */}
              {car.isPlayer && (
                <circle
                  cx={x}
                  cy={y}
                  r={r * 2}
                  fill={getCarColor(car)}
                  opacity="0.3"
                  className="animate-pulse"
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={getCarColor(car)}
                stroke={car.isPlayer ? '#fff' : 'none'}
                strokeWidth={car.isPlayer ? 1 : 0}
              />
            </g>
          );
        })}
        
        {/* Center info */}
        <text 
          x={center} 
          y={center - 4} 
          textAnchor="middle" 
          fill="#8d9db2" 
          fontSize="9" 
          fontFamily="monospace"
        >
          {visibleCars.length}
        </text>
        <text 
          x={center} 
          y={center + 8} 
          textAnchor="middle" 
          fill="#4a6478" 
          fontSize="7" 
          fontFamily="monospace"
        >
          ON TRACK
        </text>
      </svg>
      
      {/* Legend */}
      <div 
        className="absolute bottom-1 left-0 right-0 flex justify-center gap-3 text-[8px] font-mono"
        style={{ color: '#8d9db2' }}
      >
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22c55e' }} />
          Flying
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#eab308' }} />
          Out/In
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#3b82f6' }} />
          You
        </span>
      </div>
    </div>
  );
}
