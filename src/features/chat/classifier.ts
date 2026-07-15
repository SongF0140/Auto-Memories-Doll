export type IntentType = 
  | "chat"
  | "memory_query"
  | "memory_create"
  | "memory_update"
  | "memory_delete"
  | "prompt_edit"
  | "system_command";

export interface IntentResult {
  type: IntentType;
  confidence: number;
  entities: Record<string, string>;
}

export class ChatClassifier {
  classify(text: string): IntentResult {
    const lowerText = text.toLowerCase().trim();
    
    if (lowerText.startsWith("/")) {
      return {
        type: "system_command",
        confidence: 0.95,
        entities: { command: lowerText.substring(1) },
      };
    }
    
    if (lowerText.includes("记住") || lowerText.includes("保存") || lowerText.includes("记录")) {
      return {
        type: "memory_create",
        confidence: 0.85,
        entities: {},
      };
    }
    
    if (lowerText.includes("更新") || lowerText.includes("修改") || lowerText.includes("编辑")) {
      return {
        type: "memory_update",
        confidence: 0.8,
        entities: {},
      };
    }
    
    if (lowerText.includes("删除") || lowerText.includes("移除") || lowerText.includes("清除")) {
      return {
        type: "memory_delete",
        confidence: 0.85,
        entities: {},
      };
    }
    
    if (lowerText.includes("查询") || lowerText.includes("查找") || lowerText.includes("搜索") || lowerText.includes("回忆")) {
      return {
        type: "memory_query",
        confidence: 0.8,
        entities: {},
      };
    }
    
    if (lowerText.includes("提示词") || lowerText.includes("prompt") || lowerText.includes("模板")) {
      return {
        type: "prompt_edit",
        confidence: 0.85,
        entities: {},
      };
    }
    
    return {
      type: "chat",
      confidence: 0.9,
      entities: {},
    };
  }
}