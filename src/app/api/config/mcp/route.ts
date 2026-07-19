import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";

export async function GET() {
  const service = new ConfigService();
  try {
    const servers = service.listMcpServers();
    return NextResponse.json(servers);
  } finally {
    service.close();
  }
}

export async function POST(request: NextRequest) {
  const service = new ConfigService();
  try {
    const data = await request.json();

    if (!data.name || !data.command) {
      return NextResponse.json(
        { error: "name and command are required" },
        { status: 400 }
      );
    }

    const server = service.createMcpServer({
      name: data.name,
      command: data.command,
      args: data.args || [],
      env: data.env || {},
      enabled: data.enabled !== false,
      description: data.description,
    });

    return NextResponse.json(server);
  } finally {
    service.close();
  }
}
