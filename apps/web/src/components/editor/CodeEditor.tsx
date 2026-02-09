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

interface CodeEditorProps {
  content: string;
  onChange: (value: string) => void;
  language?: string;
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
}

// ─── CodeEditor ─────────────────────────────────────

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      content,
      onChange,
      language = "latex",
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
          if (!view || !text || text.length < 3) return;

          const doc = view.state.doc.toString();

          // Try exact match first
          const exactIdx = doc.indexOf(text);
          if (exactIdx !== -1) {
            view.dispatch({
              selection: { anchor: exactIdx, head: exactIdx + text.length },
              scrollIntoView: true,
            });
            view.focus();
            return;
          }

          // Whitespace-normalized matching: build a map from normalized
          // positions back to original doc positions so we can select the
          // correct range even when PDF whitespace differs from source.
          const normChars: number[] = []; // normChars[i] = original index of normalized char i
          let inWhitespace = false;
          for (let i = 0; i < doc.length; i++) {
            if (/\s/.test(doc[i])) {
              if (!inWhitespace) {
                normChars.push(i); // single space representative
                inWhitespace = true;
              }
            } else {
              normChars.push(i);
              inWhitespace = false;
            }
          }

          const docNormalized = doc.replace(/\s+/g, " ");
          const searchNormalized = text.replace(/\s+/g, " ").trim();
          const normIdx = docNormalized.indexOf(searchNormalized);

          if (normIdx !== -1 && normIdx < normChars.length) {
            const from = normChars[normIdx];
            const normEnd = normIdx + searchNormalized.length - 1;
            // Map the last normalized char back, then include up to the next
            // original char to capture trailing content
            let to: number;
            if (normEnd < normChars.length) {
              to = normChars[normEnd] + 1;
            } else {
              to = doc.length;
            }

            view.dispatch({
              selection: { anchor: from, head: to },
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
            if (partialIdx !== -1 && partialIdx < normChars.length) {
              const from = normChars[partialIdx];
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
          WidgetType,
          ViewPlugin,
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

        // Widget for remote cursor line
        class RemoteCursorWidget extends WidgetType {
          constructor(
            readonly color: string,
            readonly name: string
          ) {
            super();
          }

          toDOM() {
            const wrapper = document.createElement("span");
            wrapper.style.position = "relative";
            wrapper.style.display = "inline";
            wrapper.style.width = "0";
            wrapper.style.overflow = "visible";

            const cursor = document.createElement("span");
            cursor.style.borderLeft = `2px solid ${this.color}`;
            cursor.style.height = "1.2em";
            cursor.style.position = "absolute";
            cursor.style.top = "0";
            cursor.style.left = "0";
            cursor.style.pointerEvents = "none";
            cursor.style.zIndex = "10";

            const label = document.createElement("span");
            label.textContent = this.name;
            label.style.position = "absolute";
            label.style.bottom = "100%";
            label.style.left = "0";
            label.style.backgroundColor = this.color;
            label.style.color = "#fff";
            label.style.fontSize = "10px";
            label.style.padding = "1px 4px";
            label.style.borderRadius = "2px";
            label.style.whiteSpace = "nowrap";
            label.style.pointerEvents = "none";
            label.style.zIndex = "11";
            label.style.lineHeight = "1.2";

            wrapper.appendChild(cursor);
            wrapper.appendChild(label);
            return wrapper;
          }

          eq(other: RemoteCursorWidget) {
            return this.color === other.color && this.name === other.name;
          }
        }

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

                // Cursor widget at the head position
                const clampedHead = Math.min(Math.max(headPos, 0), docLength);
                decos.push({
                  from: clampedHead,
                  to: clampedHead,
                  deco: Decoration.widget({
                    widget: new RemoteCursorWidget(color, name),
                    side: 1,
                  }),
                });

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

        const errorLineDeco = Decoration.line({ class: "cm-error-line" });

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
                for (const err of errors) {
                  if (err.line >= 1 && err.line <= docLines) {
                    const lineInfo = tr.state.doc.line(err.line);
                    decos.push(errorLineDeco.range(lineInfo.from));
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

        // ─── Clickable URL links ───────────────────────────
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
              mousedown(event: MouseEvent, view: any) {
                if (!event.ctrlKey && !event.metaKey) return false;
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
                    window.open(m[0], "_blank", "noopener");
                    event.preventDefault();
                    return true;
                  }
                }
                return false;
              },
            },
          }
        );

        const state = EditorState.create({
          doc: contentRef.current,
          extensions: [
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
                const sel = update.state.selection.main;
                const anchorLine = update.state.doc.lineAt(sel.anchor);
                const headLine = update.state.doc.lineAt(sel.head);
                onCursorChangeRef.current({
                  anchor: { line: anchorLine.number, ch: sel.anchor - anchorLine.from },
                  head: { line: headLine.number, ch: sel.head - headLine.from },
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
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: latestContent,
            },
          });
          isExternalUpdate.current = false;
        }
      }

      initEditor();

      return () => {
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
        className="h-full w-full overflow-auto bg-editor-bg"
      />
    );
  }
);
