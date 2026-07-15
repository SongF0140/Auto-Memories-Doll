import { NextRequest, NextResponse } from "next/server";
import { MemoryService } from "../../../../server/services/memory-service";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const updates = await request.json();
  const service = new MemoryService();
  
  try {
    const existing = service.getMemory(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    service.updateMemory(params.id, updates);
    return NextResponse.json(service.getMemory(params.id));
  } finally {
    service.close();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const service = new MemoryService();
  
  try {
    const existing = service.getMemory(params.id);
    if (!existing) {
      return NextResponse.json({ error: "Memory not found" }, { status: 404 });
    }

    service.deleteMemory(params.id);
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}