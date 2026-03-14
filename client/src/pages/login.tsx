import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, EyeOff, Zap, Shield, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from '@/hooks/useBranding';

const loginSchema = z.object({
  identifier: z.string().min(1, "Email or username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { agentName, agentNameUpper, platformName } = useBranding();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/auth/login", data);
      const result = (await response.json()) as { user?: { role?: string } };

      toast({ title: "Access granted.", description: `Initializing ${agentName}...` });

      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });

      const role = result.user?.role;
      let preferences: { lastArea?: string } | undefined;

      try {
        const preferencesResponse = await apiRequest("GET", "/api/user/preferences");
        preferences = (await preferencesResponse.json()) as { lastArea?: string };
      } catch {
        // ignore
      }

      const destination = resolveLoginDestination({ role, preferences });
      setLocation(destination);
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Authentication failed",
        description: "Invalid credentials. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      {/* Background grid */}
      <div className="absolute inset-0 os-grid-bg opacity-60 pointer-events-none" />

      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/4 w-[600px] h-[400px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md mx-4 animate-fade-in-up">
        {/* Header */}
        <div className="text-center mb-8">
          {/* Atlas mark */}
          <div className="relative inline-flex items-center justify-center w-16 h-16 mb-5">
            <div className="absolute inset-0 rounded-2xl bg-blue-500/15 border border-blue-500/30" />
            <div className="absolute inset-0 rounded-2xl animate-pulse-glow opacity-50" />
            <svg
              viewBox="0 0 32 32"
              fill="none"
              className="relative w-8 h-8"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="16" cy="16" r="12" stroke="url(#os-login-gradient)" strokeWidth="1.5" />
              <path
                d="M16 4 L16 28 M4 16 L28 16"
                stroke="url(#os-login-gradient)"
                strokeWidth="1"
                opacity="0.5"
              />
              <circle cx="16" cy="16" r="4" fill="url(#os-login-gradient)" />
              <defs>
                <linearGradient id="os-login-gradient" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#60a5fa" />
                  <stop offset="1" stopColor="#818cf8" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight os-gradient-text">{agentNameUpper}</h1>
          <p className="text-xs text-muted-foreground mt-1 tracking-widest uppercase font-medium">
            Autonomous Intelligence System
          </p>

          {/* Status strip */}
          <div className="flex items-center justify-center gap-4 mt-4">
            {[
              { icon: Activity, label: "Systems Online", color: "text-emerald-400" },
              { icon: Shield, label: "Secured", color: "text-blue-400" },
              { icon: Zap, label: "Ready", color: "text-violet-400" },
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className={cn("flex items-center gap-1.5 text-xs font-medium", color)}>
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Login card */}
        <div className="os-panel p-6">
          {/* Card header line */}
          <div className="flex items-center gap-2 mb-5 pb-4 border-b border-border/60">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-dot" />
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Identity Verification
            </span>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Access ID
              </Label>
              <Input
                id="identifier"
                type="text"
                placeholder="email or username"
                data-testid="input-identifier"
                autoComplete="username"
                className="bg-background/50 border-border/70 focus-visible:border-primary/60 focus-visible:ring-primary/20 h-10"
                {...register("identifier")}
              />
              {errors.identifier && (
                <p className="text-xs text-destructive">{errors.identifier.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                  Auth Key
                </Label>
                <button
                  type="button"
                  className="text-xs text-primary/80 hover:text-primary transition-colors"
                  onClick={() => setLocation("/forgot-password")}
                  data-testid="link-forgot-password"
                >
                  Reset key
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  data-testid="input-password"
                  autoComplete="current-password"
                  className="bg-background/50 border-border/70 focus-visible:border-primary/60 focus-visible:ring-primary/20 h-10 pr-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-10 font-semibold tracking-wide bg-blue-600 hover:bg-blue-500 text-white border-0 shadow-os-glow-sm"
              disabled={isLoading}
              data-testid="button-login-submit"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="os-typing-dot" />
                    <span className="os-typing-dot" />
                    <span className="os-typing-dot" />
                  </span>
                  Authenticating
                </span>
              ) : (
                "Initiate Session"
              )}
            </Button>
          </form>

        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/40 mt-6">
          {agentName} — {platformName}
        </p>
      </div>
    </div>
  );
}

export function resolveLoginDestination({
  role,
  preferences,
}: {
  role?: string;
  preferences?: { lastArea?: string } | null;
}) {
  const canAccessAdmin = role === "admin" || role === "super_admin";
  if (canAccessAdmin && preferences?.lastArea === "admin") {
    return "/settings";
  }
  return "/app";
}
