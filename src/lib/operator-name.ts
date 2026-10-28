/** LUX operator names compare case-insensitively; an empty name never matches. */
export function sameOperator(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a?.trim().toLowerCase() ?? ""
  const right = b?.trim().toLowerCase() ?? ""
  return left.length > 0 && left === right
}
