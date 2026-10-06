/*
 * TrueRedact — automated core test (runs headless in Node).
 *
 * What this proves: the SAME core module the browser ships (redact-core.js)
 * takes a set of page images, rebuilds a brand-new PDF, and strips metadata —
 * such that NO text is extractable from the output and NO source metadata
 * survives.
 *
 * Strategy:
 *   1. Build a realistic source PDF with pdf-lib: visible secret text plus
 *      identifying Author/Title/Subject/Keywords/Producer metadata.
 *   2. SANITY-CHECK the harness: extract text from that source with pdf.js and
 *      assert the secret string IS found. If this failed, a later "0 chars"
 *      result would be meaningless (false negative), so we fail loudly.
 *   3. Rasterize each page to a solid PNG (hand-encoded, no native deps) at the
 *      page's point dimensions — standing in for the browser's canvas raster.
 *   4. Run the real Core.rebuildFlattenedPdf() over those images.
 *   5. Extract text from the OUTPUT with pdf.js → assert 0 characters and that
 *      the secret string is absent.
 *   6. Re-open the output with pdf-lib → assert metadata is gone, and that the
 *      source's Author/Title strings do not appear anywhere in the raw bytes.
 *   7. Assert page count and page dimensions are preserved.
 *
 * Exit code 0 = all assertions passed; non-zero = failure.
 */
'use strict';

const zlib = require('zlib');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const Core = require('../redact-core.js');

// pdf.js legacy build runs in Node without a browser.
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

// ---------------------------------------------------------------------------
// Tiny assertion helpers
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failures.push(msg); console.log('  ✗ ' + msg); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, msg + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
}

