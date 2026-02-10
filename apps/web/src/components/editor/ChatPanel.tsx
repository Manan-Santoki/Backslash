"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { MessageCircle, Send, ChevronUp, ChevronDown } from "lucide-react";
import type { ChatMessage } from "@backslash/shared";

// ─── Types ──────────────────────────────────────────

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserId: string;
  /** Map of userId → color for presence coloring */
  userColors: Map<string, string>;
  /** Map of userId → display name for read receipts */
  userNames?: Map<string, string>;
  /** Per-user read receipts keyed by userId */
  readState?: Map<string, { lastReadMessageId: string; timestamp: number }>;
  /** Called when the user has read through a message */
  onMarkRead?: (lastReadMessageId: string) => void;
  /** Static share history entries shown at the top of chat */
  shareHistoryEntries?: string[];
}

// ─── ChatPanel ──────────────────────────────────────

export function ChatPanel({
  messages,
  onSendMessage,
  currentUserId,
  userColors,
  userNames = new Map(),
  readState = new Map(),
  onMarkRead,
  shareHistoryEntries = [],
}: ChatPanelProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("chat-panel-collapsed") !== "false";
    } catch {
      return true;
    }
  });
  const [input, setInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);
  const initializedMessagesRef = useRef(false);
  const lastMarkedReadRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "chat-panel-collapsed",
        collapsed ? "true" : "false"
      );
    } catch {
      // Ignore localStorage errors
    }
  }, [collapsed]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!initializedMessagesRef.current) {
      initializedMessagesRef.current = true;
      prevMessageCountRef.current = messages.length;
      return;
    }

    if (!collapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnreadCount(0);
    } else if (messages.length > prevMessageCountRef.current) {
      // Increment unread count only for messages from others
      const incoming = messages.slice(prevMessageCountRef.current);
      const unreadIncoming = incoming.filter((m) => m.userId !== currentUserId).length;
      if (unreadIncoming > 0) {
        setUnreadCount((prev) => prev + unreadIncoming);
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, collapsed, currentUserId]);

  useEffect(() => {
    if (collapsed || messages.length === 0 || !onMarkRead) return;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.id) return;
    if (lastMarkedReadRef.current === lastMessage.id) return;
    lastMarkedReadRef.current = lastMessage.id;
    onMarkRead(lastMessage.id);
  }, [collapsed, messages, onMarkRead]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput("");
  }

  function formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div
      className={cn(
        "absolute bottom-2 right-2 z-30 flex flex-col rounded-lg border border-border bg-bg-secondary shadow-lg transition-all",
        collapsed ? "w-auto" : "w-80 h-96"
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => {
          setCollapsed((prev) => !prev);
          if (collapsed) setUnreadCount(0);
        }}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-primary hover:bg-bg-elevated transition-colors rounded-t-lg"
      >
        <MessageCircle className="h-4 w-4 text-accent" />
        <span>Chat</span>
        {collapsed && unreadCount > 0 && (
          <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg-primary">
            {unreadCount}
          </span>
        )}
        <span className="ml-auto">
          {collapsed ? (
            <ChevronUp className="h-3.5 w-3.5 text-text-muted" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
          )}
        </span>
      </button>

      {/* Content */}
      {!collapsed && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
            {shareHistoryEntries.length > 0 && (
              <div className="rounded-md border border-border bg-bg-primary/70 p-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Share history
                </p>
                <div className="space-y-1">
                  {shareHistoryEntries.map((entry, index) => (
                    <p key={`${entry}-${index}`} className="text-[11px] text-text-secondary">
                      {entry}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-text-muted">
                  No messages yet. Say hello!
                </p>
              </div>
            )}

            {(() => {
              const map = new Map<string, number>();
              for (let i = 0; i < messages.length; i++) {
                map.set(messages[i].id, i);
              }
              return messages.map((msg) => {
                const isOwn = msg.userId === currentUserId;
                const isBuild = msg.kind === "build" || msg.userId === "system:build";
                const isSystem = msg.kind === "system" || isBuild;
                const color = userColors.get(msg.userId) || "#89b4fa";

                const messageIndex = map.get(msg.id) ?? -1;
                const readBy = isOwn
                  ? Array.from(readState.entries())
                      .filter(([userId, receipt]) => {
                        if (userId === currentUserId) return false;
                        const readIdx = map.get(receipt.lastReadMessageId);
                        return readIdx !== undefined && readIdx >= messageIndex;
                      })
                      .map(([userId]) => userNames.get(userId) || "Collaborator")
                  : [];

                if (isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center py-1">
                      <div className="max-w-[95%] rounded-md border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-[11px] text-text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-accent">{msg.userName}</span>
                          {msg.build?.status && (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                msg.build.status === "success" && "bg-success/15 text-success",
                                msg.build.status === "error" && "bg-error/15 text-error",
                                msg.build.status === "timeout" && "bg-warning/15 text-warning",
                                msg.build.status === "canceled" && "bg-text-muted/15 text-text-muted",
                                (msg.build.status === "queued" ||
                                  msg.build.status === "compiling") &&
                                  "bg-accent/15 text-accent"
                              )}
                            >
                              {msg.build.status}
                            </span>
                          )}
                          <span className="text-[10px] text-text-muted">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                        <p className="mt-1 leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className={cn("flex flex-col", isOwn && "items-end")}>
                  <div className="flex items-baseline gap-1.5 mb-0.5">
                    <span
                      className="text-[11px] font-semibold"
                      style={{ color }}
                    >
                      {isOwn ? "You" : msg.userName}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed",
                      isOwn
                        ? "bg-accent/15 text-text-primary"
                        : "bg-bg-elevated text-text-secondary"
                    )}
                  >
                    {msg.text}
                  </div>
                  {isOwn && readBy.length > 0 && (
                    <p className="mt-1 text-[10px] text-text-muted">
                      Read by {readBy.join(", ")}
                    </p>
                  )}
                </div>
              );
              });
            })()}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-border px-3 py-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-md p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
