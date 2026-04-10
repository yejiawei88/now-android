import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { EditorState, Annotation, RangeSetBuilder, StateField, RangeSet, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, drawSelection, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType, placeholder, showTooltip, Tooltip, dropCursor, rectangularSelection, crosshairCursor, hoverTooltip } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, indentMore, indentLess, insertTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, bracketMatching, defaultHighlightStyle, syntaxTree, indentOnInput, indentUnit } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { Table, TaskList, Strikethrough } from '@lezer/markdown';
import { createRoot } from 'react-dom/client';

const ExternalUpdate = Annotation.define<boolean>();

interface MarkdownTableEditorProps {
    initialRows: string[][];
    onSync: (rows: string[][]) => void;
}

let markdownTableEditorPromise: Promise<React.ComponentType<MarkdownTableEditorProps>> | null = null;
let codeLanguagesPromise: Promise<any[]> | null = null;

const loadMarkdownTableEditor = () => {
    if (!markdownTableEditorPromise) {
        markdownTableEditorPromise = import('./MarkdownTableEditor').then((mod) => mod.default);
    }

    return markdownTableEditorPromise;
};

const loadCodeLanguages = () => {
    if (!codeLanguagesPromise) {
        codeLanguagesPromise = import('@codemirror/language-data').then((mod) => mod.languages);
    }

    return codeLanguagesPromise;
};

const hasFencedCodeBlock = (content: string) => /(^|\n)(```|~~~)/.test(content);
const SOFT_TAB = '  ';
const TASK_LINE_REGEX = /^(\s*)(?:[-*]\s*)?\[[ xX]\]/;

const insertSoftTab = (view: EditorView): boolean => {
    const { state } = view;
    const change = state.changeByRange((range) => {
        if (!range.empty) {
            return {
                changes: { from: range.from, to: range.to, insert: SOFT_TAB },
                range: EditorSelection.cursor(range.from + SOFT_TAB.length)
            };
        }

        return {
            changes: { from: range.from, to: range.to, insert: SOFT_TAB },
            range: EditorSelection.cursor(range.from + SOFT_TAB.length)
        };
    });

    view.dispatch(state.update(change, { scrollIntoView: true, userEvent: 'input' }));
    return true;
};

const indentTaskLine = (view: EditorView, backwards = false): boolean => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty) return false;

    const line = state.doc.lineAt(sel.head);
    if (!TASK_LINE_REGEX.test(line.text)) return false;

    if (backwards) {
        if (line.text.startsWith('\t')) {
            view.dispatch({
                changes: { from: line.from, to: line.from + 1, insert: '' },
                selection: { anchor: Math.max(line.from, sel.anchor - 1), head: Math.max(line.from, sel.head - 1) }
            });
            return true;
        }

        const leadingSpaces = line.text.match(/^ +/)?.[0].length ?? 0;
        if (leadingSpaces === 0) return true;
        const removeCount = Math.min(SOFT_TAB.length, leadingSpaces);
        view.dispatch({
            changes: { from: line.from, to: line.from + removeCount, insert: '' },
            selection: {
                anchor: Math.max(line.from, sel.anchor - removeCount),
                head: Math.max(line.from, sel.head - removeCount)
            }
        });
        return true;
    }

    view.dispatch({
        changes: { from: line.from, to: line.from, insert: SOFT_TAB },
        selection: { anchor: sel.anchor + SOFT_TAB.length, head: sel.head + SOFT_TAB.length }
    });
    return true;
};

// --- Live Preview Decorators ---

// Bullet decorator: Hides '-' or '*' and shows a bullet point
class BulletWidget extends WidgetType {
    toDOM() {
        let span = document.createElement("span");
        span.innerHTML = "•";
        span.style.color = "rgba(255, 255, 255, 0.4)";
        span.style.marginRight = "8px";
        span.style.fontWeight = "bold";
        return span;
    }
}

const bulletDecoration = Decoration.replace({
    widget: new BulletWidget()
});

class CheckboxWidget extends WidgetType {
    constructor(readonly checked: boolean, readonly pos: number) {
        super();
    }

    eq(other: CheckboxWidget) {
        return other.checked === this.checked && other.pos === this.pos;
    }

    toDOM(view: EditorView) {
        let span = document.createElement("span");
        span.className = "group inline-flex items-center cursor-pointer mr-[10px] align-text-bottom translate-y-[2px]";

        if (this.checked) {
            span.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="transition-transform duration-200 hover:scale-[1.08] active:scale-90"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(168,168,178,0.56)" stroke-width="1.8"/><path d="M8 12.5L11 15.5L16 9.5" stroke="rgba(168, 168, 178, 0.9)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        } else {
            span.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="transition-transform duration-200 hover:scale-[1.08] active:scale-90"><circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" class="transition-all duration-300 group-hover:stroke-[rgba(255,255,255,0.5)] group-hover:fill-[rgba(255,255,255,0.05)]"/></svg>`;
        }

        span.addEventListener("mousedown", (e) => {
            e.preventDefault(); // Prevent focus loss
            e.stopPropagation();
            const changes = this.checked
                ? { from: this.pos, to: this.pos + 3, insert: "[ ]" }
                : { from: this.pos, to: this.pos + 3, insert: "[x]" };

            view.dispatch({ changes });
        });

        return span;
    }
}

const dimDecoration = Decoration.mark({ attributes: { class: "cm-markdown-mark" } });
const hideDecoration = Decoration.replace({});

// Annotation to track hover position for reveal logic
const setHoverPos = Annotation.define<number | null>();
const hoverPosField = StateField.define<number | null>({
    create: () => null,
    update(value, tr) {
        const annot = tr.annotation(setHoverPos);
        return annot !== undefined ? annot : value;
    }
});

