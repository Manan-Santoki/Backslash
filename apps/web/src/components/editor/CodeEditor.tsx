"use client";

import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import type { DocChange, CursorSelection } from "@backslash/shared";

// ─── Types ──────────────────────────────────────────

interface RemoteCursorData {
  color: string;
  name: string;
  selection: CursorSelection;
}

interface BuildError {
  type: string;
  file: string;
  line: number;
  message: string;
}

interface CodeSelection {
  anchor: number;
  head: number;
}

interface CodeEditorProps {
  content: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  errors?: BuildError[];
  // Collaboration
  onDocChange?: (changes: DocChange[]) => void;
  onCursorChange?: (selection: CursorSelection) => void;
  remoteChanges?: { fileId: string; userId: string; changes: DocChange[] } | null;
  remoteCursors?: Map<string, RemoteCursorData>;
}

export interface CodeEditorHandle {
  highlightText: (text: string) => void;
  scrollToLine: (line: number) => void;
  getScrollPosition: () => number;
  setScrollPosition: (pos: number) => void;
  getSelection: () => CodeSelection | null;
  setSelection: (selection: CodeSelection) => void;
}

// ─── CodeEditor ─────────────────────────────────────

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
      {
        content,
        onChange,
        readOnly = false,
        errors,
      onDocChange,
      onCursorChange,
      remoteChanges,
      remoteCursors,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewRef = useRef<any>(null);
    const contentRef = useRef(content);
    contentRef.current = content;
    const onChangeRef = useRef(onChange);
    const onDocChangeRef = useRef(onDocChange);
    const onCursorChangeRef = useRef(onCursorChange);
    const isExternalUpdate = useRef(false);
    const cursorEmitRafRef = useRef<number | null>(null);
    const lastCursorEmitKeyRef = useRef<string>("");
    // Keep callback refs current
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
      onDocChangeRef.current = onDocChange;
    }, [onDocChange]);

    useEffect(() => {
      onCursorChangeRef.current = onCursorChange;
    }, [onCursorChange]);

    // Expose highlightText and scrollToLine to parent
    useImperativeHandle(
      ref,
      () => ({
        highlightText: (text: string) => {
          const view = viewRef.current;
          if (!view || !text) return;

          const query = text.replace(/\s+/g, " ").trim();
          if (query.length < 2) return;

          const doc = view.state.doc.toString();
          const cursorPos = view.state.selection.main.head;

          function normalizeWithMap(source: string) {
            const map: number[] = [];
            let normalized = "";
            let inWhitespace = false;
            for (let i = 0; i < source.length; i++) {
              if (/\s/.test(source[i])) {
                if (!inWhitespace) {
                  normalized += " ";
                  map.push(i);
                  inWhitespace = true;
                }
              } else {
                normalized += source[i];
                map.push(i);
                inWhitespace = false;
              }
            }
            return { normalized, map };
          }

          function normalizedRangeToOriginal(
            map: number[],
            fromNorm: number,
            toNormExclusive: number,
            docLength: number
          ) {
            const from = map[fromNorm] ?? 0;
            const normEnd = toNormExclusive - 1;
            const to =
              normEnd >= 0 && normEnd < map.length ? map[normEnd] + 1 : docLength;
            return { from, to };
          }

          // Try exact match first
          const exactIdx = doc.indexOf(query);
          if (exactIdx !== -1) {
            view.dispatch({
              selection: { anchor: exactIdx, head: exactIdx + query.length },
              scrollIntoView: true,
            });
            view.focus();
            return;
          }

          // Whitespace-normalized matching with nearest-match selection.
          const { normalized: docNormalized, map: normMap } = normalizeWithMap(doc);
          const searchNormalized = query;
          const fullMatches: number[] = [];
          let searchIdx = docNormalized.indexOf(searchNormalized);
          while (searchIdx !== -1) {
            fullMatches.push(searchIdx);
            searchIdx = docNormalized.indexOf(searchNormalized, searchIdx + 1);
          }

          if (fullMatches.length > 0) {
            let bestFrom = 0;
            let bestTo = 0;
            let bestScore = Number.POSITIVE_INFINITY;

            for (const match of fullMatches) {
              const { from, to } = normalizedRangeToOriginal(
                normMap,
                match,
                match + searchNormalized.length,
                doc.length
              );
              const score = Math.abs(from - cursorPos);
              if (score < bestScore) {
                bestScore = score;
                bestFrom = from;
                bestTo = to;
              }
            }

            view.dispatch({
              selection: { anchor: bestFrom, head: bestTo },
              scrollIntoView: true,
            });
            view.focus();
            return;
          }

          // Last resort: try matching just the first few words
          const words = searchNormalized.split(" ").filter(Boolean);
          if (words.length >= 2) {
            const partial = words.slice(0, Math.min(4, words.length)).join(" ");
            const partialIdx = docNormalized.indexOf(partial);
            if (partialIdx !== -1 && partialIdx < normMap.length) {
              const from = normMap[partialIdx];
              view.dispatch({
                selection: { anchor: from, head: from },
                scrollIntoView: true,
              });
              view.focus();
            }
          }
        },
        scrollToLine: (line: number) => {
          const view = viewRef.current;
          const EV = editorViewClassRef.current;
          if (!view || !EV) return;
          const clampedLine = Math.min(Math.max(line, 1), view.state.doc.lines);
          const lineInfo = view.state.doc.line(clampedLine);
          view.dispatch({
            effects: EV.scrollIntoView(lineInfo.from, { y: "center" }),
          });
        },
        getScrollPosition: () => {
          const view = viewRef.current;
          if (!view) return 0;
          return view.scrollDOM.scrollTop;
        },
        setScrollPosition: (pos: number) => {
          const view = viewRef.current;
          if (!view) return;
          view.scrollDOM.scrollTop = pos;
        },
        getSelection: () => {
          const view = viewRef.current;
          if (!view) return null;
          const sel = view.state.selection.main;
          return { anchor: sel.anchor, head: sel.head };
        },
        setSelection: (selection: CodeSelection) => {
          const view = viewRef.current;
          if (!view) return;
          const maxPos = view.state.doc.length;
          view.dispatch({
            selection: {
              anchor: Math.min(Math.max(selection.anchor, 0), maxPos),
              head: Math.min(Math.max(selection.head, 0), maxPos),
            },
            scrollIntoView: true,
          });
        },
      }),
      []
    );

    // Store EditorView class for scrollIntoView
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorViewClassRef = useRef<any>(null);

    // ─── Remote cursor state & effects (CodeMirror StateField + StateEffect) ───

    // Store CodeMirror StateEffect/StateField refs for remote cursors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remoteCursorEffectRef = useRef<any>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remoteCursorFieldRef = useRef<any>(null);

    // Error line decorations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorEffectRef = useRef<any>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorFieldRef = useRef<any>(null);

    // Initialize CodeMirror
    useEffect(() => {
      if (!containerRef.current) return;

      let view: import("@codemirror/view").EditorView | null = null;

      async function initEditor() {
        const { EditorState, StateEffect, StateField } = await import("@codemirror/state");
        const {
          EditorView,
          lineNumbers,
          highlightActiveLine,
          keymap,
          highlightSpecialChars,
          Decoration,
          ViewPlugin,
          WidgetType,
          MatchDecorator,
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
        const { RangeSetBuilder } = await import("@codemirror/state");

        if (!containerRef.current) return;

        editorViewClassRef.current = EditorView;

        // ─── Remote cursor infrastructure ───────────────
        type CursorMap = Map<string, RemoteCursorData>;

        class CursorLabelWidget extends WidgetType {
          constructor(readonly name: string, readonly color: string) {
            super();
          }
          toDOM() {
            const el = document.createElement("span");
            el.className = "cm-remote-cursor-label";
            el.textContent = this.name;
            el.style.cssText = `
              background: ${this.color};
              color: #fff;
              font-size: 10px;
              font-weight: 600;
              line-height: 1;
              padding: 1px 4px;
              border-radius: 3px 3px 3px 0;
              position: absolute;
              top: -18px;
              left: -1px;
              white-space: nowrap;
              pointer-events: none;
              z-index: 10;
              font-family: var(--font-sans, sans-serif);
              box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            `;
            const wrapper = document.createElement("span");
            wrapper.style.cssText = "position: relative; display: inline; width: 0; overflow: visible;";
            wrapper.appendChild(el);
            return wrapper;
          }
          eq(other: CursorLabelWidget) {
            return this.name === other.name && this.color === other.color;
          }
          ignoreEvent() {
            return true;
          }
        }

        const setCursorsEffect = StateEffect.define<CursorMap>();
        remoteCursorEffectRef.current = setCursorsEffect;

        const remoteCursorField = StateField.define<CursorMap>({
          create() {
            return new Map();
          },
          update(value, tr) {
            for (const e of tr.effects) {
              if (e.is(setCursorsEffect)) {
                return e.value;
              }
            }
            return value;
          },
        });
        remoteCursorFieldRef.current = remoteCursorField;

        // Plugin that reads the StateField and produces decorations
        const remoteCursorPlugin = ViewPlugin.fromClass(
          class {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            decorations: any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            constructor(view: any) {
              this.decorations = this.buildDecorations(view);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update(update: any) {
              if (
                update.docChanged ||
                update.transactions.some((t: { effects: readonly { is: (e: unknown) => boolean }[] }) =>
                  t.effects.some((e: { is: (e: unknown) => boolean }) => e.is(setCursorsEffect))
                )
              ) {
                this.decorations = this.buildDecorations(update.view);
              }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            buildDecorations(view: any) {
              const cursors: CursorMap = view.state.field(remoteCursorField);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const builder = new RangeSetBuilder<any>();

              if (cursors.size === 0) return Decoration.none;

              const docLength = view.state.doc.length;

              // Collect all decorations and sort by position
              const decos: { from: number; to: number; deco: ReturnType<typeof Decoration.widget | typeof Decoration.mark> }[] = [];

              cursors.forEach(({ color, name, selection }) => {
                // Convert line/ch to absolute positions
                const anchorLine = view.state.doc.line(
                  Math.min(Math.max(selection.anchor.line, 1), view.state.doc.lines)
                );
                const anchorPos = Math.min(anchorLine.from + selection.anchor.ch, anchorLine.to);

                const headLine = view.state.doc.line(
                  Math.min(Math.max(selection.head.line, 1), view.state.doc.lines)
                );
                const headPos = Math.min(headLine.from + selection.head.ch, headLine.to);

                // Selection highlight if anchor !== head
                if (anchorPos !== headPos) {
                  const from = Math.min(anchorPos, headPos);
                  const to = Math.max(anchorPos, headPos);
                  const clampedFrom = Math.min(Math.max(from, 0), docLength);
                  const clampedTo = Math.min(Math.max(to, 0), docLength);
                  if (clampedFrom < clampedTo) {
                    decos.push({
                      from: clampedFrom,
                      to: clampedTo,
                      deco: Decoration.mark({
                        attributes: {
                          style: `background-color: ${color}33;`,
                        },
                      }),
                    });
                  }
                }

                // Draw a lightweight caret marker without injecting widgets into text flow.
                if (docLength > 0) {
                  const clampedHead = Math.min(Math.max(headPos, 0), docLength);
                  const caretFrom = Math.min(Math.max(clampedHead - 1, 0), docLength - 1);
                  const caretTo = Math.min(caretFrom + 1, docLength);
                  if (caretFrom < caretTo) {
                    const caretStyle =
                      clampedHead === 0
                        ? `box-shadow: inset 2px 0 0 ${color};`
                        : `box-shadow: inset -2px 0 0 ${color};`;
                    decos.push({
                      from: caretFrom,
                      to: caretTo,
                      deco: Decoration.mark({
                        attributes: {
                          class: "cm-remote-caret",
                          "data-remote-user": name,
                          style: caretStyle,
                        },
                      }),
                    });

                    // Name label widget above the caret
                    decos.push({
                      from: caretTo,
                      to: caretTo,
                      deco: Decoration.widget({
                        widget: new CursorLabelWidget(name, color),
                        side: 1,
                      }),
                    });
                  }
                }
              });

              // Sort by from position (required by RangeSetBuilder)
              decos.sort((a, b) => a.from - b.from || a.to - b.to);

              for (const { from, to, deco } of decos) {
                builder.add(from, to, deco);
              }

              return builder.finish();
            }
          },
          {
            decorations: (v) => v.decorations,
          }
        );

        // ─── Error line decorations (zigzag underlines) ────
        const setErrorsEffect = StateEffect.define<BuildError[]>();
        errorEffectRef.current = setErrorsEffect;

        const errorMarkDeco = Decoration.mark({ class: "cm-error-underline" });

        const errorField = StateField.define({
          create() {
            return Decoration.none;
          },
          update(value, tr) {
            for (const e of tr.effects) {
              if (e.is(setErrorsEffect)) {
                const errors: BuildError[] = e.value;
                if (errors.length === 0) return Decoration.none;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const decos: any[] = [];
                const docLines = tr.state.doc.lines;
                const seenLines = new Set<number>();
                for (const err of errors) {
                  if (err.line >= 1 && err.line <= docLines && !seenLines.has(err.line)) {
                    seenLines.add(err.line);
                    const lineInfo = tr.state.doc.line(err.line);
                    const from = lineInfo.from;
                    const to = Math.max(lineInfo.from, lineInfo.to);
                    decos.push(errorMarkDeco.range(from, to));
                  }
                }
                decos.sort((a: { from: number }, b: { from: number }) => a.from - b.from);
                return Decoration.set(decos);
              }
            }
            if (tr.docChanged) {
              return value.map(tr.changes);
            }
            return value;
          },
          provide: (f) => EditorView.decorations.from(f),
        });
        errorFieldRef.current = errorField;

        // ─── Clickable URL links (Ctrl/Cmd + click) ─────────
        const urlRe = /https?:\/\/[^\s)}\]>"'`]+/g;
        const urlDeco = Decoration.mark({
          class: "cm-url-link",
        });
        const urlMatcher = new MatchDecorator({
          regexp: urlRe,
          decoration: () => urlDeco,
        });
        const urlPlugin = ViewPlugin.fromClass(
          class {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            decorations: any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            constructor(view: any) {
              this.decorations = urlMatcher.createDeco(view);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update(update: any) {
              this.decorations = urlMatcher.updateDeco(update, this.decorations);
            }
          },
          {
            decorations: (v) => v.decorations,
            eventHandlers: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              click(event: MouseEvent, view: any) {
                // Require Ctrl (Windows/Linux) or Cmd (Mac)
                if (!(event.ctrlKey || event.metaKey)) return false;
                if (event.button !== 0) return false;
                const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (pos === null) return false;
                const line = view.state.doc.lineAt(pos);
                const lineText = line.text;
                const localUrlRe = /https?:\/\/[^\s)}\]>"'`]+/g;
                let m;
                while ((m = localUrlRe.exec(lineText)) !== null) {
                  const from = line.from + m.index;
                  const to = from + m[0].length;
                  if (pos >= from && pos <= to) {
                    window.open(m[0], "_blank", "noopener,noreferrer");
                    event.preventDefault();
                    return true;
                  }
                }
                return false;
              },
            },
          }
        );

        // Read-only mode: disable editing but keep navigation/search
        const readOnlyExtensions = readOnly
          ? [EditorView.editable.of(false), EditorState.readOnly.of(true)]
          : [];

        const state = EditorState.create({
          doc: contentRef.current,
          extensions: [
            ...readOnlyExtensions,
            lineNumbers(),
            highlightActiveLine(),
            highlightSpecialChars(),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            history(),
            search(),
            StreamLanguage.define(stex),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            EditorView.lineWrapping,
            keymap.of([
              ...defaultKeymap,
              ...searchKeymap,
              ...historyKeymap,
              ...closeBracketsKeymap,
              indentWithTab,
            ]),
            remoteCursorField,
            remoteCursorPlugin,
            errorField,
            urlPlugin,
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !isExternalUpdate.current) {
                const value = update.state.doc.toString();
                onChangeRef.current(value);

                // Extract granular changes for collaboration
                if (onDocChangeRef.current) {
                  const changes: DocChange[] = [];
                  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                    changes.push({
                      from: fromA,
                      to: toA,
                      insert: inserted.toString(),
                    });
                  });
                  if (changes.length > 0) {
                    onDocChangeRef.current(changes);
                  }
                }
              }

              // Emit cursor changes
              if (update.selectionSet && !isExternalUpdate.current && onCursorChangeRef.current) {
                if (cursorEmitRafRef.current !== null) {
                  cancelAnimationFrame(cursorEmitRafRef.current);
                }
                cursorEmitRafRef.current = requestAnimationFrame(() => {
                  cursorEmitRafRef.current = null;
                  const sel = update.state.selection.main;
                  const anchorLine = update.state.doc.lineAt(sel.anchor);
                  const headLine = update.state.doc.lineAt(sel.head);
                  const payload: CursorSelection = {
                    anchor: { line: anchorLine.number, ch: sel.anchor - anchorLine.from },
                    head: { line: headLine.number, ch: sel.head - headLine.from },
                  };
                  const nextKey = `${payload.anchor.line}:${payload.anchor.ch}-${payload.head.line}:${payload.head.ch}`;
                  if (nextKey === lastCursorEmitKeyRef.current) return;
                  lastCursorEmitKeyRef.current = nextKey;
                  onCursorChangeRef.current?.(payload);
                });
              }
            }),
          ],
        });

        view = new EditorView({
          state,
          parent: containerRef.current!,
        });

        viewRef.current = view;

        // If content changed during async init, sync the editor to the latest value
        const latestContent = contentRef.current;
        if (view.state.doc.toString() !== latestContent) {
          isExternalUpdate.current = true;
          const prevSel = view.state.selection.main;
          const prevScrollTop = view.scrollDOM.scrollTop;
          const nextMax = latestContent.length;
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: latestContent,
            },
            selection: {
              anchor: Math.min(prevSel.anchor, nextMax),
              head: Math.min(prevSel.head, nextMax),
            },
          });
          requestAnimationFrame(() => {
            if (view) {
              view.scrollDOM.scrollTop = prevScrollTop;
            }
          });
          isExternalUpdate.current = false;
        }
      }

      initEditor();

      return () => {
        if (cursorEmitRafRef.current !== null) {
          cancelAnimationFrame(cursorEmitRafRef.current);
          cursorEmitRafRef.current = null;
        }
        if (viewRef.current) {
          viewRef.current.destroy();
          viewRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update content from outside without losing cursor position
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;

      const currentContent = view.state.doc.toString();
      if (currentContent !== content) {
        isExternalUpdate.current = true;
        const prevSel = view.state.selection.main;
        const prevScrollTop = view.scrollDOM.scrollTop;
        const nextMax = content.length;
        view.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content,
          },
          selection: {
            anchor: Math.min(prevSel.anchor, nextMax),
            head: Math.min(prevSel.head, nextMax),
          },
        });
        requestAnimationFrame(() => {
          view.scrollDOM.scrollTop = prevScrollTop;
        });
        isExternalUpdate.current = false;
      }
    }, [content]);

    // Apply remote changes (granular, from other users)
    useEffect(() => {
      if (!remoteChanges || !viewRef.current) return;

      const view = viewRef.current;
      const changes = remoteChanges.changes;
      if (!changes || changes.length === 0) return;

      isExternalUpdate.current = true;
      try {
        view.dispatch({
          changes: changes.map((c) => ({
            from: Math.min(c.from, view.state.doc.length),
            to: Math.min(c.to, view.state.doc.length),
            insert: c.insert,
          })),
        });
      } catch {
        // If granular apply fails, we'll rely on the full content sync
      }
      isExternalUpdate.current = false;
    }, [remoteChanges]);

    // Update remote cursor decorations
    useEffect(() => {
      const view = viewRef.current;
      const effect = remoteCursorEffectRef.current;
      if (!view || !effect || !remoteCursors) return;

      view.dispatch({
        effects: effect.of(remoteCursors),
      });
    }, [remoteCursors]);

    // Update error line decorations
    useEffect(() => {
      const view = viewRef.current;
      const effect = errorEffectRef.current;
      if (!view || !effect) return;

      view.dispatch({
        effects: effect.of(errors ?? []),
      });
    }, [errors]);

    return (
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden bg-editor-bg"
      />
    );
  }
);
