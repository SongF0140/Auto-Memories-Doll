export type McpProtocolVersion = "1.0";

export type McpMessageType = "tool_list" | "tool_invoke" | "tool_result" | "error";

export interface McpMessage {
  version: McpProtocolVersion;
  type: McpMessageType;
  payload: any;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: Record<
    string,
    {
      type: "string" | "number" | "boolean" | "array" | "object";
      description?: string;
      required?: boolean;
    }
  >;
}

export interface McpToolListResponse {
  tools: McpTool[];
}

export interface McpToolInvokeRequest {
  toolName: string;
  arguments: Record<string, any>;
}

export interface McpToolResultResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export const serializeMessage = (message: McpMessage): string => {
  return JSON.stringify(message);
};

export const deserializeMessage = (data: string): McpMessage => {
  return JSON.parse(data);
};

export const buildToolListResponse = (tools: McpTool[]): McpMessage => {
  return {
    version: "1.0",
    type: "tool_list",
    payload: { tools },
  };
};

export const buildToolInvokeRequest = (
  toolName: string,
  arguments_: Record<string, any>,
): McpMessage => {
  return {
    version: "1.0",
    type: "tool_invoke",
    payload: { toolName, arguments: arguments_ },
  };
};

export const buildToolResultResponse = (
  success: boolean,
  data?: any,
  error?: string,
): McpMessage => {
  return {
    version: "1.0",
    type: "tool_result",
    payload: { success, data, error },
  };
};