const linkHoverTooltip = hoverTooltip((view, pos, side) => {
    const text = view.state.doc.sliceString(Math.max(0, pos - 500), Math.min(view.state.doc.length, pos + 500));
    const stealthRegex = /\[(.*?)\]\((https?:\/\/[^\s]+)\)/g;
    let match;
    const docOffset = Math.max(0, pos - 500);
    
    while ((match = stealthRegex.exec(text)) !== null) {
        const s = docOffset + match.index;
        const linkEnd = s + match[0].length;
        if (pos >= s && pos <= linkEnd) {
            const url = match[2];
            const label = match[1];
            return {
                pos: s,
                end: linkEnd,
                above: true,
                arrow: true,
                create: (view) => {
                    const dom = document.createElement("div");
                    dom.className = "cm-link-tooltip animate-in fade-in zoom-in-95 duration-200";
                    
                    const renderNav = () => {
                        dom.innerHTML = "";
                        // Link Icon
                        const icon = document.createElement("span");
                        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 12px; margin-right: 4px; opacity: 0.6;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
                        dom.appendChild(icon);

                        // Open Link Section
                        const openBtn = document.createElement("button");
                        const domain = new URL(url).hostname;
                        openBtn.innerHTML = `<span>打开</span> <span style="opacity: 0.9; font-weight: 500; font-family: monospace;">${domain}</span>`;
                        openBtn.className = "cm-link-tooltip-btn cm-link-tooltip-open";
                        openBtn.onclick = (ev) => {
                            ev.stopPropagation();
                            (async () => {
                                const { openUrl } = await import('@tauri-apps/plugin-opener');
                                openUrl(url).catch(console.error);
                            })();
                        };
                        dom.appendChild(openBtn);

                        // Edit Button
                        const editBtn = document.createElement("button");
                        editBtn.innerHTML = `<span>编辑</span>`;
                        editBtn.className = "cm-link-tooltip-btn cm-link-tooltip-edit";
                        editBtn.onclick = (ev) => {
                            ev.stopPropagation();
                            renderEdit();
                        };
                        dom.appendChild(editBtn);
                    };

                    const renderEdit = () => {
                        dom.innerHTML = "";
                        const container = document.createElement("div");
                        container.className = "cm-link-edit-container";
                        
                        const input = document.createElement("input");
                        input.className = "cm-link-edit-input";
                        input.value = url;
                        input.spellcheck = false;
                        
                        const unlinkBtn = document.createElement("button");
                        unlinkBtn.className = "cm-link-unlink-btn";
                        unlinkBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.84 8.46l-4.59 4.59a3 3 0 0 1-4.24 0L7.46 10.5h0a3 3 0 0 1 0-4.24l4.59-4.59a3 3 0 0 1 4.24 0l.5.5"></path><path d="M5.16 15.54l4.59-4.59a3 3 0 0 1 4.24 0l2.55 2.55a3 3 0 0 1 0 4.24l-4.59 4.59a3 3 0 0 1-4.24 0l-.5-.5"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>';
                        
                        unlinkBtn.onclick = (ev) => {
                            ev.stopPropagation();
                            view.dispatch({
                                changes: { from: s, to: linkEnd, insert: label }
                            });
                        };

                        input.onkeydown = (ev) => {
                            if (ev.key === "Enter") {
                                ev.preventDefault();
                                const newUrl = input.value;
                                view.dispatch({
                                    changes: { from: s, to: linkEnd, insert: `[${label}](${newUrl})` }
                                });
                            } else if (ev.key === "Escape") {
                                renderNav();
                            }
                        };

                        container.appendChild(input);
                        container.appendChild(unlinkBtn);
                        dom.appendChild(container);
                        setTimeout(() => {
                            input.focus();
                            input.select();
                        }, 10);
                    };

                    renderNav();
                    return { dom };
                }
            };
        }
    }
    return null;
});
// --- Table Data & Logic Helpers ---

interface TableData {
    rows: string[][];
    aligns: ("left" | "center" | "right")[];
    widths: number[];
}

class MarkdownTable {
    static parse(content: string): TableData {
        const rawLines = content.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
        if (rawLines.length === 0) return { rows: [], aligns: [], widths: [] };

        const parseLine = (line: string) => {
            let content = line.trim();
            if (content.startsWith('|')) content = content.slice(1);
            if (content.endsWith('|')) content = content.slice(0, -1);
            
            const cells: string[] = [];
            let current = "";
            let escaped = false;
            for (let i = 0; i < content.length; i++) {
                const char = content[i];
                if (char === '\\' && !escaped) escaped = true;
                else if (char === '|' && !escaped) { cells.push(current.trim()); current = ""; }
                else { current += char; escaped = false; }
            }
            cells.push(current.trim());
            return cells;
        };

        const allRows = rawLines.map(parseLine);
        const separatorIdx = allRows.findIndex((row, idx) => 
            idx > 0 && row.length > 0 && row.every(cell => /^[ \-:|]+$/.test(cell))
        );

        let aligns: ("left" | "center" | "right")[] = [];
        if (separatorIdx !== -1) {
            aligns = allRows[separatorIdx].map(cell => {
                const t = cell.trim();
                const center = t.startsWith(':') && t.endsWith(':');
                if (center) return "center";
                if (t.endsWith(':')) return "right";
                return "left";
            });
        }

        const dataRows = allRows.filter((row, idx) => 
            idx !== separatorIdx && !row.some(c => c.includes("<!-- table-widths:"))
        );

        const widthMatch = content.match(/<!-- table-widths: ([\d, ]+) -->/);
        const widths = widthMatch ? widthMatch[1].split(",").map(w => parseInt(w.trim())) : [];

        // Ensure all rows have same length
        const maxLen = Math.max(...dataRows.map(r => r.length), aligns.length, 1);
        const rows = dataRows.map(r => {
            const nr = [...r];
            while (nr.length < maxLen) nr.push("");
            return nr;
        });
        if (rows.length === 0) rows.push(Array(maxLen).fill(""));
        if (rows.length === 0) rows.push(Array(maxLen).fill(""));
        while (aligns.length < maxLen) aligns.push("left");

        return { rows, aligns: aligns as any, widths };
    }

    static serialize(data: TableData): string {
        if (data.rows.length === 0) return "";
        let md = "";
        data.rows.forEach((row, idx) => {
            md += `| ${row.map(c => c.replace(/\|/g, "\\|") || " ").join(" | ")} |\n`;
            if (idx === 0) {
                const sep = row.map((_, i) => {
                    const a = data.aligns[i] || "left";
                    if (a === "center") return ":---:";
                    if (a === "right") return "---:";
                    return "---";
                }).join(" | ");
                md += `| ${sep} |\n`;
            }
        });
        if (data.widths.length > 0) {
            md += `\n<!-- table-widths: ${data.widths.join(", ")} -->`;
        }
        return md.trim();
    }
}
class TableWidget extends WidgetType {
    private root: ReturnType<typeof createRoot> | null = null;
    private destroyed = false;

    constructor(public content: string) { super(); }

    eq(other: TableWidget) { return other.content === this.content; }

    updateDOM(dom: HTMLElement, view: EditorView) {
        return true; 
    }

