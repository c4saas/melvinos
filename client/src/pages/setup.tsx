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
import { Eye, EyeOff, Shield, Zap, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranding } from '@/hooks/useBranding';

const setupSchema = z.object({
  username: z.string().min(1, "Username is required").max(50),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type SetupFormData = z.infer<typeof setupSchema>;

export default function Setup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { agentName, agentNameUpper, platformName } = useBranding();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SetupFormData>({
    resolver: zodResolver(setupSchema),
    defaultValues: { username: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: SetupFormData) => {
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/setup", {
        username: data.username,
        password: data.password,
        email: data.email || undefined,
      });

      toast({ title: "Setup complete", description: `Welcome to ${agentName}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/app");
    } catch (error) {
      console.error("Setup error:", error);
      toast({
        title: "Setup failed",
        description: error instanceof Error ? error.message : "Please try again.",
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
          <div className="relative inline-flex items-center justify-center w-16 h-16 mb-5">
            <div className="absolute inset-0 rounded-2xl bg-blue-500/15 border border-blue-500/30" />
            <div className="absolute inset-0 rounded-2xl animate-pulse-glow opacity-50" />
            <Rocket className="relative w-8 h-8 text-blue-400" />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight os-gradient-text">{agentNameUpper}</h1>
          <p className="text-xs text-muted-foreground mt-1 tracking-widest uppercase font-medium">
            First-Time Setup
          </p>

          <div className="flex items-center justify-center gap-4 mt-4">
            {[
              { icon: Shield, label: "Create Account", color: "text-blue-400" },
              { icon: Zap, label: "Get Started", color: "text-violet-400" },
            ].map(({ icon: Icon, label, color }) => (
              <div key={label} className={cn("flex items-center gap-1.5 text-xs font-medium", color)}>
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Setup card */}
        <div className="os-panel p-6">
          <div className="flex items-center gap-2 mb-5 pb-4 border-b border-border/60">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-dot" />
            <span className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">
              Create Your Account
            </span>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Username
              </Label>
              <Input
                id="username"
                type="text"
                placeholder="admin"
                autoComplete="username"
                className="bg-background/50 border-border/70 focus-visible:border-primary/60 focus-visible:ring-primary/20 h-10"
                {...register("username")}
              />
              {errors.username && (
                <p className="text-xs text-destructive">{errors.username.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Email <span className="text-muted-foreground/60 normal-case">(optional)</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                className="bg-background/50 border-border/70 focus-visible:border-primary/60 focus-visible:ring-primary/20 h-10"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Min 8 chars, upper+lower+number"
                  autoComplete="new-password"
                  className="bg-background/50 border-border/70 focus-visible:border-primary/60 focus-visible:ring-primary/20 h-10 pr-10"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                placeholder="Re-enter password"
                autoComplete="new-password"
                className="bg-background/50 border-border/70 focus-visible:border-primary/60 focus-visible:ring-primary/20 h-10"
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-10 font-semibold tracking-wide bg-blue-600 hover:bg-blue-500 text-white border-0 shadow-os-glow-sm"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="os-typing-dot" />
                    <span className="os-typing-dot" />
                    <span className="os-typing-dot" />
                  </span>
                  Setting up
                </span>
              ) : (
                <>Initialize {agentName}</>
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground/40 mt-6">
          {agentName} — {platformName}
        </p>
      </div>
    </div>
  );
}
