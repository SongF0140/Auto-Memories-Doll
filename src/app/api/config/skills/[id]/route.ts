import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../../server/services/config-service";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const service = new ConfigService();
  try {
    const skill = service.getSkill(params.id);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    return NextResponse.json(skill);
  } finally {
    service.close();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const service = new ConfigService();
  try {
    const updates = await request.json();
    const skill = service.updateSkill(params.id, updates);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    return NextResponse.json(skill);
  } finally {
    service.close();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const service = new ConfigService();
  try {
    const deleted = service.deleteSkill(params.id);
    if (!deleted) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
