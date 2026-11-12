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
  const VOID_TAGS = new Set([...(LANG.voidTags || []), "area", "base", "col", "embed", "param", "track", "wbr"].map(value => String(value).toLowerCase()));
  const TAG_MAP = new Map(TAGS.map(tag => [String(tag.name).toLowerCase(), tag]));
  // Recognize native HTML, SVG, and MathML element names even when they are
  // not part of the SGML completion vocabulary. Custom-element names are
  // valid HTML too, so hyphenated names are accepted as recognized tags.
  const HTML_TAG_NAMES = new Set((
    "a abbr acronym address applet area article aside audio b base basefont bdi bdo bgsound big blink " +
    "blockquote body br button canvas caption center cite code col colgroup command content data datalist dd del details " +
    "dfn dialog dir div dl dt em embed fieldset figcaption figure font footer form frame frameset h1 h2 h3 " +
    "h4 h5 h6 head header hgroup hr html i iframe img input ins isindex kbd label legend li link listing " +
    "main map mark marquee menu menuitem meta meter nav nobr noembed noframes noscript object ol optgroup " +
    "element fencedframe keygen option output p param picture plaintext portal pre progress q rb rp rt rtc ruby s samp script search section " +
    "select slot small source span strike strong style sub summary sup table tbody td template textarea tfoot " +
    "selectedcontent shadow spacer th thead time title tr track tt u ul var video wbr xmp " +
    "animate animateMotion animateTransform circle clipPath defs desc discard ellipse feBlend feColorMatrix " +
    "feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight " +
    "feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode " +
    "feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence filter foreignObject " +
    "g image line linearGradient marker mask metadata mpath path pattern polygon polyline radialGradient rect " +
    "set stop svg switch symbol text textPath tspan use view " +
    "math maction maligngroup malignmark menclose merror mfenced mfrac mi mmultiscripts mn mo mover mpadded " +
    "mphantom mprescripts mroot mrow ms msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover"
  ).split(/\s+/).map(name => name.toLowerCase()));
  // The document root is an ordinary, valid HTML element, not an unknown SGML tag.
  HTML_TAG_NAMES.add("html");
  const ATTR_MAP = new Map(ATTRS.map(attr => [String(attr.name).toLowerCase(), attr]));
  const SNIPPET_MAP = new Map(SNIPPETS.map(item => [String(item.trigger).toLowerCase(), item]));
  const LH = 18, PL = 8, PC = 72;
  const TOKEN_LEXICAL = /<!--[\s\S]*?(?:-->|$)|```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|<\s*\/?\s*[A-Za-z][\w:-]*|#[\da-fA-F]{3,8}\b|\b(?:true|false|null)\b|\b[A-Za-z_][\w:-]*(?=\s*[:=])/g;
  let CHAR_W = measureCharWidth();
  let onRun = () => {}, onChange = () => {};
  let suggestions = [], selectedSuggestion = 0, popOpen = false, replaceTokenStart = 0, replaceTokenEnd = 0;
  let suppressSuggestions = false, findMatches = [], activeFind = -1, renderFrame = 0, renderTimer = 0, suggestTimer = 0;
  let lastSuggestionContext = "", popupScrollTimer = 0, lockPopupScrollSelection = false;
  let renderedLineCount = -1, currentLineCount = 1;
  // Source offsets for fast O(log n) line/column lookup. These are updated
  // from each edit rather than rebuilding a line index on every cursor move.
  let sourceLineStarts = [0];
  let displayLineText = null, displayLineStarts = [0];
  let lineIndexDirty = false;
  let candidatesDirty = true, gutterDirty = true;
  // sourceText always contains the complete document. The textarea contains a
  // visual projection of it while folds are closed, so native caret geometry
  // stays aligned with the lines that are actually visible.
  let sourceText = "";
  let projectionState = { text: "", segments: [], candidates: [], visibleFolds: [] };
  let foldedRanges = [];
  let gutterFoldActions = [];

  // The browser's native undo stack is reset whenever a projected value is
  // assigned to the textarea. Keep our own edit history so folds, mobile input,
  // and programmatic edits all share one predictable undo/redo path.
  const undoStack = [], redoStack = [];
  const MAX_UNDO_ENTRIES = 120;
  let historyBaseline = null;
  let pendingHistoryState = null;
  let pendingInputType = '';
  let pendingProgrammaticState = null;
  let ignoreNextNativeHistoryInput = '';
  const FOLD_STORAGE_PREFIX = 'sgml_editor_fold_state_v1:';

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
  function lowerBound(array, value) {
    let low = 0, high = array.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (array[middle] < value) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  function upperBound(array, value) {
    let low = 0, high = array.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (array[middle] <= value) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  function rebuildLineIndex(text) {
    sourceLineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) sourceLineStarts.push(i + 1);
    }
    lineIndexDirty = false;
    currentLineCount = sourceLineStarts.length;
  }
  function updateLineIndexForEdit(start, end, insertion) {
    if (lineIndexDirty) rebuildLineIndex(sourceText);
    const delta = insertion.length - (end - start);
    const prefixEnd = upperBound(sourceLineStarts, start);
    // A line-start at `end` is caused by the newline immediately before it.
    // If that newline is part of the removed range, discard that old boundary;
    // any replacement newline boundaries are added from `insertion` below.
    const removedEndingNewline = end > start && sourceText.charCodeAt(end - 1) === 10;
    const suffixStart = end === start
      ? upperBound(sourceLineStarts, start)
      : lowerBound(sourceLineStarts, end + (removedEndingNewline ? 1 : 0));
    const next = sourceLineStarts.slice(0, prefixEnd);
    for (let i = 0; i < insertion.length; i++) {
      if (insertion.charCodeAt(i) === 10) next.push(start + i + 1);
    }
    for (let i = suffixStart; i < sourceLineStarts.length; i++) {
      const shifted = sourceLineStarts[i] + delta;
      if (shifted > next[next.length - 1]) next.push(shifted);
    }
    sourceLineStarts = next.length ? next : [0];
    currentLineCount = sourceLineStarts.length;
  }
  function currentLineInfo(displayOffset = ta.selectionEnd) {
    const offset = displayToSource(displayOffset, "left");
    const safeOffset = clamp(offset, 0, sourceText.length);
    const line = Math.max(0, upperBound(sourceLineStarts, safeOffset) - 1);
    const lineStart = sourceLineStarts[line] || 0;
    return { line, column: safeOffset - lineStart, lineStart, offset: safeOffset };
  }
  const currentLineText = (displayOffset = ta.selectionEnd) => {
    const info = currentLineInfo(displayOffset);
    const end = sourceText.indexOf("\n", info.offset);
    return sourceText.slice(info.lineStart, end < 0 ? sourceText.length : end);
  };
  const closePop = () => { popOpen = false; lastSuggestionContext = ""; if (popupScrollTimer) clearTimeout(popupScrollTimer); popupScrollTimer = 0; pop.style.display = "none"; pop.innerHTML = ""; };

  const JS_KEYWORDS = new Set((
    "as async await break case catch class const continue debugger default delete do else export extends " +
    "finally for from function get if import in instanceof let new of return set static super switch " +
    "this throw try typeof var void while with yield enum implements interface package private " +
    "protected public nullish"
  ).split(/\s+/));
  const JS_LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);
  const JS_BUILTINS = new Set((
    "Array ArrayBuffer BigInt Boolean Date Error EvalError Float32Array Float64Array Function " +
    "Int8Array Int16Array Int32Array Map Math Number Object Promise Proxy RangeError ReferenceError " +
    "RegExp Set String Symbol SyntaxError TypeError Uint8Array Uint16Array Uint32Array WeakMap " +
    "WeakSet JSON Reflect Intl console window document globalThis undefined parseInt parseFloat " +
    "isNaN isFinite alert confirm prompt setTimeout clearTimeout setInterval clearInterval " +
    "fetch URL URLSearchParams Blob File FormData Headers Request Response TextEncoder TextDecoder " +
    "performance navigator localStorage sessionStorage location history HTMLElement Node Event CustomEvent"
  ).split(/\s+/));
  const JS_TOKEN_LEXICAL = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|(?:\b0[xX][\da-fA-F]+\b|\b\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?n?|[$A-Z_a-z][$\w]*|===|!==|=>|==|!=|<=|>=|\+\+|--|\+=|-=|\*=|\/=|&&|\|\||\?\?|\?\.|\*\*|[{}()[\].,;:?~+\-*\/%<>=!&|^]/g;

  function jsTokenHtml(text) {
    const spans = [];
    JS_TOKEN_LEXICAL.lastIndex = 0;
    let match, pendingBinding = "", previousToken = "";
    while ((match = JS_TOKEN_LEXICAL.exec(text))) {
      const raw = match[0];
      let cls = "js-punct";
      if (raw.startsWith("//") || raw.startsWith("/*")) {
        cls = "com";
      } else if (raw[0] === "'" || raw[0] === '"' || raw[0] === '`') {
        cls = "str";
      } else if (/^(?:\d|\.\d)/.test(raw)) {
        cls = "num";
      } else if (/^[$A-Z_a-z][$\w]*$/.test(raw)) {
        const next = text.slice(JS_TOKEN_LEXICAL.lastIndex).match(/^\s*(.)/);
        const nextChar = next ? next[1] : "";
        if (JS_KEYWORDS.has(raw)) {
          cls = "js-keyword";
          if (raw === "const" || raw === "let" || raw === "var") pendingBinding = "js-variable-decl";
          else if (raw === "function") pendingBinding = "js-function";
          else if (raw === "class") pendingBinding = "js-class";
        } else if (JS_LITERALS.has(raw)) {
          cls = "js-literal";
        } else if (pendingBinding) {
          cls = pendingBinding;
          pendingBinding = "";
        } else if (nextChar === ":") {
          cls = "js-key";
        } else if (nextChar === "(") {
          cls = "js-function";
        } else if (previousToken === "." || previousToken === "?.") {
          cls = "js-property";
        } else if (JS_BUILTINS.has(raw)) {
          cls = "js-builtin";
        } else {
          cls = "js-variable";
        }
      } else if (/^(?:===|!==|=>|==|!=|<=|>=|\+\+|--|\+=|-=|\*=|\/=|&&|\|\||\?\?|\?\.|\*\*|[+\-*\/%<>=!&|^])$/.test(raw)) {
        cls = "js-operator";
      }
      spans.push({ start: match.index, end: match.index + raw.length, raw, cls });
      if (!/^\s+$/.test(raw)) previousToken = raw;
    }

    let out = "", offset = 0;
    for (const span of spans) {
      if (span.start < offset) continue;
      out += esc(text.slice(offset, span.start));
      out += '<span class="' + span.cls + '">' + esc(span.raw) + '</span>';
      offset = span.end;
    }
    return out + esc(text.slice(offset));
  }

  // Find </js> without mistaking the same text inside a JavaScript string or
  // comment for the SGML closing tag. Template strings are treated as strings.
  function findJsClose(text, start) {
    let quote = "", escaped = false, lineComment = false, blockComment = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i], next = text[i + 1] || "";
      if (lineComment) {
        if (ch === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (ch === "*" && next === "/") { blockComment = false; i++; }
        continue;
      }
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "/" && next === "/") { lineComment = true; i++; continue; }
      if (ch === "/" && next === "*") { blockComment = true; i++; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === "<" && /^<\/js\s*>/i.test(text.slice(i))) return i;
    }
    return -1;
  }

  function sgmlTokenHtml(text) {
    const spans = [];
    TOKEN_LEXICAL.lastIndex = 0;
    let match;
    while ((match = TOKEN_LEXICAL.exec(text))) {
      const raw = match[0];
      let cls = "";
      if (raw.startsWith("<!--") || raw.startsWith("```") || raw.startsWith("~~~")) cls = "com";
      else if (raw[0] === '"' || raw[0] === "'" || raw[0] === '`') cls = "str";
      else if (raw[0] === "<") {
        const nameMatch = /<\s*\/?\s*([A-Za-z][\w:-]*)/.exec(raw);
        const name = nameMatch ? nameMatch[1] : "";
        const normalizedName = name.toLowerCase();
        cls = normalizedName === "html" || TAG_MAP.has(normalizedName) || HTML_TAG_NAMES.has(normalizedName) || normalizedName.includes("-")
          ? "tagname"
          : "unknown-tag";
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
    return out + esc(text.slice(offset));
  }

  function tokenHtml(text) {
    const openTag = /<js\s*>/ig;
    let out = "", cursor = 0, opening;
    while ((opening = openTag.exec(text))) {
      out += sgmlTokenHtml(text.slice(cursor, opening.index));
      const bodyStart = openTag.lastIndex;
      out += sgmlTokenHtml(text.slice(opening.index, bodyStart));
      const closeStart = findJsClose(text, bodyStart);
      if (closeStart < 0) {
        out += jsTokenHtml(text.slice(bodyStart));
        cursor = text.length;
        break;
      }
      out += jsTokenHtml(text.slice(bodyStart, closeStart));
      const closeEndMatch = /^<\/js\s*>/i.exec(text.slice(closeStart));
      const closeEnd = closeStart + (closeEndMatch ? closeEndMatch[0].length : 0);
      out += sgmlTokenHtml(text.slice(closeStart, closeEnd));
      cursor = closeEnd;
      openTag.lastIndex = closeEnd;
    }
    return out + (cursor < text.length ? sgmlTokenHtml(text.slice(cursor)) : "");
  }

  // ---------------------------------------------------------------------------
  // Source folding. Folded content is never deleted: it is represented by a
  // single placeholder in the textarea projection and restored before editing.
  // ---------------------------------------------------------------------------
  function mergeRanges(ranges) {
    const sorted = ranges.filter(range => range && range.end > range.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else merged.push({ start: range.start, end: range.end });
    }
    return merged;
  }

  function makeLineFold(text, start, openEnd, closeStart, end, kind, label) {
    const firstNewline = text.indexOf("\n", openEnd);
    if (firstNewline < 0 || firstNewline >= closeStart) return null;
    const innerStart = firstNewline + 1;
    const closeLineStart = text.lastIndexOf("\n", Math.max(0, closeStart - 1)) + 1;
    if (closeLineStart < innerStart) return null;
    return {
      kind,
      label: label || kind,
      start,
      end: Math.max(end, closeStart),
      innerStart,
      innerEnd: closeLineStart
    };
  }

  function scanTagEnd(text, start) {
    let quote = "";
    for (let i = start + 1; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = "";
        else if (ch === "\\" && quote !== "`" && i + 1 < text.length) i++;
        continue;
      }
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch === ">") return i + 1;
    }
    return -1;
  }

  function lineBounds(text, offset) {
    const start = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
    const newline = text.indexOf("\n", offset);
    return { start, end: newline < 0 ? text.length : newline };
  }

  function collectJsRanges(text) {
    const ranges = [];
    const opening = /<js\s*>/ig;
    let match;
    while ((match = opening.exec(text))) {
      const bodyStart = opening.lastIndex;
      const closeStart = findJsClose(text, bodyStart);
      const end = closeStart < 0 ? text.length : closeStart;
      ranges.push({ start: match.index, bodyStart, end, closeStart });
      if (closeStart < 0) break;
      const close = /^<\/js\s*>/i.exec(text.slice(closeStart));
      opening.lastIndex = closeStart + (close ? close[0].length : 1);
    }
    return ranges;
  }

  function findFencedRanges(text, jsRanges) {
    const folds = [], skipped = [];
    let offset = 0;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = offset;
      const lineEnd = lineStart + line.length;
      offset = lineEnd + (i < lines.length - 1 ? 1 : 0);
      if (jsRanges.some(range => lineStart >= range.bodyStart && lineStart < range.end)) continue;
      const opening = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
      if (!opening) continue;
      const marker = opening[1];
      const markerChar = marker[0];
      const markerLength = marker.length;
      let closeIndex = -1, closeStart = -1, closeEnd = -1;
      let scanOffset = offset;
      for (let j = i + 1; j < lines.length; j++) {
        const candidate = lines[j];
        const closePattern = new RegExp("^[ \t]*" + (markerChar === "`" ? "`" : "~") + "{" + markerLength + ",}[ \t]*$");
        if (closePattern.test(candidate)) {
          closeIndex = j;
          closeStart = scanOffset;
          closeEnd = scanOffset + candidate.length;
          break;
        }
        scanOffset += candidate.length + (j < lines.length - 1 ? 1 : 0);
      }
      if (closeIndex < 0) continue;
      const fold = makeLineFold(text, lineStart, lineEnd, closeStart, closeEnd, "fence-" + (markerChar === "`" ? "backtick" : "tilde"), "code fence");
      if (fold) {
        folds.push(fold);
        skipped.push({ start: lineStart, end: closeEnd + (closeIndex < lines.length - 1 ? 1 : 0) });
      }
      i = closeIndex;
      offset = closeEnd + (closeIndex < lines.length - 1 ? 1 : 0);
    }
    return { folds, skipped };
  }

  function collectXmlComments(text, excludedRanges) {
    const folds = [], skipped = [];
    let i = 0;
    while (i < text.length) {
      const excluded = excludedRanges.find(range => i >= range.start && i < range.end);
      if (excluded) { i = excluded.end; continue; }
      if (text.startsWith("<!--", i)) {
        const close = text.indexOf("-->", i + 4);
        if (close < 0) break;
        const end = close + 3;
        const fold = makeLineFold(text, i, i + 4, close, end, "xml-comment", "comment");
        if (fold) folds.push(fold);
        skipped.push({ start: i, end });
        i = end;
        continue;
      }
      i++;
    }
    return { folds, skipped };
  }

  function collectXmlTagFolds(text, excludedRanges) {
    const folds = [];
    const stack = [];
    let i = 0, rangeIndex = 0;
    const excluded = excludedRanges.slice().sort((a, b) => a.start - b.start);
    while (i < text.length) {
      while (rangeIndex < excluded.length && excluded[rangeIndex].end <= i) rangeIndex++;
      const range = excluded[rangeIndex];
      if (range && i >= range.start && i < range.end) { i = range.end; continue; }
      if (text[i] !== "<") { i++; continue; }
      if (text.startsWith("<!--", i) || text.startsWith("<![CDATA[", i) || text.startsWith("<?", i) || text.startsWith("<!", i)) {
        const close = text.startsWith("<!--", i) ? text.indexOf("-->", i + 4) :
          text.startsWith("<![CDATA[", i) ? text.indexOf("]]>", i + 9) : text.indexOf(">", i + 2);
        if (close < 0) break;
        i = text.startsWith("<!--", i) || text.startsWith("<![CDATA[", i) ? close + 3 : close + 1;
        continue;
      }
      const tagEnd = scanTagEnd(text, i);
      if (tagEnd < 0) break;
      const raw = text.slice(i, tagEnd);
      const parsed = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)\b([\s\S]*?)>$/.exec(raw);
      if (!parsed) { i = tagEnd; continue; }
      const closing = parsed[1] === "/";
      const name = parsed[2].toLowerCase();
      const selfClosing = /\/\s*>$/.test(raw);
      if (closing) {
        let matchIndex = -1;
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j].name === name) { matchIndex = j; break; }
        }
        if (matchIndex >= 0) {
          const open = stack[matchIndex];
          stack.length = matchIndex;
          const fold = makeLineFold(text, open.start, open.end, i, tagEnd, name === "js" ? "js-tag" : "xml-tag:" + name, "<" + name + ">");
          if (fold) folds.push(fold);
        }
      } else if (!selfClosing && !VOID_TAGS.has(name)) {
        stack.push({ name, start: i, end: tagEnd });
      }
      i = tagEnd;
    }
    return folds;
  }

  function collectJsFolds(text, jsRanges) {
    const folds = [];
    const pairs = { "(": ")", "[": "]", "{": "}" };
    for (const range of jsRanges) {
      const stack = [];
      let i = range.bodyStart;
      while (i < range.end) {
        const ch = text[i], next = text[i + 1] || "";
        if (ch === "/" && next === "/") {
          const first = lineBounds(text, i);
          let last = first;
          let cursor = first.end;
          let count = 1;
          while (cursor < range.end && text[cursor] === "\n") {
            const nextLine = lineBounds(text, cursor + 1);
            const nextContent = text.slice(nextLine.start, nextLine.end);
            if (!/^[ \t]*\/\//.test(nextContent)) break;
            last = nextLine;
            count++;
            cursor = nextLine.end;
          }
          if (count >= 3) {
            const fold = makeLineFold(text, first.start, first.end, last.start, last.end, "js-line-comment", "line comments");
            if (fold) folds.push(fold);
          }
          i = first.end;
          continue;
        }
        if (ch === "/" && next === "*") {
          const close = text.indexOf("*/", i + 2);
          const closeStart = close < 0 || close >= range.end ? range.end : close;
          const closeEnd = closeStart < range.end ? closeStart + 2 : range.end;
          const fold = closeStart < range.end ? makeLineFold(text, i, i + 2, closeStart, closeEnd, "js-block-comment", "block comment") : null;
          if (fold) folds.push(fold);
          i = closeEnd;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === "`") {
          const quote = ch;
          i++;
          let escaped = false;
          while (i < range.end) {
            const current = text[i++];
            if (escaped) { escaped = false; continue; }
            if (current === "\\") { escaped = true; continue; }
            if (current === quote) break;
          }
          continue;
        }
        if (pairs[ch]) {
          stack.push({ char: ch, start: i });
          i++;
          continue;
        }
        if (ch === ")" || ch === "]" || ch === "}") {
          const top = stack[stack.length - 1];
          if (top && pairs[top.char] === ch) {
            stack.pop();
            let kind = "js-bracket-" + top.char;
            if (top.char === "{") {
              const prefixStart = Math.max(range.bodyStart, text.lastIndexOf(";", top.start - 1) + 1, text.lastIndexOf("}", top.start - 1) + 1);
              const prefix = text.slice(prefixStart, top.start);
              if (/\bfunction(?:\s+[$\w]+)?\s*\([\s\S]*\)\s*$/.test(prefix) || /(?:\([^)]*\)|[$\w]+)\s*=>\s*$/.test(prefix)) {
                kind = "js-function";
              } else {
                kind = "js-brace";
              }
            }
            const foldLabel = kind === "js-function" ? "function" :
              top.char === "{" ? "curly brace block" : top.char === "[" ? "square bracket block" : "parentheses block";
            const fold = makeLineFold(text, top.start, top.start + 1, i, i + 1, kind, foldLabel);
            if (fold) folds.push(fold);
          }
          i++;
          continue;
        }
        i++;
      }
    }
    return folds;
  }

  function collectFoldCandidates(text) {
    if (!text) return [];
    const jsRanges = collectJsRanges(text);
    const fenceResult = findFencedRanges(text, jsRanges);
    const commentResult = collectXmlComments(text, mergeRanges(jsRanges.map(range => ({ start: range.bodyStart, end: range.end })).concat(fenceResult.skipped)));
    const nonTagRanges = mergeRanges(
      jsRanges.map(range => ({ start: range.bodyStart, end: range.end }))
        .concat(fenceResult.skipped, commentResult.skipped)
    );
    const folds = [
      ...fenceResult.folds,
      ...commentResult.folds,
      ...collectXmlTagFolds(text, nonTagRanges),
      ...collectJsFolds(text, jsRanges)
    ];
    const unique = new Map();
    for (const fold of folds) {
      if (!fold || fold.innerStart > fold.innerEnd) continue;
      const key = fold.kind + "@" + fold.start;
      if (!unique.has(key)) unique.set(key, fold);
    }
    return [...unique.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  }

  function sourceLineAt(text, offset) {
    if (text !== sourceText || lineIndexDirty) {
      let line = 0;
      for (let i = 0; i < Math.min(offset, text.length); i++) if (text.charCodeAt(i) === 10) line++;
      return line;
    }
    return Math.max(0, upperBound(sourceLineStarts, clamp(offset, 0, text.length)) - 1);
  }

  function displayToSource(offset, bias = "left", state = projectionState) {
    offset = clamp(offset, 0, state.text.length);
    for (const segment of state.segments) {
      if (segment.type === "text") {
        if (offset >= segment.displayStart && offset <= segment.displayEnd) {
          return segment.sourceStart + (offset - segment.displayStart);
        }
      } else {
        if (offset <= segment.displayStart) return segment.sourceStart;
        if (offset >= segment.displayEnd) continue;
        return bias === "right" ? segment.sourceEnd : segment.sourceStart;
      }
    }
    return sourceText.length;
  }

  function sourceToDisplay(offset, bias = "left", state = projectionState) {
    offset = clamp(offset, 0, sourceText.length);
    for (const segment of state.segments) {
      if (segment.type === "text") {
        if (offset >= segment.sourceStart && offset <= segment.sourceEnd) {
          return segment.displayStart + (offset - segment.sourceStart);
        }
      } else {
        if (offset <= segment.sourceStart) return segment.displayStart;
        if (offset >= segment.sourceEnd) continue;
        return bias === "right" ? segment.displayEnd : segment.displayStart;
      }
    }
    return state.text.length;
  }

  function buildProjection(text, suppliedCandidates = null) {
    const candidates = suppliedCandidates || collectFoldCandidates(text);
    const foldedKeys = new Set(foldedRanges.map(item => item.kind + "@" + item.start));
    const collapsed = candidates.filter(item => foldedKeys.has(item.kind + "@" + item.start))
      .sort((a, b) => a.innerStart - b.innerStart || b.innerEnd - a.innerEnd);
    const visibleCollapsed = [];
    for (const item of collapsed) {
      if (visibleCollapsed.some(parent => item.start >= parent.innerStart && item.start < parent.innerEnd)) continue;
      visibleCollapsed.push(item);
    }

    const segments = [];
    let display = "", sourceCursor = 0;
    const addText = (start, end) => {
      if (end <= start) return;
      const piece = text.slice(start, end);
      segments.push({ type: "text", sourceStart: start, sourceEnd: end, displayStart: display.length, displayEnd: display.length + piece.length });
      display += piece;
    };
    for (const fold of visibleCollapsed) {
      if (fold.innerStart < sourceCursor) continue;
      addText(sourceCursor, fold.innerStart);
      const firstLineEnd = text.indexOf("\n", fold.innerStart);
      const firstLine = text.slice(fold.innerStart, firstLineEnd < 0 ? fold.innerEnd : firstLineEnd);
      const indent = /^[ \t]*/.exec(firstLine)[0];
      const marker = indent + "...\n";
      segments.push({
        type: "fold",
        sourceStart: fold.innerStart,
        sourceEnd: fold.innerEnd,
        displayStart: display.length,
        displayEnd: display.length + marker.length,
        fold
      });
      display += marker;
      sourceCursor = fold.innerEnd;
    }
    addText(sourceCursor, text.length);

    return { text: display, segments, candidates, visibleFolds: visibleCollapsed };
  }

  function foldIsHidden(candidate, state = projectionState) {
    return state.visibleFolds.some(parent => candidate.start >= parent.innerStart && candidate.start < parent.innerEnd);
  }

  function getFoldStorageKey() {
    let documentId = '';
    try { documentId = localStorage.getItem('sgml_viewer_current_id') || ''; } catch (_) {}
    return FOLD_STORAGE_PREFIX + (documentId || 'unassigned');
  }
  function persistFoldState() {
    try {
      localStorage.setItem(getFoldStorageKey(), JSON.stringify({
        version: 1,
        folds: foldedRanges.map(item => ({ kind: item.kind, start: item.start, end: item.end }))
      }));
    } catch (error) {
      console.warn('Could not save editor fold state:', error);
    }
  }
  function restoreFoldState(text, candidates) {
    foldedRanges = [];
    try {
      const raw = localStorage.getItem(getFoldStorageKey());
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !Array.isArray(saved.folds)) return;
      const candidateMap = new Map(candidates.map(item => [item.kind + '@' + item.start, item]));
      const seen = new Set();
      for (const item of saved.folds) {
        if (!item || typeof item.kind !== 'string' || !Number.isFinite(item.start)) continue;
        const key = item.kind + '@' + item.start;
        const match = candidateMap.get(key);
        if (!match || seen.has(key)) continue;
        foldedRanges.push({ kind: match.kind, start: match.start, end: match.end });
        seen.add(key);
      }
      if (foldedRanges.length !== saved.folds.length) persistFoldState();
    } catch (error) {
      console.warn('Could not restore editor fold state:', error);
      foldedRanges = [];
    }
  }
  function cloneFoldRanges(ranges = foldedRanges) {
    return ranges.map(item => ({ kind: item.kind, start: item.start, end: item.end }));
  }
  function captureHistoryState() {
    const start = displayToSource(ta.selectionStart, 'left');
    const end = ta.selectionStart === ta.selectionEnd ? start : displayToSource(ta.selectionEnd, 'right');
    return { text: sourceText, folds: cloneFoldRanges(), selectionStart: start, selectionEnd: end };
  }
  function beginProgrammaticEdit() {
    if (!pendingProgrammaticState) pendingProgrammaticState = captureHistoryState();
  }
  function makeHistoryEntry(before, after, inputType) {
    if (!before || !after || before.text === after.text) return null;
    let start = 0;
    const limit = Math.min(before.text.length, after.text.length);
    while (start < limit && before.text[start] === after.text[start]) start++;
    let suffix = 0;
    while (suffix < before.text.length - start && suffix < after.text.length - start &&
      before.text[before.text.length - suffix - 1] === after.text[after.text.length - suffix - 1]) suffix++;
    return {
      start,
      removed: before.text.slice(start, before.text.length - suffix),
      inserted: after.text.slice(start, after.text.length - suffix),
      beforeSelectionStart: before.selectionStart,
      beforeSelectionEnd: before.selectionEnd,
      afterSelectionStart: after.selectionStart,
      afterSelectionEnd: after.selectionEnd,
      beforeFolds: cloneFoldRanges(before.folds),
      afterFolds: cloneFoldRanges(after.folds),
      inputType: inputType || '',
      time: Date.now()
    };
  }
  function pushHistory(before, after, inputType) {
    const entry = makeHistoryEntry(before, after, inputType);
    if (!entry) return;
    const previous = undoStack[undoStack.length - 1];
    const canMerge = previous && entry.time - previous.time < 750 &&
      previous.inputType === entry.inputType && entry.inputType === 'insertText' &&
      !previous.removed && !entry.removed && !previous.inserted.includes('\n') &&
      !entry.inserted.includes('\n') && entry.start === previous.start + previous.inserted.length;
    if (canMerge) {
      previous.inserted += entry.inserted;
      previous.afterSelectionStart = entry.afterSelectionStart;
      previous.afterSelectionEnd = entry.afterSelectionEnd;
      previous.afterFolds = entry.afterFolds;
      previous.time = entry.time;
    } else {
      undoStack.push(entry);
      if (undoStack.length > MAX_UNDO_ENTRIES) undoStack.shift();
    }
    redoStack.length = 0;
  }
  function restoreHistoryEntry(entry, undo) {
    const expected = undo ? entry.inserted : entry.removed;
    const replacement = undo ? entry.removed : entry.inserted;
    const end = entry.start + expected.length;
    // A mismatch means something outside the editor changed the source. Never
    // apply a stale patch that could insert unrelated text into the document.
    if (sourceText.slice(entry.start, end) !== expected) {
      console.warn('Editor history entry no longer matches the current source; refusing stale undo/redo.');
      return false;
    }
    const scrollTop = ta.scrollTop, scrollLeft = ta.scrollLeft;
    updateLineIndexForEdit(entry.start, end, replacement);
    sourceText = sourceText.slice(0, entry.start) + replacement + sourceText.slice(end);
    foldedRanges = cloneFoldRanges(undo ? entry.beforeFolds : entry.afterFolds);
    projectionState = buildProjection(sourceText);
    candidatesDirty = false;
    gutterDirty = true;
    const display = projectionState.text;
    if (ta.value !== display) ta.value = display;
    const sourceStart = undo ? entry.beforeSelectionStart : entry.afterSelectionStart;
    const sourceEnd = undo ? entry.beforeSelectionEnd : entry.afterSelectionEnd;
    const displayStart = sourceToDisplay(clamp(sourceStart, 0, sourceText.length), 'left');
    const displayEnd = sourceStart === sourceEnd ? displayStart : sourceToDisplay(clamp(sourceEnd, 0, sourceText.length), 'right');
    ta.setSelectionRange(displayStart, displayEnd);
    ta.scrollTop = scrollTop;
    ta.scrollLeft = scrollLeft;
    persistFoldState();
    refreshView(true);
    historyBaseline = captureHistoryState();
    pendingHistoryState = null;
    pendingInputType = '';
    pendingProgrammaticState = null;
    onChange();
    return true;
  }
  function undo() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || !restoreHistoryEntry(entry, true)) return;
    undoStack.pop();
    redoStack.push(entry);
  }
  function redo() {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || !restoreHistoryEntry(entry, false)) return;
    redoStack.pop();
    undoStack.push(entry);
  }

  function applyProjection(selectionStartSource = null, selectionEndSource = null) {
    const displaySelectionCollapsed = ta.selectionStart === ta.selectionEnd;
    const oldStart = selectionStartSource == null ? displayToSource(ta.selectionStart, "left") : selectionStartSource;
    const oldEnd = selectionEndSource == null
      ? (displaySelectionCollapsed ? oldStart : displayToSource(ta.selectionEnd, "right"))
      : selectionEndSource;
    projectionState = buildProjection(sourceText);
    candidatesDirty = false;
    gutterDirty = true;
    if (ta.value !== projectionState.text) ta.value = projectionState.text;
    const displayStart = sourceToDisplay(oldStart, "left");
    const displayEnd = oldStart === oldEnd ? displayStart : sourceToDisplay(oldEnd, "right");
    ta.setSelectionRange(displayStart, displayEnd);
    refreshView(true);
  }

  function toggleFold(actionIndex) {
    const fold = gutterFoldActions[actionIndex];
    if (!fold) return;
    const selectionStart = displayToSource(ta.selectionStart, "left");
    const selectionEnd = ta.selectionStart === ta.selectionEnd
      ? selectionStart : displayToSource(ta.selectionEnd, "right");
    const key = fold.kind + "@" + fold.start;
    const exists = foldedRanges.some(item => item.kind + "@" + item.start === key);
    if (exists) foldedRanges = foldedRanges.filter(item => item.kind + "@" + item.start !== key);
    else foldedRanges.push({ kind: fold.kind, start: fold.start, end: fold.end });
    applyProjection(selectionStart, selectionEnd);
    persistFoldState();
    historyBaseline = captureHistoryState();
  }

  function revealFoldAtSelection(includeBoundaries = true) {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const marker = projectionState.segments.find(segment => {
      if (segment.type !== "fold") return false;
      if (start === end) return includeBoundaries
        ? start >= segment.displayStart && start <= segment.displayEnd
        : start > segment.displayStart && start < segment.displayEnd;
      return start < segment.displayEnd && end > segment.displayStart;
    });
    if (!marker) return false;
    const rawStart = displayToSource(start, "left");
    const rawEnd = start === end ? rawStart : displayToSource(end, "right");
    const fold = marker.fold;
    foldedRanges = foldedRanges.filter(item => !(item.kind === fold.kind && item.start === fold.start));
    applyProjection(rawStart, rawEnd);
    persistFoldState();
    if (!pendingHistoryState && !pendingProgrammaticState) historyBaseline = captureHistoryState();
    return true;
  }

  function prepareEditableRange(start, end) {
    ta.setSelectionRange(start, end);
    revealFoldAtSelection(false);
    return { start: ta.selectionStart, end: ta.selectionEnd };
  }

  function shiftFoldStates(rawStart, rawEnd, delta) {
    const next = [];
    for (const item of foldedRanges) {
      if (rawEnd <= item.start) next.push({ kind: item.kind, start: item.start + delta, end: item.end + delta });
      else if (rawStart >= item.end) next.push(item);
      // An edit touching a fold's delimiters or hidden body unfolds that block.
    }
    foldedRanges = next;
  }

  function editNeedsFoldRescan(removed, inserted) {
    return /[<>\[\]{}()\/\*\!\"'`~]/.test(String(removed || '') + String(inserted || ''));
  }

  function shiftCandidateDescriptors(candidates, rawStart, rawEnd, insertionLength, delta) {
    const shifted = [];
    const mapPoint = position => {
      if (position <= rawStart) return position;
      if (position >= rawEnd) return position + delta;
      return rawStart + insertionLength;
    };
    for (const item of candidates || []) {
      if (rawEnd <= item.start) {
        shifted.push({
          ...item,
          start: item.start + delta,
          end: item.end + delta,
          innerStart: item.innerStart + delta,
          innerEnd: item.innerEnd + delta
        });
      } else if (rawStart >= item.end) {
        shifted.push(item);
      } else if (item.start < rawStart && rawEnd < item.end) {
        // The edit is inside this candidate, not in its opening/closing tag.
        // Keep an approximate descriptor for the immediate projection; the
        // debounced render reparses the complete source and validates it.
        shifted.push({
          ...item,
          end: mapPoint(item.end),
          innerStart: mapPoint(item.innerStart),
          innerEnd: mapPoint(item.innerEnd)
        });
      }
    }
    return shifted;
  }

  function commitProjectedEdit() {
    const nextDisplay = normalize(ta.value);
    const oldDisplay = projectionState.text;
    if (nextDisplay === oldDisplay) return false;

    let prefix = 0;
    const maxPrefix = Math.min(oldDisplay.length, nextDisplay.length);
    while (prefix < maxPrefix && oldDisplay[prefix] === nextDisplay[prefix]) prefix++;
    let suffix = 0;
    while (suffix < oldDisplay.length - prefix && suffix < nextDisplay.length - prefix &&
      oldDisplay[oldDisplay.length - 1 - suffix] === nextDisplay[nextDisplay.length - 1 - suffix]) suffix++;

    const oldEndDisplay = oldDisplay.length - suffix;
    const newEndDisplay = nextDisplay.length - suffix;
    const rawStart = displayToSource(prefix, 'left', projectionState);
    const rawEnd = displayToSource(oldEndDisplay, 'right', projectionState);
    const insertion = nextDisplay.slice(prefix, newEndDisplay);
    const oldSource = sourceText;
    const newSource = oldSource.slice(0, rawStart) + insertion + oldSource.slice(rawEnd);
    const deltaDisplay = insertion.length - (oldEndDisplay - prefix);
    const deltaSource = insertion.length - (rawEnd - rawStart);
    const newSuffixStart = prefix + insertion.length;
    const oldSelectionStart = ta.selectionStart;
    const oldSelectionEnd = ta.selectionEnd;

    const mapAfterEdit = (position, bias) => {
      if (position <= prefix) return displayToSource(position, bias, projectionState);
      if (position >= newSuffixStart) {
        return displayToSource(position - deltaDisplay, bias, projectionState) + deltaSource;
      }
      return rawStart + (position - prefix);
    };
    const rawSelectionStart = clamp(mapAfterEdit(oldSelectionStart, 'left'), 0, newSource.length);
    const rawSelectionEnd = clamp(mapAfterEdit(oldSelectionEnd, 'right'), 0, newSource.length);

    const removed = oldSource.slice(rawStart, rawEnd);
    const needsFoldRescan = candidatesDirty || editNeedsFoldRescan(removed, insertion);
    updateLineIndexForEdit(rawStart, rawEnd, insertion);
    const fastCandidates = shiftCandidateDescriptors(projectionState.candidates, rawStart, rawEnd, insertion.length, deltaSource);
    shiftFoldStates(rawStart, rawEnd, deltaSource);
    sourceText = newSource;
    // Re-project from cached fold descriptors now; a full syntax/fold scan is
    // deferred to the throttled render pass and only requested for structural
    // characters, rather than on every ordinary text insertion.
    projectionState = buildProjection(sourceText, fastCandidates);
    candidatesDirty = needsFoldRescan;
    gutterDirty = gutterDirty || needsFoldRescan || removed.includes('\n') || insertion.includes('\n');
    // Do not reassign the textarea if the browser's just-edited projection is
    // already correct. Reassigning .value destroys the browser undo stack.
    if (ta.value !== projectionState.text) ta.value = projectionState.text;
    const displayStart = sourceToDisplay(rawSelectionStart, 'left');
    const displayEnd = rawSelectionStart === rawSelectionEnd ? displayStart : sourceToDisplay(rawSelectionEnd, 'right');
    ta.setSelectionRange(displayStart, displayEnd);
    return true;
  }

  function findDisplayLine(text, offset) {
    if (displayLineText !== text) {
      displayLineText = text;
      displayLineStarts = [0];
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) displayLineStarts.push(i + 1);
      }
    }
    return Math.max(0, upperBound(displayLineStarts, clamp(offset, 0, text.length)) - 1);
  }

  function renderGutter() {
    const lines = projectionState.text.split("\n");
    const lineActions = new Map();
    gutterFoldActions = [];
    for (const candidate of projectionState.candidates) {
      if (foldIsHidden(candidate)) continue;
      const displayOffset = sourceToDisplay(candidate.start, "left");
      const line = findDisplayLine(projectionState.text, displayOffset);
      const collapsed = foldedRanges.some(item => item.kind === candidate.kind && item.start === candidate.start);
      const actionIndex = gutterFoldActions.push(candidate) - 1;
      if (!lineActions.has(line)) lineActions.set(line, []);
      lineActions.get(line).push({ actionIndex, collapsed, label: candidate.label });
    }

    const rows = [];
    let displayOffset = 0;
    for (let line = 0; line < lines.length; line++) {
      const rawOffset = displayToSource(displayOffset, "left");
      const sourceLine = sourceLineAt(sourceText, rawOffset) + 1;
      const actions = lineActions.get(line) || [];
      const control = actions.length
        ? '<span class="gutter-fold-controls">' + actions.map(action => {
          const verb = action.collapsed ? "Expand" : "Collapse";
          return '<button type="button" class="gutter-fold-btn" data-fold-index="' + action.actionIndex + '" aria-expanded="' + (!action.collapsed) + '" aria-label="' + verb + ' ' + esc(action.label) + '" title="' + verb + ' ' + esc(action.label) + '">' + (action.collapsed ? "▸" : "▾") + '</button>';
        }).join("") + '</span>'
        : '<span class="gutter-fold-controls"><span class="gutter-fold-spacer"></span></span>';
      rows.push('<div class="gutter-row">' + control + '<span class="gutter-line-number">' + sourceLine + '</span></div>');
      displayOffset += lines[line].length + 1;
    }
    gutter.innerHTML = rows.join("");
  }

  gutter.addEventListener("pointerdown", event => {
    const button = event.target.closest(".gutter-fold-btn");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
  });
  gutter.addEventListener("click", event => {
    const button = event.target.closest(".gutter-fold-btn");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    toggleFold(Number(button.dataset.foldIndex));
    ta.focus({ preventScroll: true });
  });

  function renderView() {
    if (candidatesDirty) {
      const candidates = collectFoldCandidates(sourceText);
      if (foldedRanges.length) {
        const oldProjection = projectionState;
        const sourceStart = displayToSource(ta.selectionStart, 'left', oldProjection);
        const sourceEnd = ta.selectionStart === ta.selectionEnd
          ? sourceStart : displayToSource(ta.selectionEnd, 'right', oldProjection);
        projectionState = buildProjection(sourceText, candidates);
        if (ta.value !== projectionState.text) {
          ta.value = projectionState.text;
          const start = sourceToDisplay(sourceStart, 'left');
          const end = sourceStart === sourceEnd ? start : sourceToDisplay(sourceEnd, 'right');
          ta.setSelectionRange(start, end);
        }
      } else {
        projectionState = {
          text: sourceText,
          segments: sourceText.length ? [{ type: 'text', sourceStart: 0, sourceEnd: sourceText.length, displayStart: 0, displayEnd: sourceText.length }] : [],
          candidates,
          visibleFolds: []
        };
      }
      candidatesDirty = false;
      gutterDirty = true;
    }
    const text = value();
    currentLineCount = sourceLineStarts.length;
    // Gutter controls only need rebuilding after a source or fold change.
    if (gutterDirty) {
      renderGutter();
      gutterDirty = false;
    }
    renderedLineCount = text.split('\n').length;
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
    // Keep typing/caret input immediate. Expensive syntax highlighting and
    // gutter rebuilding are throttled so long documents do not repaint at
    // display-frame frequency while the user is continuously typing.
    if (renderTimer || renderFrame) return;
    renderTimer = setTimeout(() => {
      renderTimer = 0;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        renderView();
      });
    }, 64);
  }
  function queueSuggestions() {
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => {
      suggestTimer = 0;
      if (document.activeElement === ta && !suppressSuggestions) suggest(false);
    }, 55);
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
    if (document.activeElement === ta && !suppressSuggestions) {
      if (immediate) suggest(false);
      else queueSuggestions();
    }
  }
  function changed(event = null) {
    const before = pendingHistoryState || pendingProgrammaticState || historyBaseline || captureHistoryState();
    const inputType = pendingInputType || (event && event.inputType) || 'programmatic';
    pendingHistoryState = null;
    pendingInputType = '';
    pendingProgrammaticState = null;

    if (foldedRanges.length) {
      commitProjectedEdit();
    } else {
      const next = normalize(ta.value);
      if (next !== sourceText) {
        let start = 0;
        const limit = Math.min(sourceText.length, next.length);
        while (start < limit && sourceText[start] === next[start]) start++;
        let suffix = 0;
        while (suffix < sourceText.length - start && suffix < next.length - start &&
          sourceText[sourceText.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
        const end = sourceText.length - suffix;
        const insertion = next.slice(start, next.length - suffix);
        const removed = sourceText.slice(start, end);
        const needsFoldRescan = candidatesDirty || editNeedsFoldRescan(removed, insertion);
        const delta = insertion.length - (end - start);
        updateLineIndexForEdit(start, end, insertion);
        const fastCandidates = needsFoldRescan
          ? projectionState.candidates
          : shiftCandidateDescriptors(projectionState.candidates, start, end, insertion.length, delta);
        sourceText = next;
        projectionState = {
          text: sourceText,
          segments: sourceText.length ? [{ type: 'text', sourceStart: 0, sourceEnd: sourceText.length, displayStart: 0, displayEnd: sourceText.length }] : [],
          candidates: fastCandidates,
          visibleFolds: []
        };
        candidatesDirty = needsFoldRescan;
        gutterDirty = gutterDirty || needsFoldRescan || removed.includes('\n') || insertion.includes('\n');
      }
    }

    const after = captureHistoryState();
    pushHistory(before, after, inputType);
    historyBaseline = after;
    persistFoldState();
    refreshView();
    onChange();
  }
  function replaceRange(start, end, insertion, cursorOffset = null, selectionEnd = null) {
    beginProgrammaticEdit();
    const editable = prepareEditableRange(start, end);
    start = editable.start; end = editable.end;
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

    if (context.matched) {
      candidates = context.candidates;
    } else if (insideStringOrComment(prefix)) {
      return { candidates: [], replaceStart, replaceEnd };
    } else if (insideTag) {
      const afterOpen = prefix.slice(lastOpen);
      const partialTagName = /^<\s*\/?\s*([A-Za-z][\w:-]*)?$/.test(afterOpen);
      const tagNameMatch = /^<\s*\/?\s*([A-Za-z][\w:-]*)/.exec(afterOpen);
      const tagName = tagNameMatch ? tagNameMatch[1] : "";
      const isClosing = /^<\s*\//.test(afterOpen);
      const snippet = tagName ? SNIPPET_MAP.get(tagName.toLowerCase()) : null;
      if (partialTagName) {
        candidates = TAGS.filter(tag => !(isClosing && tag.isIcon)).map(tag => {
          const matchingSnippet = SNIPPET_MAP.get(String(tag.name).toLowerCase());
          const iconSuggestion = tag.isIcon && typeof window.getSGMLIconSuggestion === "function"
            ? window.getSGMLIconSuggestion(tag.name)
            : null;
          const insertion = iconSuggestion ? iconSuggestion.insert : matchingSnippet ? matchingSnippet.insert : (tag.insert || tag.name);
          return {
            m: String(tag.name),
            insert: insertion,
            d: matchingSnippet ? (matchingSnippet.description || tag.description || "SGML syntax") : (tag.description || "SGML tag"),
            k: iconSuggestion ? "icon" : matchingSnippet ? "syntax" : "tag",
            preview: iconSuggestion ? insertion.replace(/\$0/g, "") : matchingSnippet ? templatePreview(matchingSnippet) : "<" + (tag.insert || tag.name) + ">",
            replaceStart: (iconSuggestion || matchingSnippet) && !isClosing ? lastOpen : startWord,
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
        const xmlAttributeTags = new Set((LANG.xmlAttributeTags || []).map(name => String(name).toLowerCase()));
        candidates = attrDefs.map(attr => {
          const candidate = asCandidate(attr, { k: "attr" });
          if (xmlAttributeTags.has(String(tagName).toLowerCase())) {
            candidate.insert = String(attr.name) + "=";
          }
          return candidate;
        });
        const emptyParameter = /(?:^|\s)([A-Za-z_][\w-]*)\s*:\s*$/.exec(linePrefix);
        if (emptyParameter && ["case", "shuffle", "inorder", "controls", "autoplay", "loop", "muted", "required", "disabled"].includes(emptyParameter[1].toLowerCase())) {
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
    return { candidates: output.slice(0, 200), replaceStart, replaceEnd };
  }
  function positionPopup() {
    if (!popOpen || !suggestions.length) return;
    const displayOffset = ta.selectionStart;
    const displayBefore = value().slice(0, displayOffset);
    const displayLine = (displayBefore.match(/\n/g) || []).length;
    const displayColumn = displayOffset - (displayBefore.lastIndexOf("\n") + 1);
    const relX = PC + displayColumn * CHAR_W - ta.scrollLeft;
    const relY = PL + displayLine * LH - ta.scrollTop + LH;
    const maxWidth = Math.max(170, Math.min(480, ed.clientWidth - 12));
    pop.style.maxWidth = maxWidth + "px";
    pop.style.left = clamp(relX, 4, Math.max(4, ed.clientWidth - maxWidth - 4)) + "px";
    const popupHeight = Math.min(180, suggestions.length * 30 + 2);
    const below = relY + popupHeight <= ed.clientHeight;
    pop.style.top = clamp(below ? relY : relY - popupHeight - LH, 4, Math.max(4, ed.clientHeight - popupHeight - 4)) + "px";
  }
  function setSelectedSuggestion(index, scroll = true) {
    if (!suggestions.length) return;
    selectedSuggestion = clamp(Number(index) || 0, 0, suggestions.length - 1);
    const rows = pop.querySelectorAll(".it");
    rows.forEach((row, rowIndex) => {
      const active = rowIndex === selectedSuggestion;
      row.classList.toggle("sel", active);
      row.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (scroll) {
      const active = rows[selectedSuggestion];
      if (active) {
        lockPopupScrollSelection = true;
        active.scrollIntoView({ block: "nearest" });
        setTimeout(() => { lockPopupScrollSelection = false; }, 90);
      }
    }
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
    if (active) {
      lockPopupScrollSelection = true;
      active.scrollIntoView({ block: "nearest" });
      setTimeout(() => { lockPopupScrollSelection = false; }, 90);
    }
    positionPopup();
  }
  function suggest(force = false) {
    if (document.activeElement !== ta && !force) return closePop();
    if (hasSelection()) return closePop();
    const result = getCandidates(force);
    if (!result.candidates.length) return closePop();
    const text = value();
    const contextKey = text.slice(0, ta.selectionStart) + "\u0000" + ta.selectionStart + "\u0000" + result.replaceStart + "\u0000" + result.replaceEnd;
    const previous = suggestions[selectedSuggestion];
    if (contextKey !== lastSuggestionContext) {
      selectedSuggestion = 0;
    } else if (previous) {
      const previousKey = String(previous.m) + "|" + String(previous.k) + "|" + String(previous.insert);
      const sameIndex = result.candidates.findIndex(item => String(item.m) + "|" + String(item.k) + "|" + String(item.insert) === previousKey);
      selectedSuggestion = sameIndex >= 0 ? sameIndex : clamp(selectedSuggestion, 0, result.candidates.length - 1);
    } else {
      selectedSuggestion = clamp(selectedSuggestion, 0, result.candidates.length - 1);
    }
    lastSuggestionContext = contextKey;
    suggestions = result.candidates;
    replaceTokenStart = result.replaceStart;
    replaceTokenEnd = result.replaceEnd;
    drawSuggestions();
  }

  function selectVisibleSuggestion() {
    if (!popOpen || lockPopupScrollSelection || !suggestions.length) return;
    if (popupScrollTimer) clearTimeout(popupScrollTimer);
    popupScrollTimer = setTimeout(() => {
      popupScrollTimer = 0;
      if (!popOpen || lockPopupScrollSelection) return;
      const popupRect = pop.getBoundingClientRect();
      const rows = [...pop.querySelectorAll(".it")];
      const visible = rows.map((row, index) => ({ row, index, rect: row.getBoundingClientRect() }))
        .filter(item => item.rect.bottom > popupRect.top + 1 && item.rect.top < popupRect.bottom - 1)
        .sort((a, b) => Math.abs(a.rect.top - popupRect.top) - Math.abs(b.rect.top - popupRect.top));
      if (visible.length) setSelectedSuggestion(visible[0].index, false);
    }, 65);
  }
  function acceptSuggestion(index = selectedSuggestion) {
    const item = suggestions[index];
    if (!item) return closePop();
    beginProgrammaticEdit();
    let start = item.replaceStart == null ? replaceTokenStart : item.replaceStart;
    let end = item.replaceEnd == null ? replaceTokenEnd : item.replaceEnd;
    const editable = prepareEditableRange(start, end);
    start = editable.start; end = editable.end;
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
  pop.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    const row = event.target.closest(".it");
    if (row && pop.contains(row)) setSelectedSuggestion(Number(row.dataset.index), false);
  });
  pop.addEventListener("pointerdown", event => {
    const row = event.target.closest(".it");
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    acceptSuggestion(Number(row.dataset.index));
  });
  pop.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
  pop.addEventListener("scroll", selectVisibleSuggestion, { passive: true });
  pop.addEventListener("touchstart", () => { lockPopupScrollSelection = false; }, { passive: true });

  function insertText(text, start = ta.selectionStart, end = ta.selectionEnd, caretOffset = null) {
    beginProgrammaticEdit();
    const editable = prepareEditableRange(start, end);
    start = editable.start; end = editable.end;
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
    beginProgrammaticEdit();
    const editable = prepareEditableRange(ta.selectionStart, ta.selectionEnd);
    const start = editable.start, end = editable.end, text = value();
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
    beginProgrammaticEdit();
    const editable = prepareEditableRange(ta.selectionStart, ta.selectionEnd);
    const start = editable.start, end = editable.end;
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
    if (ctrl && !event.altKey) {
      const lower = key.toLowerCase();
      if (lower === 'z') {
        event.preventDefault();
        if (shift) redo(); else undo();
        return;
      }
      if (lower === 'y') {
        event.preventDefault();
        redo();
        return;
      }
    }
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
      // Let the browser handle native selection and clipboard shortcuts.
      if (["a", "c", "x", "v"].includes(lower)) return;
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
      while ((match = regex.exec(sourceText))) {
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
  function revealSourceRange(start, end) {
    const beforeStart = start, beforeEnd = end;
    const remaining = foldedRanges.filter(item => !(
      (beforeStart >= item.start && beforeStart <= item.end) ||
      (beforeEnd >= item.start && beforeEnd <= item.end) ||
      (beforeStart <= item.start && beforeEnd >= item.end)
    ));
    if (remaining.length === foldedRanges.length) return;
    foldedRanges = remaining;
    applyProjection(start, end);
    persistFoldState();
    historyBaseline = captureHistoryState();
  }

  function findMatch(backwards = false) {
    rebuildMatches();
    if (!findMatches.length) return;
    const currentStart = displayToSource(ta.selectionStart, "left");
    const currentEnd = ta.selectionStart === ta.selectionEnd
      ? currentStart : displayToSource(ta.selectionEnd, "right");
    const from = backwards ? currentStart - 1 : currentEnd;
    let index = -1;
    if (backwards) {
      for (let i = findMatches.length - 1; i >= 0; i--) if (findMatches[i].start < from) { index = i; break; }
      if (index < 0) index = findMatches.length - 1;
    } else {
      index = findMatches.findIndex(item => item.start >= from);
      if (index < 0) index = 0;
    }
    activeFind = index;
    const match = findMatches[index];
    revealSourceRange(match.start, match.end);
    ta.focus({ preventScroll: true });
    const displayStart = sourceToDisplay(match.start, "left");
    const displayEnd = sourceToDisplay(match.end, "right");
    ta.setSelectionRange(displayStart, displayEnd);
    ta.scrollTop = Math.max(0, findDisplayLine(projectionState.text, displayStart) * LH - LH * 2);
    refreshView();
    findStatus.textContent = `${index + 1} of ${findMatches.length}`;
  }
  function showSearch(replace = false, prefillSelection = false) {
    const selected = prefillSelection && hasSelection()
      ? sourceText.slice(displayToSource(ta.selectionStart, "left"), displayToSource(ta.selectionEnd, "right")) : "";
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
    const start = displayToSource(ta.selectionStart, "left"), end = displayToSource(ta.selectionEnd, "right");
    const selected = sourceText.slice(start, end);
    let replacement = replaceInput.value;
    if (findRegex.checked) {
      try { replacement = selected.replace(new RegExp(query, findCase.checked ? "" : "i"), replaceInput.value); }
      catch (_) { findInput.classList.add("invalid"); findStatus.classList.add("error"); findStatus.textContent = "Invalid regex"; return; }
    }
    if (!findMatches.some(match => match.start === start && match.end === end)) { findMatch(false); return; }
    revealSourceRange(start, end);
    const displayStart = sourceToDisplay(start, "left"), displayEnd = sourceToDisplay(end, "right");
    insertText(replacement, displayStart, displayEnd);
    rebuildMatches();
    findMatch(false);
  }
  function replaceAllMatches() {
    try {
      const countRegex = compileSearchRegex(true);
      if (!countRegex) return;
      const before = sourceText;
      let count = 0, match;
      while ((match = countRegex.exec(before))) {
        count++;
        if (!match[0].length) countRegex.lastIndex++;
      }
      const replaceRegex = compileSearchRegex(true);
      const after = before.replace(replaceRegex, replaceInput.value);
      if (count) {
        beginProgrammaticEdit();
        const beforeState = pendingProgrammaticState;
        const oldCursor = displayToSource(ta.selectionStart, 'left');
        const oldSource = sourceText;
        foldedRanges = [];
        let prefix = 0;
        const limit = Math.min(oldSource.length, after.length);
        while (prefix < limit && oldSource[prefix] === after[prefix]) prefix++;
        let suffix = 0;
        while (suffix < oldSource.length - prefix && suffix < after.length - prefix &&
          oldSource[oldSource.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
        const oldEnd = oldSource.length - suffix;
        const insertion = after.slice(prefix, after.length - suffix);
        updateLineIndexForEdit(prefix, oldEnd, insertion);
        sourceText = after;
        projectionState = buildProjection(sourceText);
        candidatesDirty = false;
        gutterDirty = true;
        if (ta.value !== projectionState.text) ta.value = projectionState.text;
        const caret = sourceToDisplay(Math.min(oldCursor, after.length), 'left');
        ta.setSelectionRange(caret, caret);
        const afterState = captureHistoryState();
        pushHistory(beforeState, afterState, 'replaceAll');
        pendingProgrammaticState = null;
        historyBaseline = afterState;
        persistFoldState();
        refreshView();
        onChange();
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
    gotoStatus.textContent = `1–${sourceText.split("\n").length}`;
    gotoInput.focus();
    gotoInput.select();
  }
  function commitGoToLine() {
    const parsed = Number.parseInt(gotoInput.value, 10);
    if (!Number.isFinite(parsed)) { gotoStatus.textContent = "Enter a line number"; return; }
    const lines = sourceText.split("\n");
    const targetLine = clamp(parsed, 1, lines.length) - 1;
    const lineStart = lines.slice(0, targetLine).reduce((sum, line) => sum + line.length + 1, 0);
    revealSourceRange(lineStart, lineStart);
    gotoBar.hidden = true;
    ta.focus({ preventScroll: true });
    const displayOffset = sourceToDisplay(lineStart, "left");
    ta.setSelectionRange(displayOffset, displayOffset);
    ta.scrollTop = Math.max(0, findDisplayLine(projectionState.text, displayOffset) * LH - LH * 2);
    refreshView();
  }

  ta.addEventListener('input', event => {
    const type = event.inputType || '';
    if (type === 'historyUndo' || type === 'historyRedo') {
      if (ignoreNextNativeHistoryInput === type) {
        ignoreNextNativeHistoryInput = '';
      } else if (type === 'historyUndo') {
        undo();
      } else {
        redo();
      }
      const state = historyBaseline || captureHistoryState();
      projectionState = buildProjection(sourceText);
      candidatesDirty = false;
      gutterDirty = true;
      if (ta.value !== projectionState.text) ta.value = projectionState.text;
      const start = sourceToDisplay(clamp(state.selectionStart, 0, sourceText.length), 'left');
      const end = state.selectionStart === state.selectionEnd ? start : sourceToDisplay(clamp(state.selectionEnd, 0, sourceText.length), 'right');
      ta.setSelectionRange(start, end);
      refreshView(true);
      return;
    }
    if (ignoreNextNativeHistoryInput) ignoreNextNativeHistoryInput = '';
    changed(event);
  });
  ta.addEventListener('beforeinput', event => {
    const type = event.inputType || '';
    // Mobile keyboards can request undo/redo through beforeinput instead of a
    // Ctrl+Z key event. Route those through the same validated history stack.
    if (type === 'historyUndo' || type === 'historyRedo') {
      if (event.cancelable) event.preventDefault();
      else ignoreNextNativeHistoryInput = type;
      pendingHistoryState = null;
      pendingInputType = '';
      if (type === 'historyUndo') undo(); else redo();
      return;
    }
    pendingHistoryState = captureHistoryState();
    pendingInputType = type;
    // Typing, deleting, or pasting on the placeholder first expands its fold.
    // The native beforeinput operation then applies to the original source.
    revealFoldAtSelection(false);
  });
  ta.addEventListener("copy", event => {
    const start = displayToSource(ta.selectionStart, "left");
    const end = displayToSource(ta.selectionEnd, "right");
    if (start === end || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", sourceText.slice(start, end));
    event.preventDefault();
  });
  ta.addEventListener("cut", event => {
    const start = ta.selectionStart, end = ta.selectionEnd;
    const rawStart = displayToSource(start, "left"), rawEnd = displayToSource(end, "right");
    if (rawStart === rawEnd || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", sourceText.slice(rawStart, rawEnd));
    event.preventDefault();
    beginProgrammaticEdit();
    ta.setRangeText("", start, end, "start");
    changed();
  });
  ta.addEventListener("keydown", handleKeydown);
  ta.addEventListener("keyup", event => {
    updatePosition();
    // ArrowUp/ArrowDown navigate the open list on keydown. Re-running suggest
    // here used to reset the active row to zero immediately after every move.
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key) ||
        (["ArrowUp", "ArrowDown"].includes(event.key) && !popOpen)) suggest(false);
    else if (popOpen) positionPopup();
  });
  ta.addEventListener("click", () => {
    if (revealFoldAtSelection(true)) return;
    updatePosition();
    suggest(false);
  });
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

  // Initialize the source mirror before the first document is loaded.
  sourceText = normalize(ta.value);
  rebuildLineIndex(sourceText);
  projectionState = buildProjection(sourceText);
  ta.value = projectionState.text;
  historyBaseline = { text: sourceText, folds: [], selectionStart: 0, selectionEnd: 0 };

  return {
    init(options) { onRun = options.onRun || onRun; onChange = options.onChange || onChange; refreshView(true); },
    getValue: () => sourceText,
    setValue(text) {
      closePop();
      sourceText = normalize(text);
      rebuildLineIndex(sourceText);
      const candidates = collectFoldCandidates(sourceText);
      restoreFoldState(sourceText, candidates);
      projectionState = buildProjection(sourceText, candidates);
      candidatesDirty = false;
      gutterDirty = true;
      ta.value = projectionState.text;
      ta.setSelectionRange(0, 0);
      ta.scrollTop = 0; ta.scrollLeft = 0;
      undoStack.length = 0;
      redoStack.length = 0;
      pendingHistoryState = null;
      pendingInputType = '';
      pendingProgrammaticState = null;
      historyBaseline = captureHistoryState();
      persistFoldState();
      refreshView(true);
    },
    focus() { ta.focus({ preventScroll: true }); },
    showFind() { showSearch(false, true); },
    showReplace() { showSearch(true, true); },
    showSuggestions() { ta.focus({ preventScroll: true }); suggest(true); },
    openGoToLine: showGoToLine,
    refresh: refreshView,
    foldAll() {
      foldedRanges = collectFoldCandidates(sourceText).map(item => ({ kind: item.kind, start: item.start, end: item.end }));
      applyProjection();
      persistFoldState();
      historyBaseline = captureHistoryState();
    },
    unfoldAll() {
      foldedRanges = [];
      applyProjection();
      persistFoldState();
      historyBaseline = captureHistoryState();
    },
    undo,
    redo
  };
})();

window.Editor = Editor;
