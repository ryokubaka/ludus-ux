"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { forwardRef, useCallback, useRef, type ComponentProps } from "react"
import type { UrlObject } from "url"
import { useNavPending } from "@/lib/nav-pending-context"

type AppNavLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  prefetch?: boolean | "auto" | null
}

function navPathFromHref(href: string | UrlObject): string {
  if (typeof href === "string") {
    const q = href.indexOf("?")
    return q >= 0 ? href.slice(0, q) : href
  }
  return href.pathname ?? ""
}

/**
 * App shell navigation link: warms the route on hover/focus, records pending href
 * on pointer down for instant sidebar/header feedback, and uses prefetch="auto"
 * (loading-boundary prefetch only — avoids full RSC prefetch storms).
 */
export const AppNavLink = forwardRef<HTMLAnchorElement, AppNavLinkProps>(function AppNavLink(
  { href, onPointerEnter, onFocus, onPointerDown, onTouchStart, prefetch = "auto", ...rest },
  ref,
) {
  const router = useRouter()
  const { setPendingHref } = useNavPending()
  const warmed = useRef(false)
  const hrefKey = navPathFromHref(href)

  const warmRoute = useCallback(() => {
    if (!hrefKey || warmed.current) return
    warmed.current = true
    router.prefetch(hrefKey)
  }, [router, hrefKey])

  return (
    <Link
      ref={ref}
      href={href}
      prefetch={prefetch}
      onPointerEnter={(e) => {
        warmRoute()
        onPointerEnter?.(e)
      }}
      onFocus={(e) => {
        warmRoute()
        onFocus?.(e)
      }}
      onPointerDown={(e) => {
        if (hrefKey) setPendingHref(hrefKey)
        onPointerDown?.(e)
      }}
      onTouchStart={(e) => {
        warmRoute()
        onTouchStart?.(e)
      }}
      {...rest}
    />
  )
})
