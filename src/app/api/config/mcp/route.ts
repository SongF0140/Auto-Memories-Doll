import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { mcpServerSchema } from "../../../../lib/validation";


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
    const parsed = mcpServerSchema.safeParse(data);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const server = service.createMcpServer(parsed.data);
    return NextResponse.json(server);
  } finally {
    service.close();
  }
}
