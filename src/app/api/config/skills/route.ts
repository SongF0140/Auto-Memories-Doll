import { NextRequest, NextResponse } from "next/server";
import { ConfigService } from "../../../../server/services/config-service";
import { skillSchema } from "../../../../lib/validation";

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
    const parsed = skillSchema.safeParse(data);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const skill = service.createSkill(parsed.data);
    return NextResponse.json(skill);
  } finally {
    service.close();
  }
}
