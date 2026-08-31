export type ApiRouteContract = {
  requestSchema?: string;
  responseSchema: string;
  errorCodes: readonly string[];
};

export const apiRouteContracts: Record<string, ApiRouteContract> = {
  "src/app/api/audit/route.ts": {
    requestSchema: "auditActionSchema",
    responseSchema: "auditResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/audit/conflicts/route.ts": {
    requestSchema: "conflictResolveSchema",
    responseSchema: "conflictResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "NOT_FOUND", "AUDIT_CONFLICT", "INTERNAL_ERROR"],
  },
  "src/app/api/audit/review-events/route.ts": {
    requestSchema: "reviewDecisionSchema",
    responseSchema: "reviewEventsResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "NOT_FOUND", "INTERNAL_ERROR"],
  },
  "src/app/api/chat/route.ts": {
    requestSchema: "chatRequestSchema",
    responseSchema: "chatResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "AI_UNAVAILABLE", "INTERNAL_ERROR"],
  },
  "src/app/api/chat/sessions/route.ts": {
    responseSchema: "chatSessionSummaryResponseSchema",
    errorCodes: ["INTERNAL_ERROR"],
  },
  "src/app/api/chat/sessions/import/route.ts": {
    requestSchema: "chatSessionImportSchema",
    responseSchema: "chatSessionImportResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/chat/sessions/[id]/route.ts": {
    requestSchema: "chatSessionWriteSchema",
    responseSchema: "chatSessionDetailResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "NOT_FOUND", "INTERNAL_ERROR"],
  },
  "src/app/api/chat/stream/route.ts": {
    requestSchema: "chatRequestSchema",
    responseSchema: "streamResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "AI_UNAVAILABLE", "CHAT_NO_RESPONSE_BODY", "INTERNAL_ERROR"],
  },
  "src/app/api/config/ai/route.ts": {
    requestSchema: "aiConfigSchema",
    responseSchema: "aiConfigResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/config/ai/test/route.ts": {
    requestSchema: "aiConfigTestSchema",
    responseSchema: "aiConfigTestResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/config/mcp/route.ts": {
    requestSchema: "mcpServerSchema",
    responseSchema: "mcpServerListResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/config/mcp/[id]/route.ts": {
    requestSchema: "mcpServerSchema",
    responseSchema: "mcpServerResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "NOT_FOUND", "INTERNAL_ERROR"],
  },
  "src/app/api/config/skills/route.ts": {
    requestSchema: "skillSchema",
    responseSchema: "skillListResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/config/skills/import/route.ts": {
    requestSchema: "skillImportSchema",
    responseSchema: "skillImportResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/config/skills/[id]/route.ts": {
    requestSchema: "skillSchema",
    responseSchema: "skillResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "NOT_FOUND", "INTERNAL_ERROR"],
  },
  "src/app/api/config/storage/route.ts": {
    requestSchema: "storageConfigUpdateSchema",
    responseSchema: "storageConfigResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/config/tool-sources/route.ts": {
    requestSchema: "toolSourceCreateSchema",
    responseSchema: "toolSourceListResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/config/tool-sources/[id]/route.ts": {
    requestSchema: "toolSourceUpdateSchema",
    responseSchema: "toolSourceResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "NOT_FOUND", "INTERNAL_ERROR"],
  },
  "src/app/api/config/tool-sources/status/route.ts": {
    responseSchema: "toolSourceStatusResponseSchema",
    errorCodes: ["INTERNAL_ERROR"],
  },
  "src/app/api/health/route.ts": {
    responseSchema: "healthResponseSchema",
    errorCodes: [],
  },
  "src/app/api/ingest/route.ts": {
    requestSchema: "ingestRequestSchema",
    responseSchema: "ingestResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INGEST_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/listen/route.ts": {
    requestSchema: "listenRequestSchema",
    responseSchema: "listenResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INVALID_JSON", "INTERNAL_ERROR"],
  },
  "src/app/api/listen/scan/route.ts": {
    responseSchema: "listenScanResponseSchema",
    errorCodes: ["INTERNAL_ERROR"],
  },
  "src/app/api/listen/import/route.ts": {
    responseSchema: "listenImportResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/listen/rebuild/route.ts": {
    responseSchema: "listenRebuildResponseSchema",
    errorCodes: ["INTERNAL_ERROR"],
  },
  "src/app/api/memory/route.ts": {
    requestSchema: "memoryCreateSchema",
    responseSchema: "memoryResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "MEMORY_CREATE_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/memory/search/route.ts": {
    responseSchema: "memorySearchResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "MEMORY_VECTOR_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/memory/[id]/route.ts": {
    requestSchema: "memoryUpdateSchema",
    responseSchema: "memoryDetailResponseSchema",
    errorCodes: [
      "VALIDATION_FAILED",
      "NOT_FOUND",
      "MEMORY_UPDATE_FAILED",
      "MEMORY_DELETE_FAILED",
      "INTERNAL_ERROR",
    ],
  },
  "src/app/api/memory/rebuild/route.ts": {
    responseSchema: "memoryRebuildResponseSchema",
    errorCodes: ["INTERNAL_ERROR"],
  },
  "src/app/api/memory/[id]/access/route.ts": {
    responseSchema: "memoryAccessResponseSchema",
    errorCodes: ["NOT_FOUND", "INTERNAL_ERROR"],
  },
  "src/app/api/profile/route.ts": {
    requestSchema: "analyzeRequestSchema",
    responseSchema: "profileResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/prompt/route.ts": {
    requestSchema: "promptCreateSchema",
    responseSchema: "promptListResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "PROMPT_CREATE_FAILED", "INTERNAL_ERROR"],
  },
  "src/app/api/prompt/[id]/route.ts": {
    requestSchema: "promptUpdateSchema",
    responseSchema: "promptDetailResponseSchema",
    errorCodes: ["VALIDATION_FAILED", "NOT_FOUND", "PROMPT_NOT_FOUND", "INTERNAL_ERROR"],
  },
};
