/**
 * Atlas Agent Status Indicator
 *
 * A Jarvis-style animated status component showing Atlas agent state:
 * - Idle: steady green pulse
 * - Thinking: blue pulse (processing)
 * - Streaming: animated blue ring
 */

import { cn } from "@/lib/utils";
import { Cpu, Zap, Brain } from "lucide-react";
import { useBranding } from '@/hooks/useBranding';

type AgentStatus = 'idle' | 'thinking' | 'streaming';

interface AtlasStatusIndicatorProps {
  status?: AgentStatus;
  activity?: string | null;
  className?: string;
  compact?: boolean;
}

const statusConfig = {
  idle: {
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    dot: 'bg-emerald-400',
    label: 'Online',
    icon: Zap,
  },
  thinking: {
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    dot: 'bg-blue-400',
    label: 'Processing',
    icon: Brain,
  },
  streaming: {
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    dot: 'bg-blue-400',
    label: 'Generating',
    icon: Cpu,
  },
};

export function AtlasStatusIndicator({
  status = 'idle',
  activity,
  className,
  compact = false,
}: AtlasStatusIndicatorProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isActive = status !== 'idle';

  if (compact) {
    return (
      <div className={cn("relative flex items-center", className)}>
        <div className={cn(
          "w-2 h-2 rounded-full",
          config.dot,
          isActive && "animate-pulse-dot"
        )} />
        {isActive && (
          <div className={cn(
            "absolute inset-0 rounded-full animate-status-ring",
            config.dot,
            "opacity-50"
          )} />
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium",
      config.bg,
      config.border,
      config.color,
      className
    )}>
      {/* Animated status dot */}
      <div className="relative flex items-center justify-center">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full",
          config.dot,
          isActive && "animate-pulse-dot"
        )} />
        {isActive && (
          <div className={cn(
            "absolute inset-0 w-1.5 h-1.5 rounded-full animate-status-ring",
            config.dot
          )} />
        )}
      </div>

      {/* Label */}
      <span>{activity && isActive ? activity : config.label}</span>
    </div>
  );
}

/**
 * Full-screen welcome state shown when no chat is active
 */
export function AtlasWelcome() {
  const { agentName } = useBranding();
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-8 px-6 py-12 text-center animate-fade-in">
      {/* Atlas orb */}
      <div className="relative flex items-center justify-center">
        {/* Outer glow ring */}
        <div className="absolute w-32 h-32 rounded-full bg-blue-500/5 animate-pulse" />
        <div className="absolute w-24 h-24 rounded-full bg-blue-500/8" />

        {/* Main orb */}
        <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(129,140,248,0.1) 100%)',
            border: '1px solid rgba(59,130,246,0.25)',
            boxShadow: '0 0 40px rgba(59,130,246,0.15), 0 0 80px rgba(59,130,246,0.05)',
          }}
        >
          <svg viewBox="0 0 32 32" fill="none" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="12" stroke="url(#welcome-grad)" strokeWidth="1.5" />
            <circle cx="16" cy="16" r="5" fill="url(#welcome-grad)" />
            <line x1="16" y1="4" x2="16" y2="28" stroke="url(#welcome-grad)" strokeWidth="0.75" opacity="0.4" />
            <line x1="4" y1="16" x2="28" y2="16" stroke="url(#welcome-grad)" strokeWidth="0.75" opacity="0.4" />
            <defs>
              <linearGradient id="welcome-grad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop stopColor="#60a5fa" />
                <stop offset="1" stopColor="#818cf8" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Status ring */}
        <div className="absolute -bottom-1 -right-1 flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/30">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot" />
        </div>
      </div>

      {/* Text */}
      <div className="space-y-2 max-w-md">
        <h2 className="text-xl font-semibold os-gradient-text">{agentName} is ready</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your autonomous AI assistant. Ask anything, analyze files, search the web, or let {agentName} handle complex multi-step tasks.
        </p>
      </div>

      {/* Capability chips */}
      <div className="flex flex-wrap justify-center gap-2 max-w-sm">
        {[
          { label: 'Agent Mode', color: 'os-badge-blue' },
          { label: 'Web Search', color: 'os-badge-blue' },
          { label: 'Shell & Files', color: 'os-badge-green' },
          { label: 'Code Execution', color: 'os-badge-purple' },
          { label: 'MCP Tools', color: 'os-badge-green' },
          { label: 'Persistent Memory', color: 'os-badge-amber' },
        ].map(({ label, color }) => (
          <div key={label} className={color}>{label}</div>
        ))}
      </div>
    </div>
  );
}
