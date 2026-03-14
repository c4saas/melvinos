import { useTheme } from './ThemeProvider';
import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CCModeIndicator() {
  const { ccActive } = useTheme();

  if (!ccActive) return null;

  return (
    <div
      className={cn(
        'fixed top-3 right-3 z-[100] flex items-center gap-2 rounded-full px-3 py-1.5',
        'bg-amber-500 text-black shadow-lg shadow-amber-500/25',
        'animate-pulse text-xs font-semibold tracking-wide',
      )}
    >
      <Terminal className="h-3.5 w-3.5" />
      <span>Code Agent Active</span>
    </div>
  );
}
