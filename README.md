# TrueRedact

**The black box you drew isn't redaction. This actually deletes the text.**

A single-file, 100%-in-browser PDF redactor that **permanently removes** content by
rasterizing every page and rebuilding the PDF — so the hidden text under your black box
is truly gone. Your file is **never uploaded**. Open the HTML and read it yourself.

---

## The UI

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ■ TrueRedact                                                                   │
│   The black box you drew isn't redaction. This actually deletes the text.      │
│   Drawing a black rectangle leaves the hidden text selectable underneath.      │
│   TrueRedact flattens every page to pixels — so the text is physically gone.   │
├──────────────────────────────────────────────────────────────────────────────┤
│ [📄 Open PDF] [🔥 Burn & Redact] [⬇ Download] [Start over]                     │
│                         🔒 100% local — no upload · Pages: 3 · Redactions: 2   │
├────────────────────────────────────────────────┬─────────────────────────────┤
│                                                 │  VERIFICATION               │
│   ┌───────────────────────────────┐             │  ┌───────────────────────┐  │
│   │ Page 1                        │             │  │        0              │  │
│   │  Mission Briefing             │             │  │  characters           │  │
│   │  ████████████████████  ← box  │             │  │  recoverable —        │  │
│   │  Lorem ipsum dolor sit amet   │             │  │  nothing survived.    │  │
│   │  ███████████  ← box           │             │  └───────────────────────┘  │
│   │  consectetur adipiscing elit  │             │  Pages flattened        3   │
│   └───────────────────────────────┘             │  Redaction boxes        2   │
│   (drag to draw · click to select ·             │  Text layer in output  none │
│    corner handle to resize · Delete to remove)  │  Metadata           stripped│
│                                                 │  Output size        1.4 MB  │
└────────────────────────────────────────────────┴─────────────────────────────┘
```

A drawn box renders as a solid black rectangle with a red selection outline, a `×` delete
button and a resize handle when selected. After you hit **Burn**, the Verification panel
slides in and re-reads the file you're about to download.

---

## How to use

1. **Open `index.html`** in any modern browser (double-click it — no server, no install).
   It loads `pdf.js` and `pdf-lib` from a pinned CDN, so you need to be online the first time.
2. Click **Open PDF** (or drag a PDF onto the window). Every page renders on screen.
3. **Draw a box** over anything secret: press and drag. Click a box to select it, drag it to
   move, use the corner handle to resize, press <kbd>Delete</kbd> to remove it.
4. Click **🔥 Burn & Redact**. TrueRedact flattens every page to an image with the boxes
   painted into the pixels, rebuilds the PDF, and strips the metadata.
5. Read the **Verification** panel — it should say **0 characters recoverable**.
6. Click **⬇ Download redacted PDF**. Done.

> Want to be sure it never phones home? Open your browser's Network tab, or just read
> `index.html` — it's one file. The only network calls are the two CDN script tags.

---

## Why this exists

"Redacting" by drawing a black rectangle in Preview, Acrobat's annotate tools, or an online
annotator is one of the most common and damaging mistakes in document handling. The rectangle
is just an *overlay* — the original text object is still in the file, fully **selectable,
searchable, copy-pasteable and extractable** with one line of code or a `Ctrl+A`, `Ctrl+C`.

This has leaked real secrets over and over:

- The **TSA** published its airport screening manual with "redacted" sections that were
  trivially recoverable.
- Courts, law firms, and government agencies repeatedly file "redacted" PDFs where the text
  underneath the boxes is still there (names of informants, settlement figures, trade secrets).

Real redaction — the kind that actually deletes the bytes — is **paywalled behind Acrobat
Pro**, and the free online tools make you **upload your confidential file to a stranger's
server**. That's the wedge:

**TrueRedact is free, needs no install, never uploads your file, and is verifiable** — the
whole thing is one HTML file you can read, and it *proves its own work* after every burn.

---

## Features

- **Real deletion, not cover-up.** Every page is rasterized and the PDF is rebuilt from
  scratch as image-only pages. There is no text layer, no font, no hidden object to recover.
- **Self-verifying.** After burning, it re-opens the *output* with pdf.js and extracts text
  from it, reporting the exact number of recoverable characters (should be **0**). If anything
  survives, it flags a loud warning instead of lying to you.
- **100% client-side.** Your PDF never leaves your machine. No upload, no account, no server.
- **Metadata stripped.** Author, Title, Subject, Keywords, Producer/Creator and XMP never
  carry over — the rebuilt file is created fresh with none of them.
- **Full editing.** Draw, move, resize, and delete boxes across any number of pages.
- **Multi-page & robust.** Handles multi-page and large files with a progress indicator, and
  fails *loudly and clearly* on encrypted or corrupt PDFs — never silently.
- **Accessible, keyboard-friendly, dark UI** with clear states and a live page/redaction count.
- **No build step.** One `index.html` + one `redact-core.js`. Read them. Trust them.

---

## How it works

```
 Open PDF ──► pdf.js renders each page to a <canvas>
                         │
 You draw boxes ─────────┤  (stored as normalized coordinates, resolution-independent)
                         ▼
 Burn ──► for every page:  render at 2× ──► paint black boxes into the pixels ──► export JPEG
                         │
                         ▼
          pdf-lib builds a BRAND-NEW PDF: each page = one flattened image, metadata stripped
                         │
                         ▼
 Verify ──► pdf.js re-opens the OUTPUT and extracts text ──► "0 characters recoverable"
                         │
                         ▼
 Download ──► <yourfile>-redacted.pdf
