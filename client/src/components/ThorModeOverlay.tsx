import { useEffect, useState } from 'react';

interface ThorModeOverlayProps {
  onComplete?: () => void;
}

export function ThorModeOverlay({ onComplete }: ThorModeOverlayProps) {
  const [phase, setPhase] = useState<'flash' | 'reveal' | 'fade'>('flash');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('reveal'), 200);
    const t2 = setTimeout(() => setPhase('fade'), 2400);
    const t3 = setTimeout(() => onComplete?.(), 3000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
      style={{
        opacity: phase === 'fade' ? 0 : 1,
        transition: 'opacity 600ms ease-out',
      }}
    >
      {/* Dark background */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, #0f2847 0%, #070d1a 70%, #000 100%)',
          opacity: phase === 'flash' ? 0 : 0.92,
          transition: 'opacity 300ms ease-in',
        }}
      />

      {/* Lightning flash */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 40%, rgba(59,130,246,0.8) 0%, rgba(59,130,246,0) 60%)',
          opacity: phase === 'flash' ? 1 : 0,
          transition: 'opacity 200ms ease-out',
        }}
      />

      {/* Central lightning bolt */}
      <div
        className="relative"
        style={{
          opacity: phase === 'flash' ? 0 : 1,
          transform: phase === 'reveal' ? 'scale(1)' : 'scale(0.8)',
          transition: 'opacity 400ms ease-out, transform 400ms ease-out',
        }}
      >
        <svg
          width="120"
          height="180"
          viewBox="0 0 120 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-[0_0_40px_rgba(250,204,21,0.6)]"
        >
          <path
            d="M70 0L20 85H52L40 180L100 80H65L70 0Z"
            fill="url(#thorBoltGrad)"
            stroke="#fbbf24"
            strokeWidth="2"
          />
          <defs>
            <linearGradient id="thorBoltGrad" x1="60" y1="0" x2="60" y2="180" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#facc15" />
              <stop offset="50%" stopColor="#eab308" />
              <stop offset="100%" stopColor="#ca8a04" />
            </linearGradient>
          </defs>
        </svg>

        {/* Glow ring */}
        <div
          className="absolute inset-0 -m-8 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.3) 0%, transparent 70%)',
            animation: phase === 'reveal' ? 'thor-pulse 1.5s ease-in-out infinite' : 'none',
          }}
        />
      </div>

      {/* Title text */}
      <div
        className="absolute bottom-[25%] text-center"
        style={{
          opacity: phase === 'reveal' ? 1 : 0,
          transform: phase === 'reveal' ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 500ms ease-out 400ms, transform 500ms ease-out 400ms',
        }}
      >
        <p className="text-2xl font-bold tracking-widest text-yellow-400 uppercase">
          Thor Mode
        </p>
        <p className="text-sm text-blue-300/80 mt-1">Maximum Performance Engaged</p>
      </div>

      <style>{`
        @keyframes thor-pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.3); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
