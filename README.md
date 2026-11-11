# SGML Viewer

A browser-based viewer and editor for Study Guide Markup Language (SGML) documents. The app is organized into a separate HTML entry point, stylesheet, and small groups of JavaScript files.

## Automatic resource updates and offline fallback

- There is no offline-mode switch. When connected, the Service Worker requests the latest app resources and caches successful responses automatically.
- If a request fails because the network is unavailable, the viewer loads the most recently cached response. The same fallback is used for the app page, stylesheet, editor code, renderer, and local dependencies.
- Open the viewer once while online before expecting it to work offline for the first time. A browser cannot cache resources that it has never downloaded.
- Resource updates use a shared cache and migrate the previous viewer cache before replacing old entries. A resource that cannot be downloaded does not erase its previously cached copy.
- Offline fallback covers the viewer and its same-origin resources. Importing a new remote SGML URL or a Google Drive file still requires a network connection, unless the content was already imported and saved in this browser.

## Project structure

```text
sgml-main/
├── index.html              # App markup and script loading order
├── Documentation/
│   └── index.html          # Standalone SGML documentation (cached offline)
├── style.css               # App and editor styles
├── sw.js                   # Automatic updates, resource cache, offline fallback
├── manifest.json
├── marked.js
├── tex-chtml.js
└── js/
    ├── app-state.js        # Storage, notifications, PWA/install behavior
    ├── app.js              # Startup and URL command processing
    ├── default-document.js # Sample and local library initialization
    ├── document-library.js # Import/export, document operations, editor controls
    ├── file-converter.js   # DOCX/PDF-to-HTML import pipeline
    ├── sgml-icons.js       # Built-in inline SVG icon registry and icon renderer
    ├── editor-language.js  # SGML syntax and suggestion configuration
    ├── editor.js           # Native textarea editor and completion engine
    └── sgml-renderer.js    # SGML parsing and rendering
```

See [CONVERSION-LIBRARIES.md](CONVERSION-LIBRARIES.md) for the pinned DOCX/PDF conversion dependencies and their licenses.

## SGML code editor

Open **Edit Code** to use the mobile-friendly code editor. It fills nearly all available viewport height below the top toolbar. The source is edited in a real textarea, so text selection, long-press handles, copy/paste, and the native Android selection toolbar work as expected. A syntax-color overlay, line numbers, auto-pairing, indentation, find/replace, go-to-line, and SGML-aware suggestions remain available. Questionnaire completions show the expected syntax and insert the full snippet when selected. While the editor is open, browser Back is trapped so an accidental press will not navigate away; use **Close Editor** to exit. Open **Documentation** in the top bar to view the bundled guide in a modal, or open it in a new tab. **Find**, **Replace**, **Go to line**, and **Suggest** buttons are available for touch devices, and **Ctrl+Space** works on keyboards.

The editor engine is separate from the language definition. Add or adjust tags, attributes, tag-specific attributes, value suggestions, context-aware parameter completions, completion rules, void tags, and reusable snippets in `js/editor-language.js`. Questionnaire parameter suggestions and values are configuration-driven too, so extending the profile usually does not require replacing the editor engine. The editor reads this configuration at startup; adding a language item usually means editing the language profile rather than replacing the editor engine.

The editor recognizes native HTML, SVG, and MathML tag names even when they are not part of the SGML completion list. Hyphenated custom-element names are recognized as HTML custom elements as well.

## Inline SVG icons

The bundled `js/sgml-icons.js` registry provides inline icons without external
fonts, image requests, or network dependencies. Icons use self-closing SGML
syntax: `<icowarning/>`, `<icosuccess/>`, `<icoinfo/>`, `<icoidea/>`, and
`<icobook/>`. The registry also includes navigation, files, devices, finance,
status, media, and common interface icons.

Icon options are written as `name:value` parameters. `scale:[1.5]` multiplies
the default 24-pixel size, `scale:[32px]` sets a square size, and
`scale:[32,48]` sets explicit width and height. Supported style parameters
include `color`, `fill`, `strokeWidth`, `border`, `opacity`, and `rotate`.
The optional border accepts a width and color in either order, such as
`border:"2px #f59e0b"` or `border:"#f59e0b 2px"`; a single width or color is
also accepted, while `border:none` disables it. For example:

```sgml
<icowarning scale:[1.4] color:"#d97706" border:"2px #f59e0b"/>
<icobook scale:[24,32] color:"#2563eb" strokeWidth:1.8/>
```

The icon registry is included in the service-worker app shell, so its icons
and editor completions are available after the app has been cached for offline
use. To add an icon, add its SVG body to `js/sgml-icons.js`; it is registered
with default styles and an editor completion automatically.

