import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAIN_SHEET_NAME = 'MAIN BERTH PLAN';
/** ~5px padding around the plan on every side (PDF points). */
const PAD = 5;

type CropRect = { left: number; bottom: number; right: number; top: number };

/**
 * Rewrite MediaBox + CropBox so the page itself shrinks to the plan
 * (many viewers ignore CropBox alone and still show full-page side gaps).
 */
function applyTightPageBox(pdfPath: string, rect: CropRect): boolean {
  let pdf = fs.readFileSync(pdfPath, 'latin1');
  const mb = pdf.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!mb) return false;

  const pageW = parseFloat(mb[3]);
  const pageH = parseFloat(mb[4]);

  let { left, bottom, right, top } = rect;
  left = Math.max(0, Math.min(left, pageW - 40));
  right = Math.max(left + 40, Math.min(right, pageW));
  bottom = Math.max(0, Math.min(bottom, pageH - 40));
  top = Math.max(bottom + 40, Math.min(top, pageH));

  const box = `[${left.toFixed(2)} ${bottom.toFixed(2)} ${right.toFixed(2)} ${top.toFixed(2)}]`;
  const mediaBox = `/MediaBox ${box}`;
  const cropBox = `/CropBox ${box}`;

  // Replace every MediaBox; ensure CropBox matches
  pdf = pdf.replace(/\/MediaBox\s*\[[^\]]*\]/g, mediaBox);
  if (/\/CropBox\s*\[/.test(pdf)) {
    pdf = pdf.replace(/\/CropBox\s*\[[^\]]*\]/g, cropBox);
  } else {
    pdf = pdf.replace(/\/MediaBox\s*\[[^\]]*\]/g, (m) => `${m}\n${cropBox}`);
  }

  fs.writeFileSync(pdfPath, pdf, 'latin1');
  return true;
}

/**
 * Convert only the MAIN BERTH PLAN worksheet to PDF via Microsoft Excel COM (Windows).
 */
