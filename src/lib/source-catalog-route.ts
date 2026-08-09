import { NextResponse } from "next/server"
import {
  sourceContentPinVersionMap,
  type SourceContentKind,
} from "@/lib/source-content-pins"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
}

/** JSON response for source catalog segments — always fresh + LUX install pins. */
export function sourceCatalogJsonResponse(
  sourceId: string,
  kind: SourceContentKind,
  payloadKey: "blueprints" | "templates" | "roles" | "collections",
  result: { items: unknown[]; catalogSource: string; catalogRef: string },
): NextResponse {
  return NextResponse.json(
    {
      [payloadKey]: result.items,
      catalogSource: result.catalogSource,
      catalogRef: result.catalogRef,
      pins: sourceContentPinVersionMap(sourceId, kind),
    },
    { headers: NO_STORE_HEADERS },
  )
}