## Questionnaire answer whitespace matching

`Choices`, `Fillin`, and written or ordering `Enumeration` questions accept
`ignoreWhitespace:true` in the answer-properties section. When enabled, answer
checking removes all whitespace characters (including spaces, tabs, and line
breaks) before comparing text. For example, `NewYork` matches `New York`. The
default is `ignoreWhitespace:false`, which preserves the existing comparison
behavior. The existing `case` option still controls whether letter case matters:

```sgml
<Fillin:(Enter the city name)[]{New York|case:false|ignoreWhitespace:true}>
```

## Executable JavaScript blocks

`<js>...</js>` executes its contents as raw JavaScript inside a fresh immediately invoked function expression (IIFE). Before the document enters the SGML renderer, the entire block is replaced in the original source by the string form of its returned value. That replacement is not rendered separately or specially: it becomes ordinary source text at the same position and passes through every normal document-processing stage exactly once, including ICB extraction, unsafe-element processing, custom components, questionnaire parsing, Markdown, inline SGML, and HTML restoration. For example, returning `<Choices:...>` creates the same choice component as writing that syntax directly in the document. Use an explicit `return` for visible output. A `null` or `undefined` return inserts an empty string.

For later, event-driven updates, use `renderSGMLInto(target, source)`. It runs the same SGML pipeline but replaces only the contents of the selected target element; the rest of the rendered document stays untouched. Use `{append:true}` as a third argument to append instead. Existing question IDs and shared component state are preserved across fragment renders. Prefer a block target such as `<div id="dynamic-question"></div>` when rendering block components.

Example:

```sgml
<div id="dynamic-question"></div>
<js>
  window.renew = function(){
    const number = Math.floor(Math.random() * 10);
    renderSGMLInto('#dynamic-question',
      `<Choices:(Solve this ${number})[Option A, Option B, Option C, Option D]{[idx:0]}>`
    );
  };
  return '<button type="button" onclick="window.renew()">New question</button>';
</js>
```

This is not a security sandbox. Code runs with the viewer page's browser privileges and can access the document and browser APIs. Only render documents containing JavaScript from trusted sources.

## URL commands

Commands are processed once, then `load` / `gdrive` / `new` are removed from the address bar when successfully processed so a refresh does not create another document.

### Create a blank SGML document

`https://YOUR-VIEWER-URL/?new`

Or name it:

`https://YOUR-VIEWER-URL/?new=Week%207%20Reviewer`

This creates a new local document and opens the editor.

### Import a text, DOCX, or PDF file

Upload File accepts `.sgml`, `.txt`, `.md`, `.docx`, and `.pdf` files. DOCX is converted to safe HTML with Mammoth.js; explicitly underlined Word text is preserved as HTML `<u>` elements. The imported DOCX wrapper is removed before top-level Markdown/SGML parsing and restored afterward so Markdown headings, emphasis, lists, and inline SGML icons in the document are rendered by the same pipeline as hand-written SGML. Styled Word paragraphs retain their style classes while allowing Markdown inside the paragraph. PDF.js extracts selectable PDF text and converts it to HTML organized by page.

PDF conversion does not include OCR. A scanned PDF made only of images will report that it has no extractable text. Complex PDF layouts may be approximated rather than reproduced exactly.

### Import a file from a URL

`https://YOUR-VIEWER-URL/?load=https%3A%2F%2Fexample.com%2Fguide.sgml`

The `load` parameter accepts SGML/text URLs as well as `.docx` and `.pdf` URLs. Binary DOCX/PDF data is fetched as bytes, converted to HTML, and only then stored in the local document library. `?Queries=URL`, `?queries=URL`, and `?query=URL` are aliases for `?load=URL`. The target must be accessible to the browser; another domain must allow cross-origin fetches (CORS). Loading a source again reopens its converted copy rather than duplicating it.

Mammoth.js and PDF.js are cached automatically while online. Open the viewer online once before relying on offline conversion for the first time; uploaded/fetched documents are converted in the browser and are not sent to a conversion server.

### Import a Google Drive file

Use `gdrive` to import a publicly shared Google Drive file through the configured CORS proxy. You can paste either the file ID or a Google Drive file URL.

Using the file ID:

`https://YOUR-VIEWER-URL/?gdrive=1FFtvJbfy5851dpgpibNXRBelzLDGt2iQ`

Using a Google Drive URL:

`https://YOUR-VIEWER-URL/?gdrive=https://drive.google.com/file/d/1FFtvJbfy5851dpgpibNXRBelzLDGt2iQ/view?usp=drivesdk`