export async function convertExcelToPdf(
  xlsxPath: string,
  pdfPath: string,
  sheetName: string = MAIN_SHEET_NAME,
): Promise<void> {
  const absXlsx = path.resolve(xlsxPath);
  const absPdf = path.resolve(pdfPath);

  if (!fs.existsSync(absXlsx)) {
    throw new Error(`Excel file not found for PDF conversion: ${absXlsx}`);
  }

  const outDir = path.dirname(absPdf);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const psXlsx = absXlsx.replace(/'/g, "''");
  const psPdf = absPdf.replace(/'/g, "''");
  const psSheet = sheetName.replace(/'/g, "''");

  const script = `
$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open('${psXlsx}')
  $sheet = $null
  foreach ($ws in $workbook.Worksheets) {
    if ($ws.Name -eq '${psSheet}') { $sheet = $ws; break }
  }
  if ($sheet -eq $null) {
    throw "Worksheet '${psSheet}' not found in workbook."
  }

  $used = $sheet.UsedRange
  $printArea = $sheet.PageSetup.PrintArea
  if ([string]::IsNullOrWhiteSpace($printArea)) {
    $printArea = $used.Address
  }

  $marginPts = 5.0

  $excel.PrintCommunication = $false
  try {
    $ps = $sheet.PageSetup
    $ps.PrintArea = $printArea
    $ps.Orientation = 2
    $ps.Zoom = $false
    $ps.FitToPagesWide = 1
    $ps.FitToPagesTall = 1
    $ps.LeftMargin = $marginPts
    $ps.RightMargin = $marginPts
    $ps.TopMargin = $marginPts
    $ps.BottomMargin = $marginPts
    $ps.HeaderMargin = 0
    $ps.FooterMargin = 0
    $ps.CenterHorizontally = $true
    $ps.CenterVertically = $true
  } finally {
    $excel.PrintCommunication = $true
  }

  $range = $sheet.Range($printArea)
  $contentW = [double]$range.Width
  $contentH = [double]$range.Height

  switch ([int]$sheet.PageSetup.PaperSize) {
    1 { $a = 8.5;  $b = 11.0 }
    3 { $a = 11.0; $b = 17.0 }
    8 { $a = 11.69; $b = 16.54 }
    9 { $a = 8.27; $b = 11.69 }
    default { $a = 11.0; $b = 17.0 }
  }
  $pageWPts = $excel.InchesToPoints([Math]::Max($a,$b))
  $pageHPts = $excel.InchesToPoints([Math]::Min($a,$b))
  $printableW = [Math]::Max(1.0, $pageWPts - (2 * $marginPts))
  $printableH = [Math]::Max(1.0, $pageHPts - (2 * $marginPts))
  if ($contentW -le 0) { $contentW = $printableW }
  if ($contentH -le 0) { $contentH = $printableH }

  $scale = [Math]::Min($printableW / $contentW, $printableH / $contentH)
  $scaledW = $contentW * $scale
  $scaledH = $contentH * $scale

  # Centered on page (matches CenterHorizontally/Vertically = true)
  $contentLeft = (($pageWPts - $scaledW) / 2.0)
  $contentRight = $contentLeft + $scaledW
  $contentBottom = (($pageHPts - $scaledH) / 2.0)
  $contentTop = $contentBottom + $scaledH

  # If measurement claims near-full page but exports still letterbox, use observed ~78% width / ~68% height
  $wRatio = $scaledW / $pageWPts
  $hRatio = $scaledH / $pageHPts
  if ($wRatio -gt 0.92) {
    $scaledW = $pageWPts * 0.78
    $contentLeft = ($pageWPts - $scaledW) / 2.0
    $contentRight = $contentLeft + $scaledW
  }
  if ($hRatio -gt 0.90) {
    $scaledH = $pageHPts * 0.68
    $contentBottom = ($pageHPts - $scaledH) / 2.0
    $contentTop = $contentBottom + $scaledH
  }

  $sheet.ExportAsFixedFormat(0, '${psPdf}', 0, $true, $false, 1, 1)

  Write-Output ("RSGT_CROP|{0}|{1}|{2}|{3}" -f $contentLeft, $contentBottom, $contentRight, $contentTop)
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($workbook -ne $null) {
    $workbook.Close($false) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }
  if ($excel -ne $null) {
    $excel.Quit() | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
if (-not (Test-Path -LiteralPath '${psPdf}')) {
  Write-Error 'PDF file was not created. Is Microsoft Excel installed?'
  exit 1
}
`;

  let rect: CropRect | null = null;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
      },
    );
    const line = String(stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .reverse()
      .find((l) => l.startsWith('RSGT_CROP|'));
    if (line) {
      const p = line.split('|');
      rect = {
        left: parseFloat(p[1]) || 0,
        bottom: parseFloat(p[2]) || 0,
        right: parseFloat(p[3]) || 0,
        top: parseFloat(p[4]) || 0,
      };
    }
  } catch (err: any) {
    const detail = [err?.stderr, err?.stdout, err?.message]
      .filter(Boolean)
      .map((s: string | Buffer) => String(s).trim())
      .filter(Boolean)
      .join('\n');
    throw new Error(
      `Failed to convert Excel to PDF. Microsoft Excel must be installed.\n${detail || 'Unknown COM error'}`,
    );
  }

  if (!fs.existsSync(absPdf)) {
    throw new Error(`PDF conversion finished but file is missing: ${absPdf}`);
  }

  try {
    const raw = fs.readFileSync(absPdf, 'latin1');
    const mb = raw.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    const pageW = mb ? parseFloat(mb[3]) : 1224;
    const pageH = mb ? parseFloat(mb[4]) : 792;

    // Default: observed letterboxing ~11% each side, ~16% top/bottom combined → 78% x 68%
    const fallback: CropRect = {
      left: pageW * 0.11,
      bottom: pageH * 0.16,
      right: pageW * 0.89,
      top: pageH * 0.84,
    };

    const src = rect ?? fallback;
    applyTightPageBox(absPdf, {
      left: src.left - PAD,
      bottom: src.bottom - PAD,
      right: src.right + PAD,
      top: src.top + PAD,
    });
  } catch {
    /* non-fatal */
  }
}
