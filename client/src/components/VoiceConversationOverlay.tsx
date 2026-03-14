import { PhoneOff, Mic, Cpu, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ListenState } from '@/hooks/useConversationMode';
import type { VoicePlaybackStatus } from '@/hooks/useVoicePlaybackController';

interface VoiceConversationOverlayProps {
  listenState: ListenState;
  isAgentResponding: boolean;
  playbackStatus: VoicePlaybackStatus;
  onEnd: () => void;
  onInterrupt: () => void;
}

function getStateDisplay(
  listenState: ListenState,
  isAgentResponding: boolean,
  playbackStatus: VoicePlaybackStatus,
): { label: string; color: string; Icon: React.ElementType; pulse: boolean } {
  if (listenState === 'listening') {
    return { label: 'Listening...', color: 'bg-green-500', Icon: Mic, pulse: true };
  }
  if (playbackStatus === 'playing') {
    return { label: 'Speaking...', color: 'bg-blue-500', Icon: Volume2, pulse: true };
  }
  if (isAgentResponding) {
    return { label: 'Thinking...', color: 'bg-yellow-400', Icon: Cpu, pulse: true };
  }
  return { label: 'Ready', color: 'bg-muted-foreground', Icon: Mic, pulse: false };
}

export function VoiceConversationOverlay({
  listenState,
  isAgentResponding,
  playbackStatus,
  onEnd,
  onInterrupt,
}: VoiceConversationOverlayProps) {
  const { label, color, Icon, pulse } = getStateDisplay(listenState, isAgentResponding, playbackStatus);
  const canInterrupt = playbackStatus === 'playing';

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        {/* State indicator */}
        <div className="flex items-center gap-3">
          <div className={cn('relative flex h-8 w-8 items-center justify-center rounded-full', color + '/20')}>
            <div className={cn('absolute inset-0 rounded-full', color, pulse && 'animate-ping opacity-30')} />
            <div className={cn('relative h-3 w-3 rounded-full', color)} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground">Voice conversation</p>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-2">
          {canInterrupt && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={onInterrupt}
              aria-label="Interrupt and speak"
            >
              <Icon className="h-3.5 w-3.5" />
              Interrupt
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            className="h-9 gap-1.5 rounded-full px-3 text-xs"
            onClick={onEnd}
            aria-label="End voice conversation"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            End call
          </Button>
        </div>
      </div>
    </div>
  );
}
