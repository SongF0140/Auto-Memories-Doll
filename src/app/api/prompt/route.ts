import { NextRequest, NextResponse } from "next/server";
import { PromptManager } from "../../../features/prompt/manager";

export async function GET() {
  const manager = new PromptManager();
  const templates = manager.listTemplates();
  return NextResponse.json(templates);
}

export async function POST(request: NextRequest) {
  const { id, name, content, variables, description } = await request.json();
  
  if (!id || !content) {
    return NextResponse.json(
      { error: "id and content are required" },
      { status: 400 }
    );
  }

  const manager = new PromptManager();
  
  try {
    manager.addTemplate({ id, name: name || id, content, variables: variables || [], description: description || "" });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}