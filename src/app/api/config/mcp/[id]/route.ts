import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../../server/services/config-service";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
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
  const service = new ConfigService();
  try {
    const updates = await request.json();
    const server = service.updateMcpServer(params.id, updates);
    if (!server) {
      return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    }
    return NextResponse.json(server);
  } finally {
    service.close();
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
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
