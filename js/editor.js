"use strict";

/*
 * SGML native editor.
 * Text input, caret movement, text selection, long-press selection handles,
 * clipboard actions and the Android selection toolbar are provided by the real
 * textarea. Syntax colors and completions are non-interactive overlays.
 *
 * The language profile lives in editor-language.js. New SGML syntax and
 * completions should normally be added there, not in this editor engine.
 */
const Editor = (() => {
  const $ = id => document.getElementById(id);
  const ta = $("ta"), ed = $("ed"), highlight = $("highlight"), gutter = $("editor-gutter"), pop = $("pop"),
    pos = $("pos"), searchBar = $("searchbar"), findInput = $("findq"), replaceInput = $("replaceq"),
    replaceRow = $("replaceRow"), findCase = $("findCase"), findRegex = $("findRegex"), findStatus = $("findStatus"),
    gotoBar = $("gotoBar"), gotoInput = $("gotoLine"), gotoStatus = $("gotoStatus");
  const LANG = window.SGML_EDITOR_LANGUAGE || {};
  const TAGS = Array.isArray(LANG.tags) ? LANG.tags : [];
  const ATTRS = Array.isArray(LANG.attributes) ? LANG.attributes : [];
  const SNIPPETS = Array.isArray(LANG.snippets) ? LANG.snippets : [];
  const VOID_TAGS = new Set((LANG.voidTags || []).map(value => String(value).toLowerCase()));
  const TAG_MAP = new Map(TAGS.map(tag => [String(tag.name).toLowerCase(), tag]));
  const ATTR_MAP = new Map(ATTRS.map(attr => [String(attr.name).toLowerCase(), attr]));
  const SNIPPET_MAP = new Map(SNIPPETS.map(item => [String(item.trigger).toLowerCase(), item]));
  const LH = 18, PL = 8, PC = 54;
  const TOKEN_LEXICAL = /<!--[\s\S]*?(?:-->|$)|```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|<\s*\/?\s*[A-Za-z][\w:-]*|#[\da-fA-F]{3,8}\b|\b(?:true|false|null)\b|\b[A-Za-z_][\w:-]*(?=\s*[:=])/g;
  let CHAR_W = measureCharWidth();
  let onRun = () => {}, onChange = () => {};
  let suggestions = [], selectedSuggestion = 0, popOpen = false, replaceTokenStart = 0, replaceTokenEnd = 0;
  let suppressSuggestions = false, findMatches = [], activeFind = -1, renderFrame = 0, renderTimer = 0;
  let renderedLineCount = -1, currentLineCount = 1;

  function measureCharWidth() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext && canvas.getContext("2d");
    if (!context) return 8;
    context.font = getComputedStyle(ta).font || '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    return context.measureText("M").width || 8;
  }
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const normalize = value => String(value == null ? "" : value).replace(/\r\n?/g, "\n");
  const value = () => ta.value;
  const clamp = (num, min, max) => Math.max(min, Math.min(max, num));
  const hasSelection = () => ta.selectionStart !== ta.selectionEnd;
  const currentLineInfo = (offset = ta.selectionEnd) => {
    const text = value();
    offset = clamp(offset, 0, text.length);
    const previousNewline = text.lastIndexOf("\n", offset - 1);
    let line = 0;
    for (let cursor = 0; cursor < offset; cursor++) {
      if (text.charCodeAt(cursor) === 10) line++;
    }
    const column = offset - (previousNewline + 1);
    return { line, column, lineStart: previousNewline + 1, offset };
  };
  const currentLineText = (offset = ta.selectionEnd) => {
    const info = currentLineInfo(offset);
    const end = value().indexOf("\n", offset);
    return value().slice(info.lineStart, end < 0 ? value().length : end);
  };
  const closePop = () => { popOpen = false; pop.style.display = "none"; pop.innerHTML = ""; };

  function tokenHtml(text) {
    const spans = [];
    TOKEN_LEXICAL.lastIndex = 0;
    let match;
    while ((match = TOKEN_LEXICAL.exec(text))) {
      const raw = match[0];
      let cls = "";
      if (raw.startsWith("<!--") || raw.startsWith("```") || raw.startsWith("~~~")) cls = "com";
      else if (raw[0] === '"' || raw[0] === "'" || raw[0] === "`") cls = "str";
      else if (raw[0] === "<") {
        const nameMatch = /<\s*\/?\s*([A-Za-z][\w:-]*)/.exec(raw);
        const name = nameMatch ? nameMatch[1] : "";
        cls = TAG_MAP.has(name.toLowerCase()) ? "tagname" : "unknown-tag";
      } else if (raw[0] === "#") cls = "value";
      else if (/^(?:true|false|null)$/i.test(raw)) cls = "num";
      else cls = "attr";
      spans.push({ start: match.index, end: match.index + raw.length, raw, cls });
    }
    let out = "", offset = 0;
    for (const span of spans) {
      if (span.start < offset) continue;
      out += esc(text.slice(offset, span.start));
      if (span.cls === "tagname") {
        const m = /^(<\s*\/?\s*)([A-Za-z][\w:-]*)$/.exec(span.raw);
        if (m) out += '<span class="punct">' + esc(m[1]) + '</span><span class="tagname">' + esc(m[2]) + '</span>';
        else out += '<span class="' + span.cls + '">' + esc(span.raw) + '</span>';
      } else {
        out += '<span class="' + span.cls + '">' + esc(span.raw) + '</span>';
      }
      offset = span.end;
    }
    out += esc(text.slice(offset));
    return out;
  }

  function renderView() {
    const text = value();
    const lines = text.split("\n");
    currentLineCount = lines.length;
    // Rebuilding all line numbers for every character typed was needlessly
    // expensive. The gutter only changes when the actual number of lines does.
    if (lines.length !== renderedLineCount) {
      gutter.textContent = lines.map((_, index) => String(index + 1)).join("\n");
      renderedLineCount = lines.length;
    }
    // Wrapping the source in a span avoids <pre>'s special leading-newline
    // parsing rule, while the textarea itself remains the source of truth.
    highlight.innerHTML = '<span class="mirror-content">' + tokenHtml(text) + '</span>';
    syncScroll();
    updatePosition();
  }
  function syncScroll() {
    const left = ta.scrollLeft || 0, top = ta.scrollTop || 0;
    highlight.style.transform = `translate(${-left}px, ${-top}px)`;
    gutter.style.transform = `translateY(${-top}px)`;
    if (popOpen) positionPopup();
  }
  function updatePosition() {
    const info = currentLineInfo();
    pos.textContent = `Ln ${info.line + 1}, Col ${info.column + 1}  |  ${currentLineCount} lines`;
  }
  function queueRenderView() {
    // Throttle expensive syntax-color rebuilding instead of doing it for every
    // keystroke. This keeps editing responsive without leaving the mirror stale
    // for the whole duration of continuous typing.
    if (renderTimer || renderFrame) return;
    renderTimer = setTimeout(() => {
      renderTimer = 0;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        renderView();
      });
    }, 24);
  }
  function refreshView(immediate = false) {
    if (immediate) {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = 0;
      if (renderFrame) cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      renderView();
    } else {
      queueRenderView();
    }
    if (document.activeElement === ta && !suppressSuggestions) suggest(false);
  }
  function changed() {
    refreshView();
    onChange();
  }
  function replaceRange(start, end, insertion, cursorOffset = null, selectionEnd = null) {
    const text = normalize(insertion);
    ta.setRangeText(text, start, end, "preserve");
    const caret = cursorOffset == null ? start + text.length : start + cursorOffset;
    ta.setSelectionRange(caret, selectionEnd == null ? caret : start + selectionEnd);
    closePop();
    changed();
  }
  function wordStartAt(text, offset) {
    let start = offset;
    while (start > 0 && /[A-Za-z0-9_$-]/.test(text[start - 1])) start--;
    return start;
  }
  function templatePreview(item) {
    const inserted = String(item.insert !== undefined ? item.insert : item.t || item.m || "");
    return inserted.replace(/\$0/g, "Question").replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();
  }
  function flattenSet(path, sets) {
    return String(path || "").split(".").reduce((current, key) => current && current[key], sets);
  }
  function getContextCompletions(prefix) {
    const rules = Array.isArray(LANG.contextRules) ? LANG.contextRules : [];
    const sets = LANG.contextSuggestionSets || {};
    for (const rule of rules) {
      try {
        const pattern = new RegExp(String(rule.pattern || ""), String(rule.flags || "i"));
        if (!pattern.test(prefix)) continue;
        const items = flattenSet(rule.items, sets);
        if (!Array.isArray(items)) return { matched: true, candidates: [] };
        return {
          matched: true,
          candidates: items.map(item => ({
            m: String(item.name !== undefined ? item.name : item.m !== undefined ? item.m : ""),
            insert: item.insert !== undefined ? item.insert : item.name,
            d: item.description || item.d || "",
            k: item.kind || item.k || "param"
          }))
        };
      } catch (error) {
        console.warn("Invalid SGML completion rule:", rule, error);
      }
    }
    return { matched: false, candidates: [] };
  }
  function insideStringOrComment(prefix) {
    const comment = prefix.lastIndexOf("<!--");
    if (comment > prefix.lastIndexOf("-->") && comment >= 0) return true;
    const open = prefix.lastIndexOf("<");
    const close = prefix.lastIndexOf(">");
    const current = prefix.slice(Math.max(open, close) + 1);
    let quote = "", escaped = false;
    for (const ch of current) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (quote) { if (ch === quote) quote = ""; continue; }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    }
    return !!quote;
  }
  function asCandidate(item, extra = {}) {
    return {
      m: String(item.m !== undefined ? item.m : item.name !== undefined ? item.name : ""),
      insert: item.insert !== undefined ? item.insert : item.m !== undefined ? item.m : item.name,
      d: item.d || item.description || "",
      k: item.k || item.kind || "value",
      ...extra
    };
  }
  function getCandidates(force) {
    const text = value();
    const caret = ta.selectionStart;
    const prefix = text.slice(0, caret);
    const lastLineStart = prefix.lastIndexOf("\n") + 1;
    const linePrefix = prefix.slice(lastLineStart);
    const startWord = wordStartAt(text, caret);
    const word = text.slice(startWord, caret);
    const lastOpen = prefix.lastIndexOf("<");
    const lastClose = prefix.lastIndexOf(">");
    const insideTag = lastOpen > lastClose;
    const context = getContextCompletions(prefix);
    let candidates = [];
    let replaceStart = startWord;
    let replaceEnd = caret;

    if (hasSelection()) return { candidates: [], replaceStart, replaceEnd };
    if (insideStringOrComment(prefix)) return { candidates: [], replaceStart, replaceEnd };

    if (context.matched) {
      candidates = context.candidates;
    } else if (insideTag) {
      const afterOpen = prefix.slice(lastOpen);
      const partialTagName = /^<\s*\/?\s*([A-Za-z][\w:-]*)?$/.test(afterOpen);
      const tagNameMatch = /^<\s*\/?\s*([A-Za-z][\w:-]*)/.exec(afterOpen);
      const tagName = tagNameMatch ? tagNameMatch[1] : "";
      const isClosing = /^<\s*\//.test(afterOpen);
      const snippet = tagName ? SNIPPET_MAP.get(tagName.toLowerCase()) : null;
      if (partialTagName) {
        candidates = TAGS.map(tag => {
          const matchingSnippet = SNIPPET_MAP.get(String(tag.name).toLowerCase());
          return {
            m: String(tag.name),
            insert: matchingSnippet ? matchingSnippet.insert : (tag.insert || tag.name),
            d: matchingSnippet ? (matchingSnippet.description || tag.description || "SGML syntax") : (tag.description || "SGML tag"),
            k: matchingSnippet ? "syntax" : "tag",
            preview: matchingSnippet ? templatePreview(matchingSnippet) : "<" + (tag.insert || tag.name) + ">",
            replaceStart: matchingSnippet && !isClosing ? lastOpen : startWord,
            replaceEnd: caret
          };
        });
      } else if (tagName && ["choices", "fillin", "enumeration", "connect", "flashcard"].includes(tagName.toLowerCase()) && /:/.test(afterOpen)) {
        // Questionnaire bodies have their own grammar. Do not offer generic
        // HTML-style attributes while the user is writing the question body.
        candidates = [];
      } else if (!/["'`][^"'`]*$/.test(afterOpen.slice(tagNameMatch ? tagNameMatch[0].length : 0))) {
        const allowed = (LANG.tagAttributes || {})[tagName] || (LANG.tagAttributes || {})[String(tagName).toLowerCase()];
        const attrDefs = allowed ? allowed.map(name => ATTR_MAP.get(String(name).toLowerCase())).filter(Boolean) : ATTRS;
        candidates = attrDefs.map(attr => asCandidate(attr, { k: "attr" }));
        if (/(?:^|\s)[A-Za-z_][\w-]*\s*:\s*$/.test(linePrefix)) {
          const booleans = (LANG.values || {}).booleans || [];
          candidates = booleans.map(item => asCandidate(item, { k: "value" }));
        }
        if (snippet && word && String(snippet.trigger).toLowerCase().startsWith(word.toLowerCase())) {
          candidates.unshift(asCandidate(snippet, { m: snippet.trigger, insert: snippet.insert, k: "syntax", preview: templatePreview(snippet), replaceStart: lastOpen, replaceEnd: caret }));
        }
      }
    } else {
      const snippets = SNIPPETS.map(item => ({
        m: String(item.trigger), insert: item.insert, d: item.description || "SGML syntax", k: "syntax",
        preview: templatePreview(item), replaceStart: startWord, replaceEnd: caret
      }));
      if (force) {
        candidates = [...snippets, ...TAGS.filter(tag => !SNIPPET_MAP.has(String(tag.name).toLowerCase())).map(tag => asCandidate(tag, { k: "tag" }))];
      } else if (word.length) {
        candidates = snippets.filter(item => item.m.toLowerCase().startsWith(word.toLowerCase()));
      }
    }

    // Context-specific color completion.
    const beforeCursorLine = linePrefix;
    const colorMatch = /(?:\bbg|\bcol|\bcolor)\s*:\s*#?([\da-fA-F]*)$/i.exec(beforeCursorLine);
    if (!context.matched && insideTag && colorMatch && (word.length || force)) {
      const hashExists = /(?:\bbg|\bcol|\bcolor)\s*:\s*#[\da-fA-F]*$/i.test(beforeCursorLine);
      candidates = (((LANG.values || {}).colors) || []).map(item => ({
        m: item.name, insert: (hashExists ? "" : "#") + (item.insert !== undefined ? item.insert : item.name),
        d: item.description || "Color", k: "value", replaceStart: startWord, replaceEnd: caret
      }));
    }

    if (!force && !word && !context.matched && !insideTag) candidates = [];
    // A value completion immediately after a colon is useful even when there is
    // no partial word yet, while ordinary empty prefixes stay quiet.
    if (!force && !word && !context.matched && !(insideTag && linePrefix.endsWith("<"))) candidates = [];

    const lower = word.toLowerCase();
    const unique = new Map();
    for (const item of candidates) {
      const label = String(item.m || "");
      if (word && !label.toLowerCase().startsWith(lower) && !label.toLowerCase().includes(lower)) continue;
      const key = label.toLowerCase() + "|" + (item.k || "") + "|" + String(item.insert || "");
      if (!unique.has(key)) unique.set(key, { ...item, replaceStart: item.replaceStart == null ? replaceStart : item.replaceStart, replaceEnd: item.replaceEnd == null ? replaceEnd : item.replaceEnd });
    }
    const output = [...unique.values()];
    output.sort((a, b) => {
      const am = String(a.m).toLowerCase(), bm = String(b.m).toLowerCase();
      const as = word && am.startsWith(lower) ? 0 : 1;
      const bs = word && bm.startsWith(lower) ? 0 : 1;
      return as - bs || String(a.m).length - String(b.m).length || String(a.m).localeCompare(String(b.m));
    });
    return { candidates: output.slice(0, 40), replaceStart, replaceEnd };
  }
  function positionPopup() {
    if (!popOpen || !suggestions.length) return;
    const info = currentLineInfo(ta.selectionStart);
    const relX = PC + info.column * CHAR_W - ta.scrollLeft;
    const relY = PL + info.line * LH - ta.scrollTop + LH;
    const maxWidth = Math.max(170, Math.min(480, ed.clientWidth - 12));
    pop.style.maxWidth = maxWidth + "px";
    pop.style.left = clamp(relX, 4, Math.max(4, ed.clientWidth - maxWidth - 4)) + "px";
    const popupHeight = Math.min(180, suggestions.length * 30 + 2);
    const below = relY + popupHeight <= ed.clientHeight;
    pop.style.top = clamp(below ? relY : relY - popupHeight - LH, 4, Math.max(4, ed.clientHeight - popupHeight - 4)) + "px";
  }
  function drawSuggestions() {
    pop.innerHTML = suggestions.map((item, index) => {
      const label = esc(item.m);
      const preview = item.preview ? '<i class="sgml-suggestion-preview">' + esc(item.preview) + '</i>' : "";
      return '<div class="it' + (index === selectedSuggestion ? " sel" : "") + '" role="option" aria-selected="' + (index === selectedSuggestion ? "true" : "false") + '" data-index="' + index + '"><b>' + esc(item.k || "syntax") + '</b><span class="sgml-suggestion-label">' + label + '</span>' + preview + (item.d ? '<i>' + esc(item.d) + '</i>' : "") + '</div>';
    }).join("");
    pop.style.display = "block";
    popOpen = true;
    const active = pop.querySelector(".it.sel");
    if (active) active.scrollIntoView({ block: "nearest" });
    positionPopup();
  }
  function suggest(force = false) {
    if (document.activeElement !== ta && !force) return closePop();
    if (hasSelection()) return closePop();
    const result = getCandidates(force);
    if (!result.candidates.length) return closePop();
    suggestions = result.candidates;
    replaceTokenStart = result.replaceStart;
    replaceTokenEnd = result.replaceEnd;
    selectedSuggestion = 0;
    drawSuggestions();
  }
  function acceptSuggestion(index = selectedSuggestion) {
    const item = suggestions[index];
    if (!item) return closePop();
    const start = item.replaceStart == null ? replaceTokenStart : item.replaceStart;
    const end = item.replaceEnd == null ? replaceTokenEnd : item.replaceEnd;
    let insertion = String(item.insert !== undefined ? item.insert : item.m || "");
    const lineStart = value().lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const indent = /^\s*/.exec(value().slice(lineStart, start))[0];
    if (insertion.includes("\n")) insertion = insertion.replace(/\n/g, "\n" + indent);
    const marker = insertion.indexOf("$0");
    const cleaned = insertion.replace(/\$0/g, "");
    closePop();
    suppressSuggestions = true;
    ta.setRangeText(cleaned, start, end, "select");
    const caret = start + (marker >= 0 ? marker : cleaned.length);
    ta.setSelectionRange(caret, caret);
    suppressSuggestions = false;
    ta.focus({ preventScroll: true });
    changed();
    // Keep the cursor at the snippet's insertion point. Do not reopen a popup
    // until the user types another character or asks for suggestions manually.
    closePop();
  }
  pop.addEventListener("pointerdown", event => {
    const row = event.target.closest(".it");
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    acceptSuggestion(Number(row.dataset.index));
  });
  pop.addEventListener("wheel", event => event.stopPropagation(), { passive: true });

  function insertText(text, start = ta.selectionStart, end = ta.selectionEnd, caretOffset = null) {
    const insertion = normalize(text);
    const at = start;
    ta.setRangeText(insertion, start, end, "preserve");
    const caret = caretOffset == null ? at + insertion.length : at + caretOffset;
    ta.setSelectionRange(caret, caret);
    closePop();
    changed();
  }
  function autoIndentEnter() {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const text = value();
    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = text.indexOf("\n", start);
    const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
    const before = text.slice(lineStart, start);
    const after = text.slice(end, lineEnd);
    const baseIndent = /^\s*/.exec(before)[0];
    const open = /[\[{(]$/.test(before.trimEnd());
    const currentTag = /<([A-Za-z][\w:-]*)(?:\s+[^<>]*)?>\s*$/.exec(before.trimEnd());
    const shouldIndent = open || (currentTag && !VOID_TAGS.has(currentTag[1].toLowerCase()) && !/\/\s*>$/.test(before.trimEnd()));
    const indent = baseIndent + (shouldIndent ? "  " : "");
    insertText("\n" + indent, start, end);
  }
  function indentSelection(outdent = false) {
    const start = ta.selectionStart, end = ta.selectionEnd, text = value();
    if (start === end) {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const prefix = text.slice(lineStart, start);
      if (outdent) {
        const remove = prefix.endsWith("  ") ? 2 : prefix.endsWith(" ") || prefix.endsWith("\t") ? 1 : 0;
        if (remove) insertText("", start - remove, start);
      } else {
        insertText("  ", start, end);
      }
      return;
    }
    const firstLine = text.lastIndexOf("\n", start - 1) + 1;
    const lastNewline = text.indexOf("\n", end);
    const lastEnd = lastNewline < 0 ? text.length : lastNewline;
    const selected = text.slice(firstLine, lastEnd);
    const rows = selected.split("\n");
    const nextRows = rows.map(row => {
      if (!outdent) return "  " + row;
      if (row.startsWith("  ")) return row.slice(2);
      if (row.startsWith("\t")) return row.slice(1);
      return row.replace(/^ {1,2}/, "");
    });
    const replacement = nextRows.join("\n");
    const prefixBeforeStart = text.slice(firstLine, start);
    const prefixAfterStart = nextRows[0].slice(0, Math.max(0, prefixBeforeStart.length + (outdent ? -2 : 2)));
    ta.setRangeText(replacement, firstLine, lastEnd, "select");
    const newStart = firstLine + prefixAfterStart.length;
    const newEnd = Math.max(newStart, end + replacement.length - selected.length);
    ta.setSelectionRange(newStart, newEnd);
    changed();
  }
  function insertPair(open, close) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = value().slice(start, end);
    const replacement = open + selected + close;
    ta.setRangeText(replacement, start, end, "select");
    ta.setSelectionRange(start + open.length, start + open.length + selected.length);
    changed();
  }
  function handleKeydown(event) {
    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    if (popOpen) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        selectedSuggestion = (selectedSuggestion + (key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length;
        drawSuggestions();
        return;
      }
      if (key === "Enter" || key === "Tab") { event.preventDefault(); acceptSuggestion(); return; }
      if (key === "Escape") { event.preventDefault(); closePop(); return; }
    }
    if (ctrl) {
      const lower = key.toLowerCase();
      if (key === "Enter") { event.preventDefault(); onRun(); return; }
      if (lower === "f") { event.preventDefault(); showSearch(false, true); return; }
      if (lower === "r") { event.preventDefault(); showSearch(true, true); return; }
      if (lower === "g") { event.preventDefault(); showGoToLine(); return; }
      if (key === " ") { event.preventDefault(); suggest(true); return; }
      if (lower === "/") {
        event.preventDefault();
        const start = ta.selectionStart, end = ta.selectionEnd;
        const text = value();
        const rowStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
        const rowEndIndex = text.indexOf("\n", end);
        const rowEnd = rowEndIndex < 0 ? text.length : rowEndIndex;
        const selected = text.slice(rowStart, rowEnd).split("\n").map(line => line.startsWith("<!--") ? line.replace(/^<!--\s?/, "").replace(/\s?-->$/, "") : "<!-- " + line + " -->").join("\n");
        insertText(selected, rowStart, rowEnd);
        return;
      }
      // Let the browser handle native cut/copy/paste/select-all/undo/redo so
      // Android selection and desktop editing stay consistent.
      if (["a", "c", "x", "v", "z", "y"].includes(lower)) return;
    }
    if (key === "Escape") { closePop(); return; }
    if (key === "Tab") { event.preventDefault(); indentSelection(shift); return; }
    if (key === "Enter" && !event.isComposing) { event.preventDefault(); autoIndentEnter(); return; }
    if (["(", "[", "{"].includes(key)) {
      const closing = { "(": ")", "[": "]", "{": "}" }[key];
      event.preventDefault(); insertPair(key, closing); return;
    }
    if (["'", '"', "`"].includes(key) && !hasSelection()) {
      const next = value()[ta.selectionStart] || "";
      const previous = value()[ta.selectionStart - 1] || "";
      if (!/[A-Za-z0-9_$]/.test(previous) && (!next || /[\s)\]};,]/.test(next))) {
        event.preventDefault(); insertText(key + key, ta.selectionStart, ta.selectionEnd, 1); return;
      }
    }
    if (key === ">" && !hasSelection()) {
      const prefix = value().slice(0, ta.selectionStart);
      const match = /<([A-Za-z][\w:-]*)(?:\s+[^<>]*)?$/.exec(prefix);
      if (match) {
        const tagName = match[1];
        const isQuestionnaire = ["choices", "fillin", "enumeration", "connect", "flashcard"].includes(tagName.toLowerCase());
        if (!tagName.endsWith(":") && !isQuestionnaire && !VOID_TAGS.has(tagName.toLowerCase())) {
          event.preventDefault();
          insertText("></" + tagName + ">", ta.selectionStart, ta.selectionEnd, 1);
          return;
        }
      }
    }
    // Normal arrows, long-press selection, character insertion, deletion and
    // browser-managed context menus deliberately remain native.
  }

  function compileSearchRegex(global = false) {
    const query = findInput.value;
    if (!query) return null;
    const escaped = findRegex.checked ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped, (findCase.checked ? "" : "i") + (global ? "g" : ""));
  }
  function rebuildMatches() {
    findMatches = [];
    try {
      const regex = compileSearchRegex(true);
      if (!regex) { findStatus.textContent = ""; return; }
      let match;
      while ((match = regex.exec(value()))) {
        findMatches.push({ start: match.index, end: match.index + match[0].length });
        if (!match[0].length) regex.lastIndex++;
        if (findMatches.length > 10000) break;
      }
      findInput.classList.remove("invalid");
      findStatus.classList.remove("error");
      findStatus.textContent = findMatches.length ? `${findMatches.length} match(es)` : "No matches";
    } catch (error) {
      findInput.classList.add("invalid");
      findStatus.classList.add("error");
      findStatus.textContent = "Invalid regex";
    }
  }
  function findMatch(backwards = false) {
    rebuildMatches();
    if (!findMatches.length) return;
    const from = backwards ? ta.selectionStart - 1 : ta.selectionEnd;
    let index = backwards ? -1 : -1;
    if (backwards) {
      for (let i = findMatches.length - 1; i >= 0; i--) if (findMatches[i].start < from) { index = i; break; }
      if (index < 0) index = findMatches.length - 1;
    } else {
      index = findMatches.findIndex(item => item.start >= from);
      if (index < 0) index = 0;
    }
    activeFind = index;
    const match = findMatches[index];
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(match.start, match.end);
    ta.scrollTop = Math.max(0, (value().slice(0, match.start).match(/\n/g) || []).length * LH - LH * 2);
    refreshView();
    findStatus.textContent = `${index + 1} of ${findMatches.length}`;
  }
  function showSearch(replace = false, prefillSelection = false) {
    const selected = prefillSelection && hasSelection() ? value().slice(ta.selectionStart, ta.selectionEnd) : "";
    searchBar.hidden = false;
    replaceRow.hidden = !replace;
    if (selected && selected.length < 10000) findInput.value = selected;
    rebuildMatches();
    findInput.focus();
    findInput.select();
  }
  function hideSearch() {
    searchBar.hidden = true;
    findMatches = [];
    activeFind = -1;
    findInput.classList.remove("invalid");
    findStatus.classList.remove("error");
    findStatus.textContent = "";
    closePop();
    ta.focus({ preventScroll: true });
  }
  function replaceOneMatch() {
    const query = findInput.value;
    if (!query) return;
    rebuildMatches();
    if (!findMatches.length) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = value().slice(start, end);
    let replacement = replaceInput.value;
    if (findRegex.checked) {
      try { replacement = selected.replace(new RegExp(query, findCase.checked ? "" : "i"), replaceInput.value); }
      catch (_) { findInput.classList.add("invalid"); findStatus.classList.add("error"); findStatus.textContent = "Invalid regex"; return; }
    }
    if (!findMatches.some(match => match.start === start && match.end === end)) { findMatch(false); return; }
    insertText(replacement, start, end);
    rebuildMatches();
    findMatch(false);
  }
  function replaceAllMatches() {
    try {
      const countRegex = compileSearchRegex(true);
      if (!countRegex) return;
      const before = value();
      let count = 0, match;
      while ((match = countRegex.exec(before))) {
        count++;
        if (!match[0].length) countRegex.lastIndex++;
      }
      const replaceRegex = compileSearchRegex(true);
      const after = before.replace(replaceRegex, replaceInput.value);
      if (count) {
        const oldCursor = ta.selectionStart;
        ta.value = after;
        const caret = Math.min(oldCursor, after.length);
        ta.setSelectionRange(caret, caret);
        changed();
      }
      rebuildMatches();
      findStatus.textContent = `Replaced ${count} occurrence(s)`;
    } catch (_) {
      findInput.classList.add("invalid"); findStatus.classList.add("error"); findStatus.textContent = "Invalid regex";
    }
  }
  function showGoToLine() {
    gotoBar.hidden = false;
    gotoInput.value = String(currentLineInfo().line + 1);
    gotoStatus.textContent = `1–${value().split("\n").length}`;
    gotoInput.focus();
    gotoInput.select();
  }
  function commitGoToLine() {
    const parsed = Number.parseInt(gotoInput.value, 10);
    if (!Number.isFinite(parsed)) { gotoStatus.textContent = "Enter a line number"; return; }
    const lines = value().split("\n");
    const targetLine = clamp(parsed, 1, lines.length) - 1;
    const lineStart = lines.slice(0, targetLine).reduce((sum, line) => sum + line.length + 1, 0);
    gotoBar.hidden = true;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(lineStart, lineStart);
    ta.scrollTop = Math.max(0, targetLine * LH - LH * 2);
    refreshView();
  }

  ta.addEventListener("input", () => {
    refreshView();
    onChange();
  });
  ta.addEventListener("keydown", handleKeydown);
  ta.addEventListener("keyup", event => {
    updatePosition();
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) suggest(false);
  });
  ta.addEventListener("click", () => { updatePosition(); suggest(false); });
  ta.addEventListener("select", updatePosition);
  ta.addEventListener("scroll", syncScroll, { passive: true });
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta && !pop.contains(document.activeElement)) closePop(); }, 120));
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === ta) updatePosition();
  });
  $("findNext").addEventListener("click", () => findMatch(false));
  $("findPrev").addEventListener("click", () => findMatch(true));
  $("replaceOne").addEventListener("click", replaceOneMatch);
  $("replaceAll").addEventListener("click", replaceAllMatches);
  $("closeSearch").addEventListener("click", hideSearch);
  findInput.addEventListener("input", () => { activeFind = -1; rebuildMatches(); });
  findCase.addEventListener("change", rebuildMatches);
  findRegex.addEventListener("change", rebuildMatches);
  findInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); findMatch(event.shiftKey); } if (event.key === "Escape") hideSearch(); });
  replaceInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); replaceOneMatch(); } if (event.key === "Escape") hideSearch(); });
  $("gotoGo").addEventListener("click", commitGoToLine);
  $("gotoClose").addEventListener("click", () => { gotoBar.hidden = true; ta.focus({ preventScroll: true }); });
  gotoInput.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commitGoToLine(); } if (event.key === "Escape") { event.preventDefault(); gotoBar.hidden = true; ta.focus({ preventScroll: true }); } });
  window.addEventListener("resize", () => { CHAR_W = measureCharWidth(); syncScroll(); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", () => { if (popOpen) positionPopup(); });

  return {
    init(options) { onRun = options.onRun || onRun; onChange = options.onChange || onChange; },
    getValue: value,
    setValue(text) {
      closePop();
      ta.value = normalize(text);
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0; ta.scrollLeft = 0;
      refreshView(true);
    },
    focus() { ta.focus({ preventScroll: true }); },
    showFind() { showSearch(false, true); },
    showReplace() { showSearch(true, true); },
    showSuggestions() { ta.focus({ preventScroll: true }); suggest(true); },
    openGoToLine: showGoToLine,
    refresh: refreshView,
    foldAll() {},
    unfoldAll() {}
  };
})();

window.Editor = Editor;
