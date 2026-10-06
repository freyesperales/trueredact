# TrueRedact — Tests

There are two layers of testing: an **automated headless test** of the core redaction logic,
and a **manual browser test plan** for the parts that only exist in a real browser (canvas
rendering, mouse drawing, download).

---

## 1. Automated test (headless, Node)

The automated test exercises the **exact** `redact-core.js` the browser ships — no
re-implementation. It feeds the core a set of page images, runs the real rebuild + metadata
strip, then re-extracts text with `pdf.js` to prove nothing survives.

### Run it

```bash
npm install
npm test
# or: node test/redact.test.js
```

### What it asserts

- **Sanity first:** a normal PDF built with visible secret text yields that text back through
  `pdf.js`. (If this failed, a later "0 characters" result would be meaningless, so the test
  fails loudly instead of giving a false pass.)
- The core produces a valid, non-empty PDF.
- The output has **0 extractable characters** overall and **0 per page**.
- The secret string is **absent from the extracted text** *and* from the **raw output bytes**.
- Document metadata is stripped: Author, Title, Subject and Producer are empty/undefined, and
  the source's identifying strings (`Jane Secret`, `Classified Dossier`, `SecretWriter 9000`)
  do **not** appear anywhere in the raw bytes.
- No `pdf-lib` tool fingerprint (`Hopding`) is written into the output.
- Page **count and per-page dimensions** are preserved (Letter + A4 in the same document).
- The core **rejects bad input** (empty page list; missing pdf-lib dependency).

> Note: when run in Node, `pdf.js` prints harmless warnings about `canvas` / `DOMMatrix` /
> standard font data. Text extraction does not need a canvas, so these do not affect the test.

### Expected output (verbatim, last run)

```
TrueRedact core test
====================

[sanity] source PDF should contain extractable secret text
  ✓ secret string is extractable from the UN-redacted source
  ✓ source has > 0 extractable characters (202)
  ✓ source has 2 pages (got 2, expected 2)
  ✓ source Author metadata is present (got "Jane Secret", expected "Jane Secret")

[core] flatten + rebuild via redact-core.js
  ✓ core produced non-empty output (1925 bytes)

[verify] output must have ZERO extractable text
  ✓ output has 0 extractable characters (got 0, expected 0)
  ✓ secret string is GONE from the output
  ✓ page 1 exposes 0 characters (got 0, expected 0)
  ✓ page 2 exposes 0 characters (got 0, expected 0)

[verify] metadata stripped, no source strings in raw bytes
  ✓ output Author is empty/undefined (undefined)
  ✓ output Title is empty/undefined (undefined)
  ✓ output Subject is empty/undefined
  ✓ output Producer is empty/undefined (undefined)
  ✓ "Jane Secret" does not appear anywhere in the raw output bytes
  ✓ "Classified Dossier" title string is absent from raw bytes
  ✓ source Producer "SecretWriter 9000" is absent from raw bytes
  ✓ no pdf-lib tool fingerprint ("Hopding") is written into the output
  ✓ secret string is absent from the raw output bytes

[verify] structure preserved
  ✓ output still has 2 pages (got 2, expected 2)
  ✓ page 1 dimensions preserved (got "612x792", expected "612x792")
  ✓ page 2 dimensions preserved (got "595x842", expected "595x842")

[guard] core rejects bad input
  ✓ empty pageImages array is rejected
  ✓ missing pdf-lib dependency is rejected

====================
23 passed, 0 failed
ALL TESTS PASSED
```

Exit code is `0` on success, non-zero on any failure (CI-friendly).

---

## 2. Manual browser test plan

These steps cover the browser-only surface. Each was verified during development by driving
the real app programmatically (see the note at the end).

### Setup
Open `index.html` in Chrome/Edge/Firefox (double-click, or serve the folder). Be online so the
two CDN scripts load.

### T1 — Happy path, single page
1. Open a one-page PDF that contains obvious text (e.g. your name).
2. **Expect:** the page renders; the header shows `Pages: 1`; Burn is enabled.
3. Draw a box over your name. **Expect:** `Redactions: 1`; the box is solid black with a red
   outline and a `×` / resize handle when selected.
4. Click **Burn & Redact**. **Expect:** a progress overlay, then the Verification panel shows
   **`0` characters recoverable — nothing survived**, `Text layer in output: none`,
   `Metadata: stripped`, and Download becomes enabled.
5. Click **Download**. Open the downloaded `*-redacted.pdf` in a viewer and try to select text
   under the box with the mouse / `Ctrl+F`. **Expect:** nothing is selectable or found.

### T2 — Edit operations
1. Draw three boxes. Drag one to move it; resize another with the corner handle; select the
   third and press <kbd>Delete</kbd>. **Expect:** count tracks each change; `Esc` deselects.

### T3 — Multi-page & mixed sizes
1. Open a multi-page PDF (ideally mixing page sizes). Put at least one box on page 1 and one on
   a later page. Burn.
2. **Expect:** `Pages flattened` equals the real page count; every page becomes an image;
   Verify reports **0** characters total.

### T4 — Burn with no boxes
1. Open a PDF, draw nothing, click Burn. **Expect:** a confirmation prompt warning the output
   will be image-only with no text layer. Confirm. **Expect:** Verify reports **0** characters
   (the whole document is flattened regardless).

### T5 — Error handling (no silent failures)
1. Rename a non-PDF (e.g. a `.png`) to `.pdf` and open it, **or** open a truncated/corrupt PDF.
   **Expect:** a red error toast — *"This file appears corrupt or is not a valid PDF."* — and
   the dropzone returns; the app does not hang or produce a bad file.
2. Open a password-protected PDF. **Expect:** *"This PDF is password-protected / encrypted.
   Remove the password first, then redact."*

### T6 — No upload
1. Open DevTools → Network, clear it, then open and burn a PDF.
2. **Expect:** the only requests are the two CDN `<script>` tags (and pdf.js worker / standard
   fonts / CMaps from the same pinned package on first load). **No request carries your PDF.**

### T7 — Verify catches a leak (negative control)
The verdict is honest, not cosmetic: if a page in the output still exposed text, the panel
turns red and reads *"character(s) recoverable … WARNING: text remains!"* with a "do not trust
this file" message. (A correct flatten never triggers this.)

---

### Development verification note

During development the full browser pipeline was exercised headlessly by injecting a generated
PDF into the real `#file` input, synthesizing a drawn redaction box, clicking **Burn**, and
reading the Verification panel. Observed result: **1 box drawn → "0 characters recoverable from
the redacted PDF — nothing survived", Text layer: none, Metadata: stripped, Download enabled.**
The canvas→JPEG→rebuild→re-extract chain and pdf.js rendering of a non-embedded Helvetica page
were each confirmed working in-browser, and the corrupt-file path produced the expected error
toast with recovery.
