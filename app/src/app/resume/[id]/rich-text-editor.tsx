"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { mergeAttributes, Node, type Editor } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Text from "@tiptap/extension-text";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { UndoRedo } from "@tiptap/extensions";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  EditorContent,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
  type NodeViewProps,
} from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold as BoldIcon,
  Database,
  Eye,
  EyeOff,
  Italic as ItalicIcon,
  Link2,
  List,
  Loader2,
  Underline as UnderlineIcon,
  Vault,
  X,
} from "lucide-react";

import { sanitizeInlineHtml, splitPastedLines, textToHtml } from "@/lib/rich-text";
import type { ResolvedBullet } from "@/lib/resume-model";
import { cn } from "@/lib/utils";

import { lineKeyFor, type DraftLine } from "./draft";

/**
 * The entry description: a rich-text box whose every line is one bullet row.
 *
 * Why lines rather than a free document: each bullet is its own row in
 * `resume_bullets`, carrying its vault link, its strength score, and its own
 * visibility. A single HTML blob would lose all three. So the document schema
 * is just `line+` — no nesting, no headings — and each line node carries the
 * row it maps to (`bulletId`) and a client-side `key` that identifies it until
 * the row exists.
 *
 * Every change is reported straight away (the preview repaints on the same
 * frame); the draft decides when to save. Inline formatting is limited to
 * bold, italic, underline and links — the same allowlist the renderer
 * accepts.
 */

/* ------------------------------------------------------------------ */
/* Line node                                                           */
/* ------------------------------------------------------------------ */

function newKey(): string {
  return `k${Math.random().toString(36).slice(2, 10)}`;
}

/** Per-editor callbacks the line node views need. */
type LineActions = {
  /** Save one line to the vault, by its key (and row id, when it has one). */
  saveToVault: (key: string, bulletId: number | null) => Promise<void>;
  /** Open the vault picker under this line; a pick fills or replaces it. */
  openPicker: (key: string, lineEl: HTMLElement) => void;
  /** The line whose picker is open, if any. */
  pickerKey: string | null;
  placeholder: string;
};
const LineActionsContext = createContext<LineActions>({
  saveToVault: async () => {},
  openPicker: () => {},
  pickerKey: null,
  placeholder: "",
});

