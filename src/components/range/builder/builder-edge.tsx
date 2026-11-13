"use client"

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react"
import { cn } from "@/lib/core/utils"
import { arrowHeadPath, gapEdgePath, intoFace, labelThatFits } from "./builder-routing"
import type { BuilderEdge } from "./builder-types"

let onEdgeActivate: ((id: string) => void) | null = null

/** The canvas registers this so a label click selects the same edge as the line. */
export function bindBuilderEdgeActivate(handler: ((id: string) => void) | null) {
  onEdgeActivate = handler
}

export function CorridorEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  markerStart,
  style,
  label,
  selected,
}: EdgeProps<BuilderEdge>) {
  const routed = gapEdgePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    lane: data?.lane ?? 0,
    obstacles: data?.obstacles,
  })
  const placement =
    routed.labelPlacement === "before"
      ? "translate(calc(-100% - 6px), -50%)"
      : routed.labelPlacement === "after"
        ? "translate(6px, -50%)"
        : "translate(-50%, -50%)"
  const full = typeof label === "string" ? label : ""
  const room = routed.labelPlacement === "center" ? Math.abs(targetX - sourceX) : 40
  const shown = full ? labelThatFits(full, data?.shortLabel ?? "", room) : label
  const trustTone =
    data?.relation === "parent-child"
      ? "border-cyan-400/80 text-cyan-100"
      : data?.kind === "trust"
        ? "border-purple-400/80 text-purple-100"
        : "border-border text-foreground"
  const color = typeof style?.stroke === "string" ? style.stroke : "#94a3b8"
  const activeStroke = selected
    ? data?.relation === "parent-child"
      ? "#67e8f9"
      : data?.kind === "trust"
        ? "#f0abfc"
        : "#ffffff"
    : color
  const edgeStyle = {
    ...style,
    stroke: activeStroke,
    strokeWidth: selected ? 4 : style?.strokeWidth,
    filter: selected ? `drop-shadow(0 0 6px ${activeStroke})` : undefined,
  }
  const targetArrow = intoFace(targetPosition)
  const sourceArrow = intoFace(sourcePosition)
  return (
    <>
      <BaseEdge id={id} path={routed.path} style={edgeStyle} interactionWidth={16} />
      {markerEnd != null && (
        <path
          d={arrowHeadPath(targetX, targetY, targetArrow.dx, targetArrow.dy)}
          fill={activeStroke}
          stroke="none"
          pointerEvents="none"
        />
      )}
      {markerStart != null && (
        <path
          d={arrowHeadPath(sourceX, sourceY, sourceArrow.dx, sourceArrow.dy)}
          fill={activeStroke}
          stroke="none"
          pointerEvents="none"
        />
      )}
      {shown != null && shown !== "" && (
        <EdgeLabelRenderer>
          <div
            role="button"
            tabIndex={0}
            className={cn(
              "nodrag nopan pointer-events-auto absolute cursor-pointer whitespace-nowrap rounded border bg-card px-1.5 py-0.5 text-[10px] font-medium shadow-sm",
              selected
                ? "z-[2] border-2 border-white bg-primary px-2 py-1 text-[11px] text-primary-foreground shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-background"
                : trustTone,
            )}
            title={full && full !== shown ? full : undefined}
            style={{
              transform: `${placement} translate(${routed.labelX}px, ${routed.labelY}px)${selected ? " scale(1.15)" : ""}`,
            }}
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
              onEdgeActivate?.(id)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              onEdgeActivate?.(id)
            }}
          >
            {shown}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const builderEdgeTypes = { corridor: CorridorEdge }
