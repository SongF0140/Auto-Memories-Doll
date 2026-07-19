import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";

export async function GET() {
  const service = new ConfigService();
  try {
    const skills = service.listSkills();
    return NextResponse.json(skills);
  } finally {
    service.close();
  }
}

export async function POST(request: NextRequest) {
  const service = new ConfigService();
  try {
    const data = await request.json();

    if (!data.name || !data.trigger || !data.prompt) {
      return NextResponse.json(
        { error: "name, trigger and prompt are required" },
        { status: 400 }
      );
    }

    const skill = service.createSkill({
      name: data.name,
      trigger: data.trigger,
      prompt: data.prompt,
      enabled: data.enabled !== false,
      description: data.description,
    });

    return NextResponse.json(skill);
  } finally {
    service.close();
  }
}
