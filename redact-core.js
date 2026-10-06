/*
 * TrueRedact — core redaction logic.
 *
 * This module is deliberately environment-agnostic and imports NOTHING: every
 * dependency is injected. The exact same code runs in the browser (fed pdf-lib
 * from a CDN global and page images rendered on a <canvas>) and in Node (fed
 * pdf-lib via require() and synthetic page images by the test harness). That is
 * what lets the automated test exercise the real production code path instead
 * of a re-implementation.
 *
 * It is published as a UMD module so it loads as a plain <script> straight off
 * the local filesystem (no build step, no ES-module/CORS trouble under
 * file://) and still require()s cleanly in Node.
 *
 * SECURITY MODEL: we NEVER copy pages from the source PDF. We build a brand-new
 * document whose every page is a single flattened raster image with the
 * redaction boxes already painted into the pixels. There is therefore no text
 * layer, no font, no vector content and no original object to recover — the
 * hidden text under a box is physically absent from the output bytes.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;               // Node / CommonJS
  } else {
    root.TrueRedactCore = api;          // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Rebuild a flattened, redacted PDF from pre-rasterized page images.
   *
   * @param {Object} opts
   * @param {Array}  opts.pageImages Array of { bytes, type, width, height }:
   *   - bytes:  Uint8Array of a PNG or JPEG image (the fully-rendered page with
   *             redaction boxes already burned into the pixels).
   *   - type:   'png' | 'jpeg'
   *   - width:  page width in PDF points.
   *   - height: page height in PDF points.
   * @param {Object} opts.PDFLib     The pdf-lib module (browser global or Node import).
   * @returns {Promise<Uint8Array>}  The new PDF file bytes.
   */
  async function rebuildFlattenedPdf(opts) {
    var pageImages = opts && opts.pageImages;
    var PDFLib = opts && opts.PDFLib;

    if (!PDFLib || !PDFLib.PDFDocument) {
      throw new Error('rebuildFlattenedPdf: a valid pdf-lib dependency is required.');
    }
    if (!Array.isArray(pageImages) || pageImages.length === 0) {
      throw new Error('rebuildFlattenedPdf: at least one page image is required.');
    }

    var PDFDocument = PDFLib.PDFDocument;
    // updateMetadata:false stops pdf-lib auto-stamping Producer/Creator/dates
    // into the output Info dictionary — so the rebuilt file carries no
    // tool fingerprint or local timestamp.
    var outDoc = await PDFDocument.create({ updateMetadata: false });

    for (var i = 0; i < pageImages.length; i++) {
      var img = pageImages[i];
      if (!img || !img.bytes || !img.width || !img.height) {
        throw new Error('rebuildFlattenedPdf: each page image needs bytes, width and height.');
      }
      var embedded = img.type === 'png'
        ? await outDoc.embedPng(img.bytes)
        : await outDoc.embedJpg(img.bytes);

      var page = outDoc.addPage([img.width, img.height]);
      // The raster exactly fills the page. The image IS the page.
      page.drawImage(embedded, { x: 0, y: 0, width: img.width, height: img.height });
    }

    stripMetadata(outDoc);
    return outDoc.save({ useObjectStreams: true });
  }

  /**
   * Remove identifying document metadata from a pdf-lib document.
   *
   * Because rebuildFlattenedPdf always starts from PDFDocument.create(), the
   * source document's Info dictionary and XMP packet never transfer in the
   * first place. This additionally clears pdf-lib's own auto-populated
   * Producer/Creator fields and physically deletes lingering Info entries so
   * the output carries no author, title, subject, keywords or tool fingerprint.
   */
  function stripMetadata(pdfDoc) {
    // Overwrite the standard Info fields with empty values.
    try { pdfDoc.setTitle(''); } catch (e) {}
    try { pdfDoc.setAuthor(''); } catch (e) {}
    try { pdfDoc.setSubject(''); } catch (e) {}
    try { pdfDoc.setKeywords([]); } catch (e) {}
    try { pdfDoc.setProducer(''); } catch (e) {}
    try { pdfDoc.setCreator(''); } catch (e) {}

    // Belt-and-braces: physically delete the identifying Info keys so not even
    // an empty string remains. Guarded because it touches pdf-lib internals.
    try {
      var ctx = pdfDoc.context;
      var infoRef = ctx && ctx.trailerInfo && ctx.trailerInfo.Info;
      if (infoRef) {
        var infoDict = ctx.lookup(infoRef);
        if (infoDict && typeof infoDict.delete === 'function') {
          var keys = ['Title', 'Author', 'Subject', 'Keywords', 'Producer', 'Creator'];
          for (var k = 0; k < keys.length; k++) {
            try { infoDict.delete(ctx.obj(keys[k])); } catch (e) {}
          }
        }
      }
    } catch (e) {
      // Non-fatal: the empty-string setters above already neutralised the fields.
    }
  }

  /**
   * Convert redaction rectangles stored in normalized [0..1] page coordinates
   * into integer pixel rectangles for a canvas of the given size. Shared by the
   * browser burn path and available to tests.
   */
  function normalizedRectsToPixels(rects, pxWidth, pxHeight) {
    return (rects || []).map(function (r) {
      return {
        x: Math.round(r.x * pxWidth),
        y: Math.round(r.y * pxHeight),
        w: Math.round(r.w * pxWidth),
        h: Math.round(r.h * pxHeight),
      };
    });
  }

  return {
    rebuildFlattenedPdf: rebuildFlattenedPdf,
    stripMetadata: stripMetadata,
    normalizedRectsToPixels: normalizedRectsToPixels,
  };
});