function LineView({ node, updateAttributes, editor }: NodeViewProps) {
  const actions = useContext(LineActionsContext);
  const [saving, setSaving] = useState(false);
  const text = node.textContent;
  const isBullet = node.attrs.kind !== "paragraph";
  const hidden = Boolean(node.attrs.hidden);
  const bulletId = node.attrs.bulletId as number | null;
  const key = node.attrs.key as string;
  const empty = !text.trim();
  const inVault = Boolean(node.attrs.sourceBulletId);
  const canSave = !inVault && Boolean(text.trim());

  const pull = (e: React.MouseEvent<HTMLElement>) => {
    const lineEl = e.currentTarget.closest<HTMLElement>("[data-node-view-wrapper]");
    if (lineEl) actions.openPicker(key, lineEl);
  };

  return (
    <NodeViewWrapper
      className={cn(
        "relative flex items-start gap-1.5 rounded-lg py-0.5 pr-1",
        hidden && "opacity-45",
        actions.pickerKey === key && "bg-violetSoft/60",
      )}
      data-line-hidden={hidden || undefined}
    >
      <span contentEditable={false} className="mt-[1px] w-3 shrink-0 select-none text-center text-ink/70">
        {isBullet ? "•" : ""}
      </span>
      {/* The text column. The placeholder is positioned inside it — not
          across the whole line — so it wraps beside the controls instead of
          running underneath them. */}
      <div className="relative min-w-0 flex-1">
        <NodeViewContent
          as="div"
          className={cn("text-sm leading-relaxed outline-none", hidden && "line-through")}
          // TextAlign stores the value on the node; a React node view has to
          // apply it itself, or the editor would show left while the preview
          // shows centred.
          style={node.attrs.textAlign ? { textAlign: node.attrs.textAlign } : undefined}
        />
        {/* Drawn here rather than by Tiptap's placeholder decoration, which
            can't reach text inside a React node view. */}
        {editor.isEmpty && (
          <span
            contentEditable={false}
            className="pointer-events-none absolute inset-x-0 top-0 select-none text-sm leading-relaxed text-muted/70"
          >
            {actions.placeholder}
          </span>
        )}
      </div>

      {empty ? (
        // A new, empty line offers the vault outright; once there's text the
        // offer shrinks to the small button beside the eye. No eye here —
        // there's nothing on an empty line to hide.
        <button
          type="button"
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={pull}
          className="flex shrink-0 animate-fade-in items-center gap-1 self-start whitespace-nowrap rounded-full bg-violetSoft px-2 py-0.5 text-[11px] font-medium text-violet transition-colors hover:bg-violet/15"
          aria-label="Pull a bullet from your vault into this line"
        >
          <Vault size={11} /> Pull from vault
        </button>
      ) : (
      /* Always shown on every typed line — no hover to discover them. The
         vault badge makes it clear at a glance which lines are kept in the
         master record and which live only on this resume. */
      <span contentEditable={false} className="mt-1 flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="rounded p-0.5 text-muted hover:bg-violetSoft hover:text-violet"
          title="Replace this line with a bullet from your vault"
          aria-label="Replace this line with a bullet from your vault"
          onMouseDown={(e) => e.preventDefault()}
          onClick={pull}
        >
          <Vault size={12} />
        </button>
        {inVault ? (
          <span className="rounded bg-violetSoft p-0.5 text-violet" title="Saved in your vault" aria-label="Saved in your vault">
            <Database size={12} />
          </span>
        ) : (
          canSave && (
            <button
              type="button"
              className="rounded p-0.5 text-muted hover:bg-violetSoft hover:text-violet"
              title="Save this line to your vault"
              aria-label="Save this line to your vault"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                await actions.saveToVault(node.attrs.key as string, bulletId);
                setSaving(false);
              }}
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
            </button>
          )
        )}
        <button
          type="button"
          className="rounded p-0.5 text-muted hover:bg-canvas hover:text-ink"
          title={hidden ? "Show on resume" : "Hide from resume"}
          aria-label={hidden ? "Show this line on the resume" : "Hide this line from the resume"}
          onClick={() => updateAttributes({ hidden: !hidden })}
        >
          {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </span>
      )}
    </NodeViewWrapper>
  );
}

const LINE_KEY = new PluginKey("line-keys");

