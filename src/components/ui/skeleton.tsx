import { cn } from "@/lib/core/utils"

/**
 * Placeholder block for content that is still loading. Use it to preserve the
 * layout of a table or card so a cold load does not look like an empty result.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}