    ignoreEvent(event: Event) { 
        return true; 
    }

    toDOM(view: EditorView) {
        this.destroyed = false;
        const data = MarkdownTable.parse(this.content);
        const wrapper = document.createElement("div");
        wrapper.className = "cm-table-wrapper group/table";
        
        const container = document.createElement("div");
        container.className = "cm-table-rendering-pro";
        wrapper.appendChild(container);

        this.root = createRoot(container);
        
        const handleSync = (updatedRows: any[][]) => {
            const currentData = MarkdownTable.parse(this.content);
            const maxCols = Math.max(...updatedRows.map(r => r.length));
            const newAligns = [...currentData.aligns];
            while (newAligns.length < maxCols) newAligns.push("left");

            const md = MarkdownTable.serialize({
                rows: updatedRows.map(r => r.map(c => String(c || ""))),
                aligns: newAligns as any,
                widths: currentData.widths
            });

            if (md === this.content) return;

            let from = -1, to = -1;
            const decoSet = view.state.field(tableStateField, false);
            if (decoSet) {
                (decoSet as any).between(0, view.state.doc.length, (f: number, t: number, v: any) => {
                    if (v.spec.widget === this || (v.spec.widget instanceof TableWidget && v.spec.widget.content === this.content)) {
                        from = f; to = t; return false;
                    }
                });
            }

            if (from === -1) {
                const docText = view.state.doc.toString();
                const idx = docText.indexOf(this.content);
                if (idx !== -1) { from = idx; to = idx + this.content.length; }
            }

            if (from !== -1) {
                this.content = md; 
                view.dispatch({ 
                    changes: { from, to, insert: md }, 
                    annotations: [ExternalUpdate.of(true)] 
                });
            }
        };

        this.root.render(
            <div className="hot-container dark-theme-table">
                <div className="hot-viewport-pro min-h-[160px] rounded-2xl border border-white/5 bg-white/[0.02] flex items-center justify-center text-sm text-white/35">
                    Loading table editor...
                </div>
            </div>
        );

        void loadMarkdownTableEditor()
            .then((MarkdownTableEditor) => {
                if (this.destroyed || !this.root) return;

                this.root.render(
                    <MarkdownTableEditor
                        initialRows={data.rows}
                        onSync={(rows) => handleSync(rows)}
                    />
                );
            })
            .catch((error) => {
                console.error("Failed to load table editor", error);
                if (this.destroyed || !this.root) return;

                this.root.render(
                    <div className="hot-container dark-theme-table">
                        <div className="hot-viewport-pro min-h-[160px] rounded-2xl border border-red-500/20 bg-red-500/5 px-4 flex items-center justify-center text-sm text-red-200/70">
                            Table editor failed to load
                        </div>
                    </div>
                );
            });

        return wrapper;
    }

    destroy() {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
        this.destroyed = true;
    }
}



// --- Table Styling & Decorations ---

const headerStyles = [
    Decoration.line({ attributes: { class: "cm-header-1" } }),
    Decoration.line({ attributes: { class: "cm-header-2" } }),
    Decoration.line({ attributes: { class: "cm-header-3" } }),
    Decoration.line({ attributes: { class: "cm-header-4" } }),
    Decoration.line({ attributes: { class: "cm-header-5" } }),
    Decoration.line({ attributes: { class: "cm-header-6" } }),
];

function buildTableDecorations(state: EditorState) {
    const builder = new RangeSetBuilder<Decoration>();
    const tree = syntaxTree(state);
    let lastTo = -1;

    tree.iterate({
        enter: (node) => {
            if (node.from < lastTo) return;
            if (node.name === "Table") {
                // Only process top-level Table nodes or potential table blocks
                
                const nodeFrom = node.from;
                const nodeTo = node.to;
                
                // 1. Precise Scan for the GFM Separator Row (|---|)
                let sepLineNum = -1;
                for (let pos = nodeFrom; pos < nodeTo; ) {
                    const line = state.doc.lineAt(pos);
                    const trimmed = line.text.trim();
                    if (trimmed.includes('|') && trimmed.match(/^[ \t]*\|?[ \t]*[:\- \t|]+[ \t]*\|?[ \t]*$/) && trimmed.includes('-')) {
                        sepLineNum = line.number;
                        break;
                    }
                    pos = line.to + 1;
                    if (pos >= nodeTo) break;
                }

                // A valid table MUST have a separator and at least one header line above
                if (sepLineNum !== -1) {
                    const sepLine = state.doc.line(sepLineNum);
                    const headerLine = state.doc.line(sepLineNum - 1);
                    
                    // Check if header line actually looks like a table row
                    if (!headerLine.text.includes('|')) return;

                    const actualTableFrom = headerLine.from;

                    // 2. Continuous Data Row Scan
                    let lastValidTableTo = sepLine.to;
                    for (let n = sepLineNum + 1; n <= state.doc.lines; n++) {
                        const line = state.doc.line(n);
                        if (line.text.trim().includes('|')) {
                            lastValidTableTo = line.to;
                        } else {
                            break;
                        }
                    }

                    // 3. Metadata Extension
                    let finalTo = lastValidTableTo;
                    while (finalTo < state.doc.length) {
                        const nextLine = state.doc.lineAt(finalTo + 1);
                        if (nextLine.text.includes('<!-- table-widths:')) {
                            finalTo = nextLine.to;
                        } else break;
                    }

                    // 4. Create Surgical Decoration
                    if (finalTo > actualTableFrom) {
                        builder.add(actualTableFrom, finalTo, Decoration.replace({ 
                            widget: new TableWidget(state.doc.sliceString(actualTableFrom, finalTo)),
                            block: true 
                        }));
                        lastTo = finalTo;
                    }
                }
                if (lastTo > node.from) return false; 
            }
        }
    });
    return builder.finish();
}


const tableStateField = StateField.define<DecorationSet>({
    create(state) { return buildTableDecorations(state); },
    update(value, tr) {
        if (!tr.docChanged) return value;
        return buildTableDecorations(tr.state);
    },
    provide: f => EditorView.decorations.from(f)
});


const livePreviewPlugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.getDecorations(view);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
            this.decorations = this.getDecorations(update.view);
        }
    }

    getDecorations(view: EditorView) {
        interface DecorationItem {
            from: number;
            to: number;
            value: Decoration;
            priority: number; 
        }

        const decoItems: DecorationItem[] = [];
        const decoratedLines = new Set<number>();

        for (let { from, to } of view.visibleRanges) {
            // --- 1. Structural Line Scan: Tasks, Bullets, Headings ---
            let pos = from;
            while (pos <= to) {
                const line = view.state.doc.lineAt(pos);
                const lineText = line.text;
                
                // Task List detection (Line Start)
                const taskMatch = lineText.match(/^([ \t]*)([-*])?\s*(\[[ xX]\])/);
                if (taskMatch) {
                    const leadingIndent = taskMatch[1] ?? '';
                    const bulletPart = taskMatch[2];
                    const checkboxPart = taskMatch[3];
                    
                    const checkBoxIdx = lineText.indexOf(checkboxPart, leadingIndent.length);
                    if (checkBoxIdx < 0) {
                        pos = line.to + 1;
                        continue;
                    }
                    const checkBoxStart = line.from + checkBoxIdx;
                    const char = checkboxPart[1].toLowerCase();
                    
                    // Add Checkbox Widget
                    decoItems.push({ 
                        from: checkBoxStart, 
                        to: checkBoxStart + 3, 
                        priority: 200,
                        value: Decoration.replace({ widget: new CheckboxWidget(char === "x", checkBoxStart) }) 
                    });

                    if (char === "x") {
                        decoItems.push({
                            from: line.from,
                            to: line.from,
                            priority: 70,
                            value: Decoration.line({ attributes: { class: "cm-task-checked-line" } })
                        });

                        const textFrom = checkBoxStart + 3;
                        if (textFrom < line.to) {
                            decoItems.push({
                                from: textFrom,
                                to: line.to,
                                priority: 30,
                                value: Decoration.mark({
                                    attributes: {
                                        style: "color: rgba(255,255,255,0.34) !important; opacity: 0.78; text-decoration: line-through;"
                                    }
                                })
                            });
                        }
                    }

                    // Hide only markdown bullet marker area, keep leading indentation visible.
                    if (bulletPart) {
                        const bulletStart = line.from + leadingIndent.length;
                        if (checkBoxStart > bulletStart) {
                            decoItems.push({ from: bulletStart, to: checkBoxStart, priority: 100, value: hideDecoration });
                        }
                    }
                } 
                // Regular Bullet detection (if not a task)
                else {
                    const bulletMatch = lineText.match(/^[ \t]*([-*])(?:\s+|$)/);
                    if (bulletMatch) {
                        const s = line.from + lineText.indexOf(bulletMatch[1]);
                        decoItems.push({ from: s, to: s + 1, priority: 80, value: bulletDecoration });
                    }
                }

                pos = line.to + 1;
            }

            // --- 2. Inline Stealth: Links & Images ---
            const visibleText = view.state.doc.sliceString(from, to);
            
            // Link Stealth - Refined to require at least one non-whitespace character in labels
            const linkRegex = /\[(\S.*?)\]\((https?:\/\/[^\s]+)\)/g;
            let m;
            while ((m = linkRegex.exec(visibleText)) !== null) {
                const s = from + m.index;
                const e = s + m[0].length;
                const textEnd = s + 1 + m[1].length;
                
                decoItems.push({ from: s, to: s + 1, priority: 100, value: hideDecoration });
                decoItems.push({ from: s + 1, to: textEnd, priority: 10, value: Decoration.mark({ attributes: { class: "cm-markdown-link" } }) });
                decoItems.push({ from: textEnd, to: e, priority: 100, value: hideDecoration });
            }

            // Image Stealth
            const imgRegex = /!\[(.*?)\]\((https?:\/\/[\s\S]+?)\)/g;
            while ((m = imgRegex.exec(visibleText)) !== null) {
                const s = from + m.index;
                const e = s + m[0].length;
                const textEnd = s + 2 + m[1].length;
                const selection = view.state.selection.main;
                if (!(selection.from >= s && selection.from <= e)) {
                    decoItems.push({ from: s, to: s + 2, priority: 100, value: hideDecoration });
                    decoItems.push({ from: s + 2, to: textEnd, priority: 10, value: Decoration.mark({ attributes: { class: "cm-markdown-link-alt" } }) });
                    decoItems.push({ from: textEnd, to: e, priority: 100, value: hideDecoration });
                }
            }

            // --- 3. Syntax Tree Iteration: Header Styles & Inline Marks ---
            syntaxTree(view.state).iterate({
                from, to,
                enter: (node) => {
                    const nodeText = view.state.doc.sliceString(node.from, node.to);
                    const line = view.state.doc.lineAt(node.from);

                    if (node.name === "Table" || node.name === "Link" || node.name === "TaskMarker" || node.name === "ListMark") return;

                    if (!decoratedLines.has(line.from)) {
                        const hMatch = node.name.match(/^(?:ATX|Setext)Heading(\d+)$/);
                        if (hMatch) {
                            decoItems.push({ from: line.from, to: line.from, priority: 60, value: headerStyles[parseInt(hMatch[1]) - 1] });
                            decoratedLines.add(line.from);
                        }
                    }

                    if (node.name === "HeaderMark" || (node.name.startsWith("ATXHeading") && /^#{1,6}\s/.test(nodeText))) {
                        const match = nodeText.match(/^#{1,6}\s/);
                        if (match) decoItems.push({ from: node.from, to: node.from + match[0].length, priority: 100, value: hideDecoration });
                    }

                    if (node.name === "Strikethrough") {
                        decoItems.push({ from: node.from, to: node.from + 2, priority: 100, value: hideDecoration });
                        decoItems.push({ from: node.to - 2, to: node.to, priority: 100, value: hideDecoration });
                        decoItems.push({ from: node.from + 2, to: node.to - 2, priority: 20, value: Decoration.mark({ attributes: { style: "text-decoration: line-through; opacity: 0.5;" } }) });
                    }

                    if (node.name === "StrongEmphasis") {
                        decoItems.push({ from: node.from, to: node.from + 2, priority: 100, value: hideDecoration });
                        decoItems.push({ from: node.to - 2, to: node.to, priority: 100, value: hideDecoration });
                        decoItems.push({ from: node.from + 2, to: node.to - 2, priority: 20, value: Decoration.mark({ attributes: { fontWeight: "bold", color: "inherit" } }) });
                    }
                }
            });
        }

        // --- 4. Conflict Resolution & Builder Assembly ---
        // Sort: Position ASC, Priority DESC
        decoItems.sort((a, b) => (a.from - b.from) || (b.priority - a.priority));

        const widgetBuilder = new RangeSetBuilder<Decoration>();
        const markBuilder = new RangeSetBuilder<Decoration>();
        let lastWidgetTo = -1;

        for (const item of decoItems) {
            const isLineDeco = item.from === item.to && !!(item.value as any).spec?.attributes?.class;
            const isReplacement = !!(item.value as any).spec?.widget || (item.value as any).spec?.tagName === "" || (item.value as any).spec?.replace;

            if (isLineDeco) {
                // Line decorations are special, but builder.add works if at start
                try { widgetBuilder.add(item.from, item.to, item.value); } catch(e) {}
            } else if (isReplacement) {
                // Only allow the highest priority replacement at any given position
                if (item.from >= lastWidgetTo) {
                    try { 
                        widgetBuilder.add(item.from, item.to, item.value); 
                        lastWidgetTo = Math.max(lastWidgetTo, item.to);
                    } catch(e) {}
                }
            } else {
                // Marks can overlap freely with each other and with widgets
                try { markBuilder.add(item.from, item.to, item.value); } catch(e) {}
            }
        }

        return RangeSet.join([widgetBuilder.finish(), markBuilder.finish()]);
    }
}, {
    decorations: v => v.decorations
});

