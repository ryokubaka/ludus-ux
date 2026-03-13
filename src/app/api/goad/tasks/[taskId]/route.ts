import { NextRequest, NextResponse } from "next/server"
import { getTask } from "@/lib/goad-task-store"

export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const task = getTask(params.taskId)
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }
  return NextResponse.json(task)
}