// ---------------------------------------------------------------------------
// Minimal solid-color RGBA PNG encoder (stands in for the browser canvas).
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function solidPng(width, height, rgbaArr) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw image: each row = filter byte (0) + width*4 bytes
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) {
    row[1 + x * 4] = rgbaArr[0];
    row[1 + x * 4 + 1] = rgbaArr[1];
    row[1 + x * 4 + 2] = rgbaArr[2];
    row[1 + x * 4 + 3] = rgbaArr[3];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idat = zlib.deflateSync(raw);
  return new Uint8Array(Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------------------
async function extractText(bytes) {
  const copy = bytes.slice(0);
  const doc = await pdfjs.getDocument({ data: copy, isEvalSupported: false }).promise;
  let all = '';
  const perPage = [];
  const sizes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push([Math.round(vp.width), Math.round(vp.height)]);
    const tc = await page.getTextContent();
    const txt = tc.items.map((it) => it.str || '').join('');
    perPage.push(txt.replace(/\s/g, '').length);
    all += txt;
  }
  return { numPages: doc.numPages, text: all, chars: all.replace(/\s/g, '').length, perPage, sizes };
}

async function buildSourcePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Classified Dossier');
  doc.setAuthor('Jane Secret');
  doc.setSubject('TOP SECRET');
  doc.setKeywords(['confidential', 'eyes-only']);
  doc.setProducer('SecretWriter 9000');
  doc.setCreator('SecretWriter 9000');

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const SECRET = 'TOP-SECRET-AGENT-NAME-JASON-BOURNE';

  const specs = [[612, 792], [595, 842]]; // Letter + A4, different sizes on purpose
  for (const [w, h] of specs) {
    const page = doc.addPage([w, h]);
    page.drawText('Mission Briefing', { x: 50, y: h - 80, size: 22, font, color: rgb(0, 0, 0) });
    page.drawText(SECRET, { x: 50, y: h - 140, size: 16, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawText('This line would be hidden under a black box in a fake redaction.',
      { x: 50, y: h - 180, size: 12, font });
  }
  return { bytes: await doc.save(), secret: SECRET };
}

// ---------------------------------------------------------------------------
(async function run() {
  console.log('TrueRedact core test\n====================\n');

  // 1. Build source
  const { bytes: srcBytes, secret } = await buildSourcePdf();

  // 2. Sanity: the harness can actually SEE text in a normal PDF.
  console.log('[sanity] source PDF should contain extractable secret text');
  const srcExtract = await extractText(srcBytes);
  ok(srcExtract.text.indexOf(secret) !== -1, 'secret string is extractable from the UN-redacted source');
  ok(srcExtract.chars > 0, 'source has > 0 extractable characters (' + srcExtract.chars + ')');
  eq(srcExtract.numPages, 2, 'source has 2 pages');
  const srcMetaDoc = await PDFDocument.load(srcBytes);
  eq(srcMetaDoc.getAuthor(), 'Jane Secret', 'source Author metadata is present');

  // 3. Rasterize each source page to a solid PNG at its point size.
  console.log('\n[core] flatten + rebuild via redact-core.js');
  const pageImages = srcExtract.sizes.map(([w, h]) => ({
    bytes: solidPng(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)), [20, 22, 28, 255]),
    type: 'png',
    width: w,
    height: h,
  }));

  // 4. Run the real production core.
  const outBytes = await Core.rebuildFlattenedPdf({ pageImages, PDFLib: { PDFDocument } });
  ok(outBytes && outBytes.length > 0, 'core produced non-empty output (' + outBytes.length + ' bytes)');

  // 5. No text must be extractable from the output.
  console.log('\n[verify] output must have ZERO extractable text');
  const outExtract = await extractText(outBytes);
  eq(outExtract.chars, 0, 'output has 0 extractable characters');
  ok(outExtract.text.indexOf(secret) === -1, 'secret string is GONE from the output');
  outExtract.perPage.forEach((n, i) => eq(n, 0, 'page ' + (i + 1) + ' exposes 0 characters'));

  // 6. Metadata must be stripped and secrets absent from raw bytes.
  console.log('\n[verify] metadata stripped, no source strings in raw bytes');
  // Inspect the ACTUAL bytes: load with updateMetadata:false, otherwise
  // pdf-lib's loader itself re-stamps a default Producer that is not in the file.
  const outDoc = await PDFDocument.load(outBytes, { updateMetadata: false });
  ok(!outDoc.getAuthor(), 'output Author is empty/undefined (' + JSON.stringify(outDoc.getAuthor()) + ')');
  ok(!outDoc.getTitle(), 'output Title is empty/undefined (' + JSON.stringify(outDoc.getTitle()) + ')');
  ok(!outDoc.getSubject(), 'output Subject is empty/undefined');
  ok(!outDoc.getProducer(), 'output Producer is empty/undefined (' + JSON.stringify(outDoc.getProducer()) + ')');
  const rawStr = Buffer.from(outBytes).toString('latin1');
  ok(rawStr.indexOf('Jane Secret') === -1, '"Jane Secret" does not appear anywhere in the raw output bytes');
  ok(rawStr.indexOf('Classified Dossier') === -1, '"Classified Dossier" title string is absent from raw bytes');
  ok(rawStr.indexOf('SecretWriter') === -1, 'source Producer "SecretWriter 9000" is absent from raw bytes');
  ok(rawStr.indexOf('Hopding') === -1, 'no pdf-lib tool fingerprint ("Hopding") is written into the output');
  ok(rawStr.indexOf(secret) === -1, 'secret string is absent from the raw output bytes');

  // 7. Structure preserved.
  console.log('\n[verify] structure preserved');
  eq(outExtract.numPages, 2, 'output still has 2 pages');
  eq(outExtract.sizes[0].join('x'), srcExtract.sizes[0].join('x'), 'page 1 dimensions preserved');
  eq(outExtract.sizes[1].join('x'), srcExtract.sizes[1].join('x'), 'page 2 dimensions preserved');

  // 8. Core input validation.
  console.log('\n[guard] core rejects bad input');
  let threw = false;
  try { await Core.rebuildFlattenedPdf({ pageImages: [], PDFLib: { PDFDocument } }); } catch (_) { threw = true; }
  ok(threw, 'empty pageImages array is rejected');
  threw = false;
  try { await Core.rebuildFlattenedPdf({ pageImages, PDFLib: null }); } catch (_) { threw = true; }
  ok(threw, 'missing pdf-lib dependency is rejected');

  // Report
  console.log('\n====================');
  console.log(passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL TESTS PASSED');
  process.exit(0);
})().catch((err) => {
  console.error('\nTest harness crashed:', err);
  process.exit(2);
});