interface CodeMirrorEditorProps {
    value: string;
    onChange: (value: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    readOnly?: boolean;
    autoFocus?: boolean;
    onSelectionChange?: (text: string) => void;
    onCursorStateChange?: (state: string) => void;
}

export interface CodeMirrorEditorRef {
    getSelection: () => string;
    getValue: () => string;
    replaceSelection: (text: string) => void;
    setLineFormat: (format: string) => void;
    openSearch: () => void;
}

const CodeMirrorEditor = forwardRef<CodeMirrorEditorRef, CodeMirrorEditorProps>(({
    value,
    onChange,
    onFocus,
    onBlur,
    readOnly = false,
    autoFocus = false,
    onSelectionChange,
    onCursorStateChange
}, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const markdownCompartmentRef = useRef(new Compartment());
    const hasLoadedCodeLanguagesRef = useRef(false);

    const buildMarkdownExtension = (codeLanguages: any[] = []) =>
        markdown({
            base: markdownLanguage,
            codeLanguages,
            addKeymap: true,
            extensions: [Table, TaskList, Strikethrough]
        });

    const ensureCodeLanguages = () => {
        if (hasLoadedCodeLanguagesRef.current) return;
        hasLoadedCodeLanguagesRef.current = true;

        void loadCodeLanguages()
            .then((codeLanguages) => {
                const view = viewRef.current;
                if (!view) return;

                view.dispatch({
                    effects: markdownCompartmentRef.current.reconfigure(buildMarkdownExtension(codeLanguages))
                });
            })
            .catch((error) => {
                hasLoadedCodeLanguagesRef.current = false;
                console.error('Failed to load code languages', error);
            });
    };

    useImperativeHandle(ref, () => ({
        getSelection: () => {
            if (!viewRef.current) return '';
            const { from, to } = viewRef.current.state.selection.main;
            return viewRef.current.state.doc.sliceString(from, to);
        },
        getValue: () => {
            if (!viewRef.current) return '';
            return viewRef.current.state.doc.toString();
        },
        replaceSelection: (text: string) => {
            if (!viewRef.current) return;
            const { from, to } = viewRef.current.state.selection.main;
            viewRef.current.dispatch({
                changes: { from, to, insert: text },
                selection: { anchor: from, head: from + text.length }
            });
        },
        setLineFormat: (format: string) => {
            if (!viewRef.current) return;
            const state = viewRef.current.state;
            const pos = state.selection.main.head;
            const line = state.doc.lineAt(pos);
            let content = line.text;

            content = content.replace(/^(#{1,6}\s+|\[[ xX]\]\s+|[-*]\s+)/, "");

            let prefix = "";
            switch (format) {
                case '标题 1': prefix = "# "; break;
                case '标题 2': prefix = "## "; break;
                case '标题 3': prefix = "### "; break;
                case '待办事项': prefix = "[ ] "; break;
                case '列表': prefix = "- "; break;
                case '正文': prefix = ""; break;
                default: prefix = "";
            }

            const newText = prefix + content;
            viewRef.current.dispatch({
                changes: { from: line.from, to: line.to, insert: newText },
                selection: { anchor: line.from + prefix.length + (state.selection.main.head - line.from - (line.text.length - content.length)) }
            });
        },
        openSearch: () => {
            if (!viewRef.current) return;
            viewRef.current.focus();
            openSearchPanel(viewRef.current);
        }
    }));

    useEffect(() => {
        if (!editorRef.current) return;

        const startState = EditorState.create({
            doc: value,
            extensions: [
                placeholder('\u200B'),
                EditorView.contentAttributes.of({ style: "min-height: 1.5em; padding-bottom: 40px;" }),
                EditorState.phrases.of({
                    "Find": "查找",
                    "Replace": "替换",
                    "next": "下一个",
                    "previous": "上一个",
                    "all": "全部",
                    "match case": "区分大小写",
                    "regexp": "正则表达式",
                    "by word": "全词匹配",
                    "replace": "替换",
                    "replace all": "替换全部"
                }),
                history(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentUnit.of(SOFT_TAB),
                indentOnInput(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                bracketMatching(),
                closeBrackets(),
                autocompletion(),
                rectangularSelection(),
                crosshairCursor(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                hoverPosField,
                linkHoverTooltip,
                EditorView.domEventHandlers({
                    mousemove(event, view) {
                        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                        view.dispatch({ annotations: setHoverPos.of(pos) });
                        return false;
                    },
                    mouseleave(event, view) {
                        view.dispatch({ annotations: setHoverPos.of(null) });
                    }
                }),
                keymap.of([
                    // Existing keymaps would go here
                ]),
                markdownCompartmentRef.current.of(buildMarkdownExtension()),
                livePreviewPlugin,
                tableStateField,
                EditorView.theme({
                    '&': {
                        height: '100%',
                        fontSize: '16px',
                        backgroundColor: 'transparent !important'
                    },
                    '&.cm-editor': {
                        backgroundColor: 'transparent !important',
                        height: '100%',
                        flex: '1',
                        display: 'flex',
                        flexDirection: 'column'
                    },
                    '.cm-scroller': {
                        backgroundColor: 'transparent !important',
                        fontFamily: 'inherit',
                        minHeight: '100%',
                        height: '100%',
                        flex: '1',
                        overflowX: 'hidden'
                    },
                    '.cm-content': {
                        fontFamily: '"Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", sans-serif',
                        padding: '10px 0',
                        lineHeight: '1.7',
                        color: 'rgba(255, 255, 255, 0.75)',
                        fontWeight: '400',
                        letterSpacing: '0.01em',
                        textDecoration: 'none !important',
                        outline: 'none !important',
                        boxShadow: 'none !important'
                    },
                    '.cm-content *:not(.cm-markdown-link), .cm-line *:not(.cm-markdown-link)': {
                        textDecoration: 'none !important',
                        borderBottom: 'none !important'
                    },

                    '.cm-activeLine': {
                        backgroundColor: 'transparent !important'
                    },
                    '.cm-activeLineGutter': {
                        backgroundColor: 'transparent !important'
                    },
                    '.cm-selectionBackground, .cm-selectionMatch': {
                        backgroundColor: 'rgba(255, 255, 255, 0.1) !important'
                    },
                    '&.cm-focused .cm-selectionBackground, &.cm-focused .cm-selectionMatch': {
                        backgroundColor: 'rgba(255, 255, 255, 0.15) !important'
                    },
                    '.cm-searchMatch': {
                        backgroundColor: 'rgba(255, 255, 255, 0.1) !important',
                        outline: '1px solid rgba(255, 255, 255, 0.2)'
                    },
                    '.cm-searchMatch.cm-searchMatch-selected': {
                        backgroundColor: 'rgba(255, 255, 255, 0.2) !important'
                    },
                    '.cm-gutters': {
                        display: 'none'
                    },
                    '.cm-cursor': {
                        borderLeftColor: 'rgba(255, 255, 255, 0.4) !important',
                        borderLeftWidth: '2px !important',
                        borderLeftStyle: 'solid !important',
                        display: 'block !important',
                        minHeight: '1.2em !important'
                    },
                    '&.cm-focused': {
                        outline: 'none'
                    },
                    '.cm-line': {
                        paddingLeft: '0',
                        paddingRight: '0',
                        minHeight: '1.5em'
                    },
                    '.cm-content *': {
                        color: 'rgba(255, 255, 255, 0.75) !important'
                    },
                    '.cm-markdown-mark': {
                        color: 'rgba(255, 255, 255, 0.2) !important',
                        fontWeight: '400 !important',
                        marginRight: '4px'
                    },
                    '.cm-line.cm-task-checked-line, .cm-line.cm-task-checked-line *': {
                        color: 'rgba(255, 255, 255, 0.34) !important'
                    },
                    '.cm-line.cm-header-1, .cm-line.cm-header-1 *': {
                        color: 'rgba(255, 255, 255, 0.95) !important',
                        fontSize: '28px !important',
                        fontWeight: '800 !important',
                        letterSpacing: '-0.02em',
                        lineHeight: '1.2 !important',
                        paddingTop: '24px',
                        paddingBottom: '8px'
                    },
                    '.cm-line.cm-header-2, .cm-line.cm-header-2 *': {
                        color: 'rgba(255, 255, 255, 0.9) !important',
                        fontSize: '24px !important',
                        fontWeight: '700 !important',
                        letterSpacing: '-0.015em',
                        lineHeight: '1.3 !important',
                        paddingTop: '18px',
                        paddingBottom: '6px'
                    },
                    '.cm-line.cm-header-3, .cm-line.cm-header-3 *': {
                        color: 'rgba(255, 255, 255, 0.85) !important',
                        fontSize: '20px !important',
                        fontWeight: '600 !important',
                        lineHeight: '1.4 !important',
                        paddingTop: '12px',
                        paddingBottom: '4px'
                    },
                    '.cm-line.cm-header-4, .cm-line.cm-header-4 *': { color: 'rgba(255, 255, 255, 0.8) !important', fontSize: '17px !important', fontWeight: '600 !important', paddingTop: '10px' },
                    '.cm-line.cm-header-5, .cm-line.cm-header-5 *': { color: 'rgba(255, 255, 255, 0.8) !important', fontSize: '16px !important', fontWeight: '600 !important', paddingTop: '8px' },
                    '.cm-line.cm-header-6, .cm-line.cm-header-6 *': { color: 'rgba(255, 255, 255, 0.8) !important', fontSize: '15px !important', fontWeight: '600 !important', paddingTop: '4px' },

                    '.cm-underline, .cm-link, .cm-url': {
                        textDecoration: 'none !important',
                        borderBottom: 'none !important'
                    },
                    '.cm-table-row-active': {
                        backgroundColor: 'rgba(255, 255, 255, 0.02) !important',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                    },
                    'td[contenteditable="true"]:focus, th[contenteditable="true"]:focus': {
                        backgroundColor: 'rgba(255, 255, 255, 0.08) !important',
                        outline: 'none !important',
                        boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.2) !important',
                        transition: 'background-color 0.2s ease',
                        caretColor: 'white !important'
                    },
                    '.cm-table-cell-active': {
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important',
                        padding: '0 4px',
                        borderRight: '1px solid rgba(255, 255, 255, 0.1)',
                        backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    },
                    '.cm-table-cell-active:last-of-type': {
                        borderRight: 'none',
                    },
                    '.cm-matchingBracket, .cm-nonmatchingBracket': {
                        backgroundColor: 'transparent !important',
                        outline: '1px solid rgba(255, 255, 255, 0.1) !important',
                        color: 'inherit !important'
                    },

                }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && !update.transactions.some(tr => tr.annotation(ExternalUpdate))) {
                        onChange(update.state.doc.toString());
                    }
                    if (update.selectionSet) {
                        const selection = update.state.selection.main;
                        const text = update.state.doc.sliceString(selection.from, selection.to);
                        onSelectionChange?.(text);

                        const pos = selection.head;
                        const line = update.state.doc.lineAt(pos);
                        const lineText = line.text.trimStart();
                        let stateLabel = '正文';

                        if (/^\[[ xX]\]/i.test(lineText) || /^- \[[ xX]\]/i.test(lineText)) {
                            stateLabel = '待办事项';
                        } else if (/^#{1,6}\s/.test(lineText)) {
                            const match = lineText.match(/^(#{1,6})\s/);
                            if (match) stateLabel = `标题 ${match[1].length}`;
                        } else if (/^[-*]\s/.test(lineText)) {
                            stateLabel = '列表';
                        } else {
                            const node = syntaxTree(update.state).resolveInner(pos, -1);
                            if (node.name === "Image" || node.name === "Link") {
                                // Only handle images/links, Table is handled by buildTableDecorations StateField
                                stateLabel = node.name === "Image" ? "图片" : "链接";
                            } else {
                                let curr = node;
                                while (curr && curr.name !== 'Document') {
                                    if (curr.name === 'FencedCode' || curr.name === 'CodeBlock') {
                                        stateLabel = '代码块';
                                        break;
                                    }
                                    if (curr.name === 'Blockquote') {
                                        stateLabel = '引用';
                                        break;
                                    }
                                    curr = curr.parent!;
                                }
                            }
                        }

                        onCursorStateChange?.(stateLabel);
                    }
                    if (update.focusChanged) {
                        if (update.view.hasFocus) {
                            onFocus?.();
                        } else {
                            onBlur?.();
                        }
                    }
                }),
                keymap.of([
                    {
                        key: 'Tab',
                        preventDefault: true,
                        run: (target) => indentTaskLine(target, false) || indentMore(target) || insertTab(target) || insertSoftTab(target),
                        shift: (target) => indentTaskLine(target, true) || indentLess(target)
                    },
                    {
                        key: 'Mod-k',
                        run: (target) => {
                            openSearchPanel(target);
                            return true;
                        }
                    },
                    {
                        key: "Enter",
                        run: (target) => {
                            const { state, dispatch } = target;
                            const pos = state.selection.main.head;
                            const line = state.doc.lineAt(pos);
                            const lineText = line.text;

                            // Match to-do lists: `[ ] ` or `[x] ` or `- [ ] ` or `- [x] `
                            const todoMatch = lineText.match(/^(\s*(?:-\s+)?\[[ xX]\]\s+)(.*)/);

                            if (todoMatch) {
                                const prefix = todoMatch[1];
                                const content = todoMatch[2];

                                if (content.trim() === '') {
                                    // Empty to-do item: pressing Enter should escape the list (clear the line)
                                    dispatch({
                                        changes: { from: line.from, to: line.to, insert: '' },
                                        selection: { anchor: line.from }
                                    });
                                    return true;
                                } else {
                                    // Non-empty to-do item: auto-continue with a new un-checked `[ ] `
                                    const newPrefix = prefix.replace(/\[[xX]\]/, '[ ]');
                                    dispatch({
                                        changes: { from: pos, to: pos, insert: '\n' + newPrefix },
                                        selection: { anchor: pos + 1 + newPrefix.length } // 1 for newline
                                    });
                                    return true;
                                }
                            }

                            // Match unordered lists: `- ` or `* `
                            const listMatch = lineText.match(/^(\s*[-*]\s+)(.*)/);
                            if (listMatch) {
                                const prefix = listMatch[1];
                                const content = listMatch[2];

                                if (content.trim() === '') {
                                    dispatch({
                                        changes: { from: line.from, to: line.to, insert: '' },
                                        selection: { anchor: line.from }
                                    });
                                    return true;
                                } else {
                                    dispatch({
                                        changes: { from: pos, to: pos, insert: '\n' + prefix },
                                        selection: { anchor: pos + 1 + prefix.length }
                                    });
                                    return true;
                                }
                            }

                            return false; // Fall back to default Enter behavior
                        }
                    },
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...searchKeymap,
                    ...historyKeymap,
                    ...completionKeymap,
                    indentWithTab,
                ]),
                EditorView.editable.of(!readOnly),
                EditorView.lineWrapping,
                EditorView.domEventHandlers({
                    paste: (event, view) => {
                        // 0. Ctrl+Shift+V for Plain Text Paste (Common browser implementation)
                        if ((event as any).shiftKey) return false;

                        const text = event.clipboardData?.getData('text/plain');
                        const html = event.clipboardData?.getData('text/html');

                        // 1. Smart Link Intelligence: Auto-title fetching & Obsidian-style wrap
                        if (text) {
                            const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=%]*)/;
                            const match = text.trim().match(urlRegex);
                            if (match && match[0] === text.trim()) {
                                const url = text.trim();
                                const { from, to } = view.state.selection.main;
                                
                                if (from !== to) {
                                    // Case A: Selection exists - wrap selection
                                    const selectedText = view.state.doc.sliceString(from, to);
                                    view.dispatch({
                                        changes: { from, to, insert: `[${selectedText}](${url})` },
                                        selection: { anchor: from + 1, head: from + 1 + selectedText.length }
                                    });
                                    return true;
                                } else {
                                    // Case B: No selection - auto fetch title
                                    const placeholder = `[获取标题中...](${url})`;
                                    view.dispatch({
                                        changes: { from, to, insert: placeholder },
                                        selection: { anchor: from + 1, head: from + 1 + 7 } // Select "获取标题中..."
                                    });

                                    // Async fetch
                                    (async () => {
                                        try {
                                            const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
                                            const data = await res.json();
                                            if (data.status === 'success' && data.data.title) {
                                                const title = data.data.title;
                                                // Find current position of the placeholder
                                                const currentDoc = view.state.doc.toString();
                                                const searchStr = `[获取标题中...](${url})`;
                                                const foundIdx = currentDoc.indexOf(searchStr);
                                                if (foundIdx !== -1) {
                                                    view.dispatch({
                                                        changes: { 
                                                            from: foundIdx + 1, 
                                                            to: foundIdx + 8, // "获取标题中..." length is 7
                                                            insert: title 
                                                        }
                                                    });
                                                }
                                            }
                                        } catch (e) {
                                            console.error("Link title fetch failed", e);
                                        }
                                    })();
                                    return true;
                                }
                            }
                        }

                        const convertToMD = (rows: string[][]) => {
                            if (rows.length < 2 || rows[0].length < 1) return null;
                            let md = "| " + rows[0].join(" | ") + " |\n";
                            md += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
                            for (let i = 1; i < rows.length; i++) {
                                const row = rows[i];
                                const paddedRow = [...row];
                                while (paddedRow.length < rows[0].length) paddedRow.push("");
                                md += "| " + paddedRow.slice(0, rows[0].length).join(" | ") + " |\n";
                            }
                            return md;
                        };

                        // 2. High-Fidelity Content Parser (Structural De-duplicator)
                        const hasStructure = html && (html.includes('<table') || html.includes('<ul') || html.includes('<ol') || html.includes('<p') || html.includes('<div'));
                        if (hasStructure) {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(html, 'text/html');
                            
                            const walk = (node: Node, listType: 'UL' | 'OL' | null = null, index: number = 1): string => {
                                if (node.nodeType === Node.TEXT_NODE) {
                                    return node.textContent || "";
                                }
                                
                                const name = node.nodeName.toUpperCase();

                                if (name === "TABLE") {
                                    const rows: string[][] = [];
                                    (node as Element).querySelectorAll('tr').forEach(tr => {
                                        const cells: string[] = [];
                                        tr.querySelectorAll('th, td').forEach(td => cells.push(td.textContent?.trim().replace(/\s+/g, ' ') || ""));
                                        if (cells.length > 0) rows.push(cells);
                                    });
                                    const md = convertToMD(rows);
                                    // Use double-newline isolation for tables to ensure GFM triggers
                                    return md ? `\n\n${md}\n\n` : "";
                                }

                                if (name === "UL" || name === "OL") {
                                    let content = "";
                                    let i = 1;
                                    node.childNodes.forEach(child => {
                                        if (child.nodeName === "LI") {
                                            content += walk(child, name as any, i++);
                                        } else {
                                            const childRes = walk(child, listType, index);
                                            if (childRes.trim()) content += childRes;
                                        }
                                    });
                                    return `\n${content.trim()}\n`;
                                }

                                if (name === "LI") {
                                    let inner = "";
                                    node.childNodes.forEach(child => inner += walk(child));
                                    const prefix = listType === "OL" ? `${index}. ` : "- ";
                                    return `${prefix}${inner.trim()}\n`;
                                }

                                if (name === "BR") return "\n";

                                let result = "";
                                node.childNodes.forEach(child => {
                                    result += walk(child, listType, index);
                                });

                                const isBlock = ["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "FOOTER", "SECTION", "BLOCKQUOTE"].includes(name);
                                if (isBlock) {
                                    const trimmed = result.trim();
                                    // Only return with single newlines to avoid cumulative inflation from nested blocks
                                    return trimmed ? `\n${trimmed}\n` : "";
                                }
                                return result;
                            };

                            let finalMarkdown = walk(doc.body);
                            
                            // High-Density Post-Processing
                            finalMarkdown = finalMarkdown
                                .replace(/\r\n/g, '\n')      // Normalize
                                .split('\n')
                                .map(line => line.trimEnd()) // Remove trailing spaces per line
                                .join('\n')
                                .replace(/\n{3,}/g, '\n\n')  // Collapse 3+ newlines to 2 (one blank line)
                                .replace(/^\s+|\s+$/g, '');  // Trim document edges

                            if (finalMarkdown) {
                                view.dispatch(view.state.replaceSelection(finalMarkdown + "\n"));
                                return true;
                            }
                        }

                        // 3. Greedy Text Analysis (TSV/Double-Space Grid)
                        if (text && text.includes('\n')) {
                            const lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
                            let detectedRows: string[][] = [];
                            const isTabular = (rows: string[][]) => rows.length >= 2 && rows[0].length >= 2;

                            const tsvRows = lines.map(l => l.split('\t').map(c => c.trim()));
                            if (isTabular(tsvRows) && tsvRows.every(r => r.length === tsvRows[0].length)) {
                                detectedRows = tsvRows;
                            } else {
                                const spaceRows = lines.map(l => l.split(/\s{2,}/).map(c => c.trim()).filter(c => c !== ""));
                                if (isTabular(spaceRows) && spaceRows.every(r => r.length === spaceRows[0].length)) {
                                    detectedRows = spaceRows;
                                }
                            }
                            
                            if (detectedRows.length > 0 && detectedRows.length === lines.length) {
                                const md = convertToMD(detectedRows);
                                if (md) {
                                    view.dispatch(view.state.replaceSelection(md));
                                    return true;
                                }
                            }
                        }

                        return false;
                    },
                    mousedown: (event, view) => {
                        if (event.ctrlKey || event.metaKey) {
                            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                            if (pos == null) return false;
                            let url: string | null = null;
                            syntaxTree(view.state).iterate({
                                from: pos, to: pos,
                                enter: (node) => {
                                    if (node.name === "URL") {
                                        url = view.state.doc.sliceString(node.from, node.to);
                                        return false;
                                    }
                                    if (node.name === "Link" || node.name === "LinkText") {
                                        // Look for URL inside the Link node
                                        node.node.cursor().iterate(n => {
                                            if (n.name === "URL") {
                                                url = view.state.doc.sliceString(n.from, n.to);
                                                return false;
                                            }
                                        });
                                        if (url) return false;
                                    }
                                }
                            });

                            if (!url) {
                                // Double Fallback: Regex Search at line level
                                const line = view.state.doc.lineAt(pos);
                                const linkRegex = /\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
                                let m;
                                while ((m = linkRegex.exec(line.text)) !== null) {
                                    const s = line.from + m.index;
                                    const e = s + m[0].length;
                                    if (pos >= s && pos <= e) {
                                        url = m[2];
                                        break;
                                    }
                                }
                            }
                            if (url) {
                                (async () => {
                                    const { openUrl } = await import('@tauri-apps/plugin-opener');
                                    openUrl(url!).catch(console.error);
                                })();
                                return true;
                            }
                        }
                        return false;
                    }
                })
            ]
        });

        const view = new EditorView({
            state: startState,
            parent: editorRef.current
        });

        viewRef.current = view;

        if (autoFocus) {
            view.focus();
        }

        if (hasFencedCodeBlock(value)) {
            ensureCodeLanguages();
        }

        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (viewRef.current && value !== viewRef.current.state.doc.toString()) {
            viewRef.current.dispatch({
                changes: {
                    from: 0,
                    to: viewRef.current.state.doc.length,
                    insert: value
                },
                annotations: [ExternalUpdate.of(true)]
            });
        }
    }, [value]);

    useEffect(() => {
        if (hasFencedCodeBlock(value)) {
            ensureCodeLanguages();
        }
    }, [value]);

    return (
        <div
            ref={editorRef}
            className="h-full w-full overflow-hidden flex flex-col flex-1 cursor-text"
            onClick={(e) => {
                // If the user clicked a table or any interactive widget, 
                // DON'T force focus back to the main editor.
                const target = e.target as HTMLElement;
                if (target.closest('.cm-table-wrapper') || target.closest('[contenteditable="true"]')) {
                    return;
                }
                
                if (viewRef.current) {
                    viewRef.current.focus();
                    if (viewRef.current.state.doc.length === 0) {
                        viewRef.current.dispatch({ selection: { anchor: 0 } });
                    }
                }
            }}
        />
    );
});

export default CodeMirrorEditor;
