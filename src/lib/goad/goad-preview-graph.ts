import { overlayGoadDomains, type GoadDirectory } from "@/lib/goad/goad-domain-map"
import { parseRangeDocument, projectGraph, type BuilderGraph } from "@/lib/range/range-builder-document"

/**
 * Canvas picture of a GOAD lab that has not been deployed.
 * The YAML is the rendered Ludus config. The directory fills domains the
 * template still leaves as Jinja. Nothing here is written to the range.
 */
export function graphForGoadPreview(
  yaml: string,
  directory: GoadDirectory | null,
  rangeId: string,
): BuilderGraph | null {
  if (!yaml.trim()) return null
  let graph: BuilderGraph
  try {
    graph = projectGraph(parseRangeDocument(yaml))
  } catch {
    return null
  }
  if (graph.vms.length === 0) return null
  if (!directory || !Array.isArray(directory.hosts) || directory.hosts.length === 0) return graph
  return overlayGoadDomains(graph, directory, rangeId)
}
