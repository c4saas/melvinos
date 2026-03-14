import * as React from "react"

import { cn } from "@/lib/utils"

type TextareaVariant = "default" | "code"

interface TextareaProps extends React.ComponentProps<"textarea"> {
  variant?: TextareaVariant
}

const baseClasses =
  "flex w-full rounded-md border px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"

const variantClasses: Record<TextareaVariant, string> = {
  default: "min-h-[80px] border-input bg-background",
  code: cn(
    "min-h-[120px] border-[var(--os-codebox-border)] bg-[var(--os-codebox-surface)] text-[var(--os-codebox-foreground)] placeholder:text-[var(--os-codebox-placeholder)] font-mono focus-visible:ring-slate-600 focus-visible:ring-offset-0 overflow-y-auto scrollbar-thin"
  ),
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <textarea
        className={cn(baseClasses, variantClasses[variant], className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