```

The security guarantee comes from the fact that the output is **not** your original document
with boxes added — it is a new document whose pages are *pictures*. The hidden text was never
copied into it. The core of this (rebuild + metadata strip) lives in `redact-core.js`, which
is shared, unchanged, between the browser app and the automated test — so the tests exercise
the real code.

- **Rendering & text extraction:** [`pdf.js`](https://github.com/mozilla/pdf.js) `3.11.174`
- **PDF rebuild:** [`pdf-lib`](https://github.com/Hopding/pdf-lib) `1.17.1`
- Both pinned, loaded from jsDelivr (worker, standard fonts and CMaps all from the one package).

---

## Limitations (honest)

- **Output is bigger.** Rasterizing replaces compact text/vector content with images, so the
  redacted PDF is usually several times larger than the original.
- **The text is gone — on purpose.** The output is image-only. The *remaining* (non-redacted)
  text is no longer selectable, searchable, or screen-reader accessible, because it is now a
  picture too. That is the price of guaranteed deletion. If you need the rest to stay
  searchable, run OCR on the output afterwards — but understand that re-OCR will *not* bring
  back anything under a box, because those pixels are solid black.
- **Online for the libraries.** The tool itself is offline and local, but it pulls `pdf.js`
  and `pdf-lib` from a CDN on first load (they then cache). For a fully air-gapped build,
  download those two files and point the two `<script>` tags at local copies.
- **Encrypted PDFs** must be unlocked first — TrueRedact will tell you, rather than fail
  silently.
- **Visible-tab rendering.** pdf.js advances its render loop via `requestAnimationFrame`, which
  browsers pause in fully-backgrounded tabs; keep the tab visible while a large file renders.

---

## Files

| File             | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `index.html`     | The entire app — UI, rendering, drawing, burn, verify, download.   |
| `redact-core.js` | Environment-agnostic rebuild + metadata-strip core (UMD).          |
| `test/`          | Headless Node test of the core redaction path.                     |
| `TESTS.md`       | Automated-test instructions + a manual browser test plan.          |

## Running the tests

```bash
npm install     # pdf-lib + pdfjs-dist (dev only; the app itself has no install)
npm test
```

See [`TESTS.md`](TESTS.md) for details and the manual browser checklist.

---

## License

MIT © 2026 freyesperales. See [LICENSE](LICENSE).

---

*Development Experiment 060 of dev-experiments-365*
