import { Loader2 } from 'lucide-react';
import { useBranding } from '@/hooks/useBranding';

export function LoadingScreen() {
  const { agentName } = useBranding();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">{`Loading ${agentName}...`}</p>
      </div>
    </div>
  );
}