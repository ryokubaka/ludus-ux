import dynamic from "next/dynamic"
import { RouteSegmentLoading } from "@/components/route-segment-loading"
import type { ComponentType } from "react"

/** Code-split a heavy client page island with a consistent loading fallback. */
export function dynamicPageClient<P extends Record<string, unknown>>(
  loader: () => Promise<{ default: ComponentType<P> } | { [key: string]: ComponentType<P> }>,
  exportName?: string,
) {
  return dynamic(
    () =>
      loader().then((mod) => {
        if ("default" in mod && mod.default) {
          return { default: mod.default as ComponentType<P> }
        }
        if (exportName && exportName in mod) {
          return { default: mod[exportName as keyof typeof mod] as ComponentType<P> }
        }
        throw new Error("dynamicPageClient: export not found")
      }),
    { loading: () => <RouteSegmentLoading /> },
  )
}
