import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface Props {
  children: ReactNode;
  maxWidth?: string;
}

const navLinks = [
  { to: '/rooms', label: 'Lobby' },
  { to: '/ops', label: 'Ops' },
  { to: '/archives', label: 'Archives' },
];

export default function Layout({ children, maxWidth = 'max-w-[1400px]' }: Props) {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#050a0f]">
      <header className="border-b border-[#1a2e42] bg-[#070e18]/95 backdrop-blur-sm sticky top-0 z-50">
        <div className={`${maxWidth} mx-auto px-4 h-12 flex items-center gap-6`}>
          <Link to="/rooms" className="flex items-center gap-2 mr-2">
            <div className="h-6 w-1 rounded-full bg-cyan-400" />
            <span className="font-['Rajdhani'] text-lg font-bold tracking-widest text-white uppercase">MPP</span>
          </Link>
          <nav className="flex items-center gap-1">
            {navLinks.map((link) => {
              const active = location.pathname === link.to;
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`px-3 py-1.5 rounded text-xs font-semibold tracking-widest uppercase transition-colors ${
                    active
                      ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-800'
                      : 'text-[#5e7a94] hover:text-[#9bb8cc] hover:bg-white/5'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className={`${maxWidth} mx-auto px-4 py-6`}>
        {children}
      </main>
    </div>
  );
}
