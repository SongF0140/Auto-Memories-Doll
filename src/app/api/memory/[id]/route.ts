import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MemoryService } from "../../../../server/services/memory-service";
import { memoryUpdateSchema } from "../../../../lib/validation";

const idSchema = z.string().min(1).max(128);

function validateId(params: { id: string }) {
  const parsed = idSchema.safeParse(params.id);
  if (!parsed.success) {
    return NextResponse.json({ error: "无效的 ID" }, { status: 400 });
  }
  return null;
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

  const service = new MemoryService();

  try {
    const memory = service.getMemory(params.id);
    if (!memory) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }
    return NextResponse.json(memory);
  } finally {
    service.close();
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

  const body = await request.json();
  const parsed = memoryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const service = new MemoryService();

  try {
    const existing = service.getMemory(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    service.stageUpdateMemory(params.id, parsed.data);
    return NextResponse.json({ ...service.getMemory(params.id), ...parsed.data, status: "pending_audit" });
  } finally {
    service.close();
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

  const service = new MemoryService();

  try {
    const existing = service.getMemory(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    service.stageDeleteMemory(params.id);
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
