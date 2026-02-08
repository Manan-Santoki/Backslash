"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { MessageCircle, Send, X, ChevronUp, ChevronDown } from "lucide-react";
import type { ChatMessage } from "@backslash/shared";

// ─── Types ──────────────────────────────────────────

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserId: string;
  /** Map of userId → color for presence coloring */
  userColors: Map<string, string>;
}

// ─── ChatPanel ──────────────────────────────────────

export function ChatPanel({
  messages,
  onSendMessage,
  currentUserId,
  userColors,
}: ChatPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [input, setInput] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!collapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnreadCount(0);
    } else if (messages.length > prevMessageCountRef.current) {
      // Increment unread count when collapsed
      setUnreadCount((prev) => prev + (messages.length - prevMessageCountRef.current));
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, collapsed]);

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
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-text-muted">
                  No messages yet. Say hello!
                </p>
              </div>
            )}

            {messages.map((msg) => {
              const isOwn = msg.userId === currentUserId;
              const color = userColors.get(msg.userId) || "#89b4fa";

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
                </div>
              );
            })}
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
