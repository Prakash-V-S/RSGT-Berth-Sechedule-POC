import * as fs from 'fs';
import * as path from 'path';

const JSZip = require('jszip');

const ANCHOR_RE =
  /<(xdr:(?:twoCell|oneCell|absolute)Anchor)\b[^>]*>[\s\S]*?<\/\1>/g;

function shapeKey(xml: string): string {
  const name = (xml.match(/<xdr:cNvPr\b[^>]*\bname="([^"]+)"/) || [])[1] || '';
  const col = (xml.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)/) || [])[1] || '';
  const row = (xml.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)/) || [])[1] || '';
  return `${name}@${col},${row}`;
}

function extractHeaderShapes(drawingXml: string, maxHeaderRow: number): string[] {
  return [...drawingXml.matchAll(ANCHOR_RE)]
    .map((m) => m[0])
    .filter((xml) => {
      // AutoShapes / textboxes / freeforms only — not pictures
      if (!/<xdr:sp[\s>]/.test(xml)) return false;
      const rowMatch = xml.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)/);
      const row = rowMatch ? Number(rowMatch[1]) : Number.POSITIVE_INFINITY;
      return row <= maxHeaderRow;
    });
}

/**
 * ExcelJS drops AutoShapes when rewriting an .xlsx.
 * Re-inject header shapes from the **active** template only
 * (whatever is currently in empty-template.xlsx — including intentional deletions).
 */
export async function restoreTemplateHeaderShapes(
  templatePath: string,
  outputPath: string,
  options: { maxHeaderRow?: number } = {},
): Promise<number> {
  const maxHeaderRow = options.maxHeaderRow ?? 9;
  const absTemplate = path.resolve(templatePath);
  const absOutput = path.resolve(outputPath);

  if (!fs.existsSync(absTemplate)) {
    throw new Error(`Template not found: ${absTemplate}`);
  }
  if (!fs.existsSync(absOutput)) {
    throw new Error(`Output workbook not found: ${absOutput}`);
  }

  const tmplZip = await JSZip.loadAsync(fs.readFileSync(absTemplate));
  const outZip = await JSZip.loadAsync(fs.readFileSync(absOutput));

  const tmplDrawingFile = tmplZip.file('xl/drawings/drawing1.xml');
  const outDrawingFile = outZip.file('xl/drawings/drawing1.xml');
  if (!tmplDrawingFile || !outDrawingFile) {
    return 0;
  }

  const tmplDrawing: string = await tmplDrawingFile.async('string');
  let outDrawing: string = await outDrawingFile.async('string');

  const headerShapes = extractHeaderShapes(tmplDrawing, maxHeaderRow);
  if (headerShapes.length === 0) return 0;

  // Idempotent: skip shapes already present (by name + anchor cell)
  const existingKeys = new Set(
    extractHeaderShapes(outDrawing, maxHeaderRow).map(shapeKey),
  );
  const missingShapes = headerShapes.filter((xml) => !existingKeys.has(shapeKey(xml)));
  if (missingShapes.length === 0) return 0;

  let nextId =
    Math.max(
      0,
      ...[...outDrawing.matchAll(/\bid="(\d+)"/g)].map((m) => Number(m[1])),
    ) + 1;

  const remapped = missingShapes.map((xml) =>
    xml.replace(
      /(<xdr:cNvPr\b[^>]*\bid=")(\d+)(")/g,
      (_full, prefix: string, _id: string, suffix: string) =>
        `${prefix}${nextId++}${suffix}`,
    ),
  );

  if (!outDrawing.includes('</xdr:wsDr>')) {
    throw new Error('Output drawing1.xml is missing </xdr:wsDr> root close.');
  }

  outDrawing = outDrawing.replace(
    '</xdr:wsDr>',
    `${remapped.join('')}</xdr:wsDr>`,
  );
  outZip.file('xl/drawings/drawing1.xml', outDrawing);

  const buffer = await outZip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
  fs.writeFileSync(absOutput, buffer);
  return remapped.length;
}