const Line = Node.create({
  name: "line",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    // Identity attributes don't survive a split: Enter makes a new line with
    // no row yet. `kind` does, so Enter on a bullet starts another bullet.
    return {
      key: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute("data-key"),
        renderHTML: (a) => (a.key ? { "data-key": a.key } : {}),
      },
      bulletId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => {
          const v = Number(el.getAttribute("data-bullet-id"));
          return Number.isFinite(v) && v > 0 ? v : null;
        },
        renderHTML: (a) => (a.bulletId ? { "data-bullet-id": a.bulletId } : {}),
      },
      sourceBulletId: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el) => {
          const v = Number(el.getAttribute("data-source"));
          return Number.isFinite(v) && v > 0 ? v : null;
        },
        renderHTML: (a) => (a.sourceBulletId ? { "data-source": a.sourceBulletId } : {}),
      },
      hidden: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el) => el.getAttribute("data-hidden") === "true",
        renderHTML: (a) => (a.hidden ? { "data-hidden": "true" } : {}),
      },
      kind: {
        default: "bullet",
        keepOnSplit: true,
        parseHTML: (el) =>
          el.getAttribute("data-kind") ?? (el.tagName === "P" ? "paragraph" : "bullet"),
        renderHTML: (a) => ({ "data-kind": a.kind }),
      },
    };
  },

  parseHTML() {
    // Our own lines, plus pasted paragraphs and list items — anything else
    // pasted is unwrapped to its text by the schema.
    return [{ tag: "div[data-line]" }, { tag: "li" }, { tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-line": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LineView);
  },

  addKeyboardShortcuts() {
    // Ctrl+Shift+8: bullet ↔ paragraph for the selected lines.
    return { "Mod-Shift-8": () => toggleBullet(this.editor) };
  },

  addProseMirrorPlugins() {
    // Every line gets a unique key, and a duplicated key (copy-paste of a
    // whole line) is reissued along with a cleared row id, so two lines can
    // never claim the same bullet.
    return [
      new Plugin({
        key: LINE_KEY,
        appendTransaction: (_trs, _old, state) => {
          const seen = new Set<string>();
          const seenIds = new Set<number>();
          let tr = state.tr;
          let changed = false;
          state.doc.forEach((node, offset) => {
            if (node.type.name !== "line") return;
            const key = node.attrs.key as string | null;
            const id = node.attrs.bulletId as number | null;
            const dupKey = !key || seen.has(key);
            const dupId = id !== null && seenIds.has(id);
            if (dupKey || dupId) {
              tr = tr.setNodeMarkup(offset, undefined, {
                ...node.attrs,
                key: dupKey ? newKey() : key,
                bulletId: dupId ? null : id,
                sourceBulletId: dupId ? null : node.attrs.sourceBulletId,
              });
              changed = true;
            }
            seen.add(dupKey ? "" : key!);
            if (id !== null && !dupId) seenIds.add(id);
          });
          return changed ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});

function toggleBullet(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  const lines: Array<{ pos: number; kind: string }> = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "line") lines.push({ pos, kind: node.attrs.kind });
    return false;
  });
  if (lines.length === 0) return false;
  // If any selected line is a paragraph, make them all bullets; else all paragraphs.
  const next = lines.some((l) => l.kind === "paragraph") ? "bullet" : "paragraph";
  const tr = editor.state.tr;
  for (const l of lines) {
    const node = tr.doc.nodeAt(l.pos);
    if (node) tr.setNodeMarkup(l.pos, undefined, { ...node.attrs, kind: next });
  }
  editor.view.dispatch(tr);
  return true;
}

/* ------------------------------------------------------------------ */
/* Bullets ↔ document                                                  */
/* ------------------------------------------------------------------ */

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function bulletsToHtml(bullets: ResolvedBullet[]): string {
  if (bullets.length === 0) return `<div data-line data-kind="bullet"></div>`;
  return bullets
    .map((b) => {
      const attrs = [
        `data-line`,
        `data-key="${escapeAttr(lineKeyFor(b.id))}"`,
        b.id > 0 ? `data-bullet-id="${b.id}"` : "",
        b.sourceBulletId ? `data-source="${b.sourceBulletId}"` : "",
        !b.isVisible ? `data-hidden="true"` : "",
        `data-kind="${b.isParagraph ? "paragraph" : "bullet"}"`,
        b.align !== "left" ? `style="text-align: ${escapeAttr(b.align)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const body = b.html ? sanitizeInlineHtml(b.html) : textToHtml(b.text);
      return `<div ${attrs}>${body}</div>`;
    })
    .join("");
}

function docToLines(editor: Editor): DraftLine[] {
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const lines: DraftLine[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name !== "line") return;
    const box = document.createElement("div");
    box.appendChild(serializer.serializeFragment(node.content));
    const align = node.attrs.textAlign as string | null;
    lines.push({
      key: (node.attrs.key as string | null) ?? newKey(),
      id: (node.attrs.bulletId as number | null) ?? null,
      html: sanitizeInlineHtml(box.innerHTML),
      align: align === "center" || align === "right" || align === "justify" ? align : "left",
      isParagraph: node.attrs.kind === "paragraph",
      isVisible: !node.attrs.hidden,
    });
  });
  return lines;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export type RichTextHandle = {
  /** Append a line for a bullet that already exists server-side (vault pull). */
  appendBullet: (bullet: { id: number; text: string; sourceBulletId: number | null }) => void;
  /** After "Save entry to vault": every line with text is in the vault now. */
  markAllInVault: () => void;
};

export function RichTextEditor({
  bullets,
  onChange,
  onIds,
  saveToVault,
  pullFromVault,
  renderVaultPicker,
  handleRef,
  placeholder = "Start with a verb, include a number…",
  labelledBy,
}: {
  /** The bullets when the editor opened. Later changes flow out, not in. */
  bullets: ResolvedBullet[];
  onChange: (lines: DraftLine[], knownIds: number[]) => void;
  /** Called by the parent after a save, to stamp new lines with their row ids. */
  onIds?: (register: (ids: Record<string, number>) => void) => void;
  /**
   * Save one line to the vault. Resolves to the vault bullet id, or null if it
   * didn't save. The line may not have a row yet — the parent resolves the
   * key once pending saves have landed.
   */
  saveToVault: (key: string, bulletId: number | null) => Promise<number | null>;
  /**
   * Attach a vault bullet to this entry. Resolves to the new resume bullet row
   * — the editor puts it in place of the line the picker was opened from.
   */
  pullFromVault: (vaultBulletId: number) => Promise<{ id: number; text: string; sourceBulletId: number } | null>;
  /** The list to show in the inline picker (search, this entry's bullets first). */
  renderVaultPicker: (props: { onPick: (vaultBulletId: number) => Promise<void>; onClose: () => void }) => React.ReactNode;
  handleRef?: React.MutableRefObject<RichTextHandle | null>;
  placeholder?: string;
  labelledBy?: string;
}) {
  const knownIds = useRef(new Set(bullets.filter((b) => b.id > 0).map((b) => b.id)));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [linkOpen, setLinkOpen] = useState(false);

  // The document is seeded once; after that the editor owns it.
  const [initial] = useState(() => bulletsToHtml(bullets));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      Document.extend({ content: "line+" }),
      Text,
      Line,
      Bold,
      Italic,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ["mailto"],
        HTMLAttributes: { rel: "noreferrer", target: "_blank" },
      }),
      TextAlign.configure({ types: ["line"], alignments: ["left", "center", "right", "justify"] }),
      UndoRedo,
    ],
    content: initial,
    editorProps: {
      attributes: {
        class: "outline-none min-h-[7rem] px-1 py-2",
        role: "textbox",
        "aria-multiline": "true",
        ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
      },
      // Plain-text paste: lines marked -, *, • become bullets, other lines
      // paragraphs. HTML paste falls through to the schema, which keeps only
      // lines and the four marks.
      handlePaste: (view, event) => {
        const html = event.clipboardData?.getData("text/html");
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (html || !text.includes("\n")) return false;
        const lines = splitPastedLines(text);
        if (lines.length === 0) return false;
        const content = lines
          .map((l) => `<div data-line data-kind="${l.isBullet ? "bullet" : "paragraph"}">${textToHtml(l.text)}</div>`)
          .join("");
        editorRef.current?.chain().focus().insertContent(content).run();
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(docToLines(editor), [...knownIds.current]);
    },
  });

  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  // Ctrl+K opens the link box.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLinkOpen(true);
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor]);

  // Stamp row ids onto lines once the server has created them.
  const stamp = useCallback(
    (ids: Record<string, number>) => {
      if (!editor || editor.isDestroyed) return;
      const tr = editor.state.tr;
      let changed = false;
      editor.state.doc.forEach((node, offset) => {
        const id = ids[node.attrs.key as string];
        if (id && node.attrs.bulletId !== id) {
          tr.setNodeMarkup(offset, undefined, { ...node.attrs, bulletId: id });
          changed = true;
        }
        if (id) knownIds.current.add(id);
      });
      if (changed) editor.view.dispatch(tr.setMeta("addToHistory", false));
    },
    [editor],
  );

  useEffect(() => {
    onIds?.(stamp);
  }, [onIds, stamp]);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      appendBullet: (b) => {
        if (!editor) return;
        knownIds.current.add(b.id);
        const end = editor.state.doc.content.size;
        // Replace a lone empty line rather than leaving it above the pulled one.
        const only = editor.state.doc.childCount === 1 && editor.state.doc.firstChild?.textContent === "";
        const html = `<div data-line data-key="b${b.id}" data-bullet-id="${b.id}"${
          b.sourceBulletId ? ` data-source="${b.sourceBulletId}"` : ""
        } data-kind="bullet">${textToHtml(b.text)}</div>`;
        editor
          .chain()
          .insertContentAt(only ? { from: 0, to: end } : end, html)
          .run();
      },
      markAllInVault: () => {
        if (!editor || editor.isDestroyed) return;
        const tr = editor.state.tr;
        editor.state.doc.forEach((node, offset) => {
          if (node.textContent.trim() && !node.attrs.sourceBulletId) {
            // The exact vault ids arrive with the next load; any value says "saved".
            tr.setNodeMarkup(offset, undefined, { ...node.attrs, sourceBulletId: -1 });
          }
        });
        editor.view.dispatch(tr.setMeta("addToHistory", false));
      },
    };
  }, [editor, handleRef]);

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            link: e.isActive("link"),
            bullet: e.isActive("line", { kind: "bullet" }),
            align: (["left", "center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
          }
        : null,
  });


  // The inline vault picker: which line it belongs to, and where to draw it
  // (just under that line, inside the editor box).
  const boxRef = useRef<HTMLDivElement>(null);
  const [picker, setPicker] = useState<{ key: string; top: number } | null>(null);

  const openPicker = useCallback((key: string, lineEl: HTMLElement) => {
    const box = boxRef.current?.getBoundingClientRect();
    const line = lineEl.getBoundingClientRect();
    setPicker((cur) => (cur?.key === key ? null : { key, top: box ? line.bottom - box.top + 4 : 0 }));
  }, []);

  useEffect(() => {
    if (!picker) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as HTMLElement)) setPicker(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [picker]);

  /** Put a pulled vault bullet where the picker's line is: fill it if empty, else replace it. */
  const fillLine = useCallback(
    async (key: string, vaultBulletId: number) => {
      const row = await pullFromVault(vaultBulletId);
      if (!row || !editor || editor.isDestroyed) return;
      let at = -1;
      let attrs: Record<string, unknown> = {};
      editor.state.doc.forEach((node, offset) => {
        if (node.attrs.key === key) {
          at = offset;
          attrs = node.attrs;
        }
      });
      if (at < 0) return;
      const old = editor.state.doc.nodeAt(at)!;
      knownIds.current.add(row.id);
      const replacement = editor.schema.nodes.line!.create(
        {
          ...attrs,
          key: `b${row.id}`,
          bulletId: row.id,
          sourceBulletId: row.sourceBulletId,
          hidden: false,
        },
        row.text ? editor.schema.text(row.text) : undefined,
      );
      // The replaced line's own row (if it had one) drops out on the next
      // save, as any deleted line does; the vault keeps its copy.
      editor.view.dispatch(editor.state.tr.replaceWith(at, at + old.nodeSize, replacement));
      setPicker(null);
    },
    [editor, pullFromVault],
  );

  const lineActions = useMemo<LineActions>(
    () => ({
      placeholder,
      pickerKey: picker?.key ?? null,
      openPicker,
      saveToVault: async (key, bulletId) => {
        const vaultId = await saveToVault(key, bulletId);
        if (vaultId === null || !editor || editor.isDestroyed) return;
        // Mark the line as linked, so its status shows "in vault".
        const tr = editor.state.tr;
        editor.state.doc.forEach((node, offset) => {
          if (node.attrs.key === key) {
            tr.setNodeMarkup(offset, undefined, { ...node.attrs, sourceBulletId: vaultId });
          }
        });
        editor.view.dispatch(tr.setMeta("addToHistory", false));
      },
    }),
    [saveToVault, editor, placeholder, picker, openPicker],
  );

  if (!editor) {
    return <div className="min-h-[9.5rem] rounded-xl bg-field" aria-busy />;
  }

  return (
    <div
      ref={boxRef}
      className="relative rounded-xl border border-line bg-field transition-all focus-within:border-violet/60 focus-within:bg-surface focus-within:ring-4 focus-within:ring-violet/10"
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1" role="toolbar" aria-label="Formatting">
        <ToolButton label="Bold" shortcut="Ctrl+B" active={active?.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <BoldIcon size={14} />
        </ToolButton>
        <ToolButton label="Italic" shortcut="Ctrl+I" active={active?.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <ItalicIcon size={14} />
        </ToolButton>
        <ToolButton label="Underline" shortcut="Ctrl+U" active={active?.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={14} />
        </ToolButton>
        <Divider />
        <ToolButton label="Bulleted list" shortcut="Ctrl+Shift+8" active={active?.bullet} onClick={() => toggleBullet(editor)}>
          <List size={14} />
        </ToolButton>
        <ToolButton label="Insert link" shortcut="Ctrl+K" active={active?.link} onClick={() => setLinkOpen((o) => !o)}>
          <Link2 size={14} />
        </ToolButton>
        <Divider />
        {(
          [
            ["left", "Align left", "Ctrl+Shift+L", AlignLeft],
            ["center", "Align center", "Ctrl+Shift+E", AlignCenter],
            ["right", "Align right", "Ctrl+Shift+R", AlignRight],
            ["justify", "Justify", "Ctrl+Shift+J", AlignJustify],
          ] as const
        ).map(([value, label, shortcut, Icon]) => (
          <ToolButton
            key={value}
            label={label}
            shortcut={shortcut}
            active={active?.align === value}
            onClick={() => editor.chain().focus().setTextAlign(value).run()}
          >
            <Icon size={14} />
          </ToolButton>
        ))}
      </div>

      {linkOpen && <LinkBar editor={editor} onClose={() => setLinkOpen(false)} />}

      <LineActionsContext.Provider value={lineActions}>
        <EditorContent editor={editor} className="rich-lines px-2 pb-1" />
      </LineActionsContext.Provider>

      {picker && (
        <div
          className="absolute left-2 right-2 z-20 animate-pop-in rounded-xl border border-line bg-surface p-2 shadow-lift"
          style={{ top: picker.top }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setPicker(null);
              editor.commands.focus();
            }
          }}
        >
          <div className="mb-1.5 flex items-center justify-between px-1">
            <p className="text-xs font-medium text-violet">
              {(() => {
                let isEmpty = true;
                editor.state.doc.forEach((n) => {
                  if (n.attrs.key === picker.key) isEmpty = !n.textContent.trim();
                });
                return isEmpty ? "Pull a bullet into this line" : "Replace this line with a vault bullet";
              })()}
            </p>
            <button
              type="button"
              className="rounded p-0.5 text-muted hover:bg-canvas hover:text-ink"
              aria-label="Close"
              onClick={() => setPicker(null)}
            >
              <X size={13} />
            </button>
          </div>
          {renderVaultPicker({
            onPick: (vaultBulletId) => fillLine(picker.key, vaultBulletId),
            onClose: () => setPicker(null),
          })}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-line" aria-hidden />;
}

function ToolButton({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={Boolean(active)}
      title={`${label} (${shortcut})`}
      // Keep the selection in the editor when the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 transition-colors",
        active ? "bg-violet text-white" : "text-muted hover:bg-violetSoft hover:text-violet",
      )}
    >
      {children}
    </button>
  );
}

/** Inline URL box for Ctrl+K / the link button. Empty URL removes the link. */
function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [url, setUrl] = useState(() => (editor.getAttributes("link").href as string | undefined) ?? "");

  function apply() {
    const href = url.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else {
      const withScheme = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
      chain.setLink({ href: withScheme }).run();
    }
    onClose();
  }

  return (
    <div className="flex items-center gap-1.5 border-b border-line bg-violetSoft/50 px-2 py-1.5">
      <Link2 size={13} className="shrink-0 text-violet" />
      <input
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/70"
        placeholder="Paste a link, then Enter — empty removes it"
        aria-label="Link URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
            editor.commands.focus();
          }
        }}
      />
      <button type="button" className="rounded-md bg-violet px-2 py-0.5 text-xs font-medium text-white" onClick={apply}>
        Apply
      </button>
    </div>
  );
}

