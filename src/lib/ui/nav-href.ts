/** Whether `pathname` is this nav target or a child route (except `/` which is exact). */
export function navHrefMatches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}
