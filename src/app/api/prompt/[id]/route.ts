import { NextRequest, NextResponse } from "next/server";
import { PromptManager } from "../../../../features/prompt/manager";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const manager = new PromptManager();
  const template = manager.getTemplate(params.id);
  
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  
  return NextResponse.json(template);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { name, content, variables, description } = await request.json();
  const manager = new PromptManager();
  
  try {
    manager.updateTemplate(params.id, { name, content, variables, description });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 404 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const manager = new PromptManager();
  
  try {
    manager.deleteTemplate(params.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 404 });
  }
}