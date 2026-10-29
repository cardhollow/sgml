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
    ├── editor-language.js  # SGML syntax and suggestion configuration
    ├── editor.js           # Native textarea editor and completion engine
    └── sgml-renderer.js    # SGML parsing and rendering
```

See [CONVERSION-LIBRARIES.md](CONVERSION-LIBRARIES.md) for the pinned DOCX/PDF conversion dependencies and their licenses.

## SGML code editor

Open **Edit Code** to use the mobile-friendly code editor. It fills nearly all available viewport height below the top toolbar. The source is edited in a real textarea, so text selection, long-press handles, copy/paste, and the native Android selection toolbar work as expected. A syntax-color overlay, line numbers, auto-pairing, indentation, find/replace, go-to-line, and SGML-aware suggestions remain available. Questionnaire completions show the expected syntax and insert the full snippet when selected. While the editor is open, browser Back is trapped so an accidental press will not navigate away; use **Close Editor** to exit. Open **Documentation** in the top bar to view the bundled guide in a modal, or open it in a new tab. **Find**, **Replace**, **Go to line**, and **Suggest** buttons are available for touch devices, and **Ctrl+Space** works on keyboards.

The editor engine is separate from the language definition. Add or adjust tags, attributes, tag-specific attributes, value suggestions, context-aware parameter completions, completion rules, void tags, and reusable snippets in `js/editor-language.js`. Questionnaire parameter suggestions and values are configuration-driven too, so extending the profile usually does not require replacing the editor engine. The editor reads this configuration at startup; adding a language item usually means editing the language profile rather than replacing the editor engine.

## URL commands

Commands are processed once, then `load` / `gdrive` / `new` are removed from the address bar when successfully processed so a refresh does not create another document.

### Create a blank SGML document

`https://YOUR-VIEWER-URL/?new`

Or name it:

`https://YOUR-VIEWER-URL/?new=Week%207%20Reviewer`

This creates a new local document and opens the editor.

### Import a text, DOCX, or PDF file

Upload File accepts `.sgml`, `.txt`, `.md`, `.docx`, and `.pdf` files. DOCX is converted to safe HTML with Mammoth.js. PDF.js extracts selectable PDF text and converts it to HTML organized by page. The resulting HTML is sent through the existing SGML renderer, so the normal SGML parsing for recognizable built-in constructs remains available.

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