The viewer extracts the file ID and fetches the file through `https://proxy.cors.dev/https://drive.google.com/uc?export=download&id=FILE_ID`. The file must be shared as **Anyone with the link — Viewer**. Google Drive and the proxy must return the actual file bytes. Public DOCX and PDF downloads are converted before rendering; private files, confirmation pages, or proxy errors cannot be imported.

Imported content is saved in the local SGML library as a separate document. Loading the same source again reopens its imported copy rather than creating a duplicate.

### Open a saved local document

`https://YOUR-VIEWER-URL/?load=local:DOCUMENT_ID`

Use a saved document ID or its exact title after `local:`. For example, `?load=local:Week%207%20Reviewer`. A plain `?load` without a value is invalid; use the **Load SGML** library button to choose a saved document interactively.

## Status notifications

The viewer displays a toast notification while it is working and reports the result when the action finishes. Messages cover URL and Google Drive imports, reopening previously imported documents, loading a saved local document, uploading or sharing a file, creating a document, and rendering SGML. Errors appear as red notifications; tap **×** to dismiss a notification manually.

## Notes

- Documents are stored in this browser's local storage. They do not automatically sync between devices.
- Query commands are intended for the viewer page URL. For `load`, encode a full URL so characters such as `&` do not become viewer query parameters.
- For `gdrive`, pasting the file ID is the most reliable option. If you paste a full Google Drive URL containing additional query parameters, URL-encode it when building the viewer link if needed.


## New inline syntax

- `<badge col:"#1d4ed8" bg:"#dbeafe">Label</badge>` creates an inline colored badge.
- `<x col:"#c62828">Text</x>` draws a hand-marked pencil X over the text, scaled to its content box.
- `<arrow target:"topic" head:"arrow" dir:"0" col:"#2563eb" />` marks a connector point; matching targets are linked with curved, sketch-like strokes. Each point controls its own `head` (`arrow`, `dot`, or omitted) and optional compass-style `dir` (0° up, 90° right, 180° down, 270° left). The direction offsets the endpoint away from its text and controls the line's approach/departure, so a left-facing arrow is approached from the right; when the connected point is on the wrong side, the curve detours around the arrow.
- `<ref>` links render their contents inline, preserving their own whitespace without adding paragraph wrappers.

## Styled text display modes

`<st bg:"#fff3cd" display:"inline-block">...</st>` keeps a styled phrase in the text flow as one connected background box. `display:"block"` starts a full-width block. Quoted style values can contain spaces.


### JavaScript syntax coloring in the editor

Code inside `<js>...</js>` is highlighted with JavaScript-aware colors for keywords, declared variables, identifiers, function names and calls, object keys, properties, built-ins, literals, operators, strings, numbers, and comments. SGML outside `<js>` blocks continues using the normal SGML highlighter.


## Study-notebook components

The notebook elements below are additive. Existing compact `<flashcard(...) [...] {answers:[...]}>` decks continue to work.

### XML-style flashcards

```sgml
<flashcards title="Computer Basics" shuffle="true">
  <card>
    <front>What does CPU mean?</front>
    <back>Central Processing Unit</back>
  </card>
  <card>
    <front>What does RAM mean?</front>
    <back>Random Access Memory</back>
  </card>
</flashcards>
```

The deck uses the existing flashcard interaction and scoring controls. Markdown and embedded SGML, including inline icons, are supported on both sides.

### Notebook layouts

```sgml
<notebox type="definition" title="Algorithm">
  A finite sequence of clear steps for solving a problem.
</notebox>

<checklist title="Chapter review">
  <item checked="true">Read the chapter</item>
  <item>Review the definitions</item>
</checklist>

<glossary title="Key terms">
  <term name="Variable">A named place used to store a value.</term>
</glossary>

<quickreview title="Exam review">
  <fact label="FORMULA">E = mc^2</fact>
  <fact label="KEYWORD">Energy and mass</fact>
</quickreview>

<cornell title="Cell Structure">
  <cue>What does the nucleus do?</cue>
  <notes>The nucleus stores the cell's genetic material.</notes>
  <summary>The nucleus helps control cell activities.</summary>
</cornell>
```

`notebox` supports `note`, `definition`, `key`, `idea`, `example`, `warning`, `remember`, and `formula` types, with optional `color`, `bg`, and `icon` attributes. Checklist items are interactive in the rendered page. Glossary entries and quick-review cards support Markdown and embedded components. Cornell notes use cue, notes, and summary regions that stack on narrow screens.
