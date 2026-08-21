import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConfigService } from "../../../../../server/services/config-service";
import { mcpServerSchema } from "../../../../../lib/validation";


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
    const server = service.getMcpServer(params.id);
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    return NextResponse.json(server);
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

  const parsed = mcpServerSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const service = new ConfigService();
  try {
    const server = service.updateMcpServer(params.id, parsed.data);
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    return NextResponse.json(server);
  } finally {
    service.close();
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const err = validateId(params);
  if (err) return err;

  const service = new ConfigService();
  try {
    const deleted = service.deleteMcpServer(params.id);
    if (!deleted) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } finally {
    service.close();
  }
}
