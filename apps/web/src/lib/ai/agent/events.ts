// Server-sent events emitted by POST /api/ai/chat.

export type AiChatStreamEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | {
      type: "tool_end";
      id: string;
      name: string;
      summary: string;
      isError: boolean;
      changedPaths: string[];
      treeChanged: boolean;
    }
  | { type: "build_queued"; buildId: string }
  | { type: "error"; message: string }
  | { type: "done" };
