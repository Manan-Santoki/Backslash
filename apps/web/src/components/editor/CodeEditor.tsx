"use client";

import { useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { useTheme } from "@/components/ThemeProvider";

// ─── Types ──────────────────────────────────────────

interface CodeEditorProps {
  content: string;
  onChange: (value: string) => void;
  language?: string;
}

export interface CodeEditorHandle {
  highlightText: (text: string) => void;
}

// ─── CodeEditor ─────────────────────────────────────

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor({ content, onChange, language = "latex" }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewRef = useRef<any>(null);
    const onChangeRef = useRef(onChange);
    const isExternalUpdate = useRef(false);
    const { theme } = useTheme();

    // Keep onChange ref current
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    // Expose highlightText to parent
    useImperativeHandle(
      ref,
      () => ({
        highlightText: (text: string) => {
          const view = viewRef.current;
          if (!view || !text || text.length < 3) return;

          const doc = view.state.doc.toString();
          // Normalize whitespace for matching
          const normalized = text.replace(/\s+/g, " ").trim();
          const docNormalized = doc.replace(/\s+/g, " ");
          const idx = docNormalized.indexOf(normalized);
          if (idx === -1) return;

          // Map normalized index back to original doc position
          // Walk through original doc counting non-collapsed chars
          let origFrom = 0;
          let normCount = 0;
          for (let i = 0; i < doc.length && normCount < idx; i++) {
            origFrom = i + 1;
            if (/\s/.test(doc[i])) {
              // skip consecutive whitespace in normalized
              while (i + 1 < doc.length && /\s/.test(doc[i + 1])) i++;
            }
            normCount++;
          }

          // For simplicity, use search to find exact match
          const searchIdx = doc.indexOf(text);
          const from = searchIdx !== -1 ? searchIdx : 0;
          const to = searchIdx !== -1 ? searchIdx + text.length : 0;

          if (from === 0 && to === 0) return;

          // Scroll to position and select
          view.dispatch({
            selection: { anchor: from, head: to },
            scrollIntoView: true,
          });
          view.focus();
        },
      }),
      []
    );

    // Initialize CodeMirror
    useEffect(() => {
      if (!containerRef.current) return;

      let view: import("@codemirror/view").EditorView | null = null;

      async function initEditor() {
        const { EditorState } = await import("@codemirror/state");
        const {
          EditorView,
          lineNumbers,
          highlightActiveLine,
          keymap,
          drawSelection,
          highlightSpecialChars,
        } = await import("@codemirror/view");
        const {
          defaultHighlightStyle,
          syntaxHighlighting,
          indentOnInput,
          bracketMatching,
          StreamLanguage,
        } = await import("@codemirror/language");
        const { closeBrackets, closeBracketsKeymap } = await import(
          "@codemirror/autocomplete"
        );
        const { defaultKeymap, indentWithTab, history, historyKeymap } =
          await import("@codemirror/commands");
        const { search, searchKeymap } = await import("@codemirror/search");
        const { stex } = await import("@codemirror/legacy-modes/mode/stex");

        if (!containerRef.current) return;

        const isDark = theme === "dark";

        const editorTheme = EditorView.theme(
          {
            "&": {
              backgroundColor: "var(--color-editor-bg)",
              color: "var(--color-text-primary)",
              height: "100%",
            },
            ".cm-content": {
              fontFamily: "var(--font-mono)",
              fontSize: "14px",
              caretColor: "var(--color-accent)",
              padding: "8px 0",
            },
            ".cm-cursor, .cm-dropCursor": {
              borderLeftColor: "var(--color-accent)",
            },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              backgroundColor: "var(--color-editor-selection)",
            },
            ".cm-activeLine": {
              backgroundColor: "var(--color-editor-line-hl)",
            },
            ".cm-gutters": {
              backgroundColor: "var(--color-editor-gutter)",
              color: "var(--color-text-muted)",
              borderRight: "1px solid var(--color-border)",
            },
            ".cm-activeLineGutter": {
              backgroundColor: "var(--color-editor-line-hl)",
              color: "var(--color-text-secondary)",
            },
            ".cm-foldPlaceholder": {
              backgroundColor: "var(--color-bg-elevated)",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
            },
            ".cm-tooltip": {
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            },
            ".cm-tooltip-autocomplete": {
              backgroundColor: "var(--color-bg-secondary)",
            },
            ".cm-searchMatch": {
              backgroundColor: "var(--color-accent)",
              opacity: "0.3",
            },
            ".cm-searchMatch.cm-searchMatch-selected": {
              backgroundColor: "var(--color-accent)",
              opacity: "0.5",
            },
            ".cm-panels": {
              backgroundColor: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
            },
            ".cm-panels.cm-panels-top": {
              borderBottom: "1px solid var(--color-border)",
            },
            ".cm-panels.cm-panels-bottom": {
              borderTop: "1px solid var(--color-border)",
            },
            ".cm-panel.cm-search": {
              backgroundColor: "var(--color-bg-secondary)",
            },
            ".cm-panel.cm-search input": {
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border)",
            },
            ".cm-panel.cm-search button": {
              backgroundColor: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border)",
            },
          },
          { dark: isDark }
        );

        const state = EditorState.create({
          doc: content,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            highlightSpecialChars(),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            history(),
            search(),
            StreamLanguage.define(stex),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            EditorView.lineWrapping,
            editorTheme,
            keymap.of([
              ...defaultKeymap,
              ...searchKeymap,
              ...historyKeymap,
              ...closeBracketsKeymap,
              indentWithTab,
            ]),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !isExternalUpdate.current) {
                const value = update.state.doc.toString();
                onChangeRef.current(value);
              }
            }),
          ],
        });

        view = new EditorView({
          state,
          parent: containerRef.current!,
        });

        viewRef.current = view;
      }

      initEditor();

      return () => {
        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }
      };
      // Re-init when theme changes to swap dark/light mode
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme]);

    // Update content from outside without losing cursor position
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      const currentContent = view.state.doc.toString();
      if (currentContent !== content) {
        isExternalUpdate.current = true;
        view.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          },
        });
        isExternalUpdate.current = false;
      }
    }, [content]);

    return (
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden bg-editor-bg"
      />
    );
  }
);
