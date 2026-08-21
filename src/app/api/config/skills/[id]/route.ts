import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConfigService } from "../../../../../server/services/config-service";
import { skillSchema } from "../../../../../lib/validation";


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

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是合法的 JSON" }, { status: 400 });
  }

  const parsed = skillSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const service = new ConfigService();
  try {
    const skill = service.updateSkill(params.id, parsed.data);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }
    return NextResponse.json(skill);
  } finally {
    service.close();
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

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
