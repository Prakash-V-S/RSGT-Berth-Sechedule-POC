import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAIN_SHEET_NAME = 'MAIN BERTH PLAN';
/** Keep a few points of pad after tight crop (PDF points). */
const PAD = 4;

type PageRect = { left: number; bottom: number; right: number; top: number };

/**
 * Shrink MediaBox/CropBox to the plan so side/bottom letterboxing disappears.
 * Never raises the top (keeps header). PDF y-axis is bottom-up.
 */
function applyTightPageBox(pdfPath: string, rect: PageRect): boolean {
  let pdf = fs.readFileSync(pdfPath, 'latin1');
  const mb = pdf.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!mb) return false;

  const pageW = parseFloat(mb[3]);
  const pageH = parseFloat(mb[4]);

  let left = Math.max(0, Math.min(rect.left, pageW - 40));
  let right = Math.max(left + 40, Math.min(rect.right, pageW));
  let bottom = Math.max(0, Math.min(rect.bottom, pageH - 40));
  // Always keep full page top so header / R-row is never sliced
  const top = pageH;

  const box = `[${left.toFixed(2)} ${bottom.toFixed(2)} ${right.toFixed(2)} ${top.toFixed(2)}]`;
  pdf = pdf.replace(/\/MediaBox\s*\[[^\]]*\]/g, `/MediaBox ${box}`);
  if (/\/CropBox\s*\[/.test(pdf)) {
    pdf = pdf.replace(/\/CropBox\s*\[[^\]]*\]/g, `/CropBox ${box}`);
  } else {
    pdf = pdf.replace(/\/MediaBox\s*\[[^\]]*\]/g, (m) => `${m}\n/CropBox ${box}`);
  }
  fs.writeFileSync(pdfPath, pdf, 'latin1');
  return true;
}

function buildExportScript(xlsxPath: string, pdfPath: string, sheetName: string): string {
  const q = (s: string) => s.replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open('${q(xlsxPath)}')
  $sheet = $null
  foreach ($ws in $workbook.Worksheets) {
    if ($ws.Name -eq '${q(sheetName)}') { $sheet = $ws; break }
  }
  if ($null -eq $sheet) { throw "Worksheet '${q(sheetName)}' not found in workbook." }

  foreach ($ws in $workbook.Worksheets) {
    if ($ws.Name -ne '${q(sheetName)}') { $ws.Visible = 0 }
  }
  $sheet.Activate() | Out-Null

  $used = $sheet.UsedRange
  $printArea = [string]$sheet.PageSetup.PrintArea
  if ([string]::IsNullOrWhiteSpace($printArea)) { $printArea = $used.Address }

  # Tiny margins — berth X-axis is fixed; fill landscape width edge-to-edge
  $marginPts = 4.0
  $topMarginPts = 4.0
  $bottomMarginPts = 4.0

  function Set-RsgtPageFit($worksheet, $area) {
    $ps = $worksheet.PageSetup
    $ps.PrintArea = $area
    $ps.Orientation = 1
    $ps.PaperSize = 9
    $ps.LeftMargin = $marginPts
    $ps.RightMargin = $marginPts
    $ps.TopMargin = $topMarginPts
    $ps.BottomMargin = $bottomMarginPts
    $ps.HeaderMargin = 0
    $ps.FooterMargin = 0
    $ps.CenterHorizontally = $true
    $ps.CenterVertically = $false
    $ps.Zoom = $false
    $ps.FitToPagesWide = 1
    $ps.FitToPagesTall = 1
  }

  $excel.PrintCommunication = $false
  try {
    Set-RsgtPageFit $sheet $printArea
  } finally {
    $excel.PrintCommunication = $true
  }
  Set-RsgtPageFit $sheet $printArea

  $range = $sheet.Range($printArea)
  $contentW = [double]$range.Width
  $contentH = [double]$range.Height

  $paper = [int]$sheet.PageSetup.PaperSize
  switch ($paper) {
    1 { $a = 8.5;  $b = 11.0 }
    3 { $a = 11.0; $b = 17.0 }
    8 { $a = 11.69; $b = 16.54 }
    9 { $a = 8.27; $b = 11.69 }
    default { $a = 11.0; $b = 17.0 }
  }
  $pageWPts = $excel.InchesToPoints([Math]::Min($a, $b))
  $pageHPts = $excel.InchesToPoints([Math]::Max($a, $b))
  $printableW = [Math]::Max(1.0, $pageWPts - (2 * $marginPts))
  $printableH = [Math]::Max(1.0, $pageHPts - $topMarginPts - $bottomMarginPts)
  if ($contentW -le 0) { $contentW = $printableW }
  if ($contentH -le 0) { $contentH = $printableH }

  # Zoom from both width and height to fit 7 days onto a single page
  $zoomByW = [int][Math]::Max(10, [Math]::Min(100, [Math]::Floor(($printableW / $contentW) * 100)))
  $zoomByH = [int][Math]::Max(10, [Math]::Min(100, [Math]::Floor(($printableH / $contentH) * 100)))
  $zoomPct = [Math]::Min($zoomByW, $zoomByH)
  
  $excel.PrintCommunication = $false
  try {
    $sheet.PageSetup.Zoom = $zoomPct
  } finally {
    $excel.PrintCommunication = $true
  }
  $sheet.PageSetup.Zoom = $zoomPct

  # Guarantee no vertical page breaks
  for ($i = 0; $i -lt 30; $i++) {
    $vBreaks = 0
    try { $vBreaks = [int]$sheet.VPageBreaks.Count } catch {}
    if ($vBreaks -eq 0) { break }
    if ($zoomPct -le 10) { break }
    $zoomPct = [Math]::Max(10, $zoomPct - 3)
    $sheet.PageSetup.Zoom = $zoomPct
  }

  # Guarantee no horizontal page breaks
  for ($i = 0; $i -lt 40; $i++) {
    $hBreaks = 0
    try { $hBreaks = [int]$sheet.HPageBreaks.Count } catch {}
    if ($hBreaks -eq 0) { break }
    if ($zoomPct -le 10) { break }
    $zoomPct = [Math]::Max(10, $zoomPct - 3)
    $sheet.PageSetup.Zoom = $zoomPct
  }

  $scaledW = $contentW * ($zoomPct / 100.0)
  $scaledH = $contentH * ($zoomPct / 100.0)
  $contentLeft = [Math]::Max(0.0, ($pageWPts - $scaledW) / 2.0)
  $contentRight = [Math]::Min($pageWPts, $contentLeft + $scaledW)
  # Top-aligned (CenterVertically = false)
  $contentTop = $pageHPts - $topMarginPts
  $contentBottom = [Math]::Max(0.0, $contentTop - $scaledH)

  $sheet.ExportAsFixedFormat(0, '${q(pdfPath)}', 0, $true, $false)

  Write-Output ("RSGT_CROP|$contentLeft|$contentBottom|$contentRight|$contentTop")
  Write-Output ("RSGT_PAGE|paper=$paper|zoom=$zoomPct|pageW=$pageWPts|pageH=$pageHPts|orient=portrait|vBreaks=$vBreaks")
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $workbook) {
    $workbook.Close($false) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
  }
  if ($null -ne $excel) {
    $excel.Quit() | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
if (-not (Test-Path -LiteralPath '${q(pdfPath)}')) {
  [Console]::Error.WriteLine('PDF file was not created. Is Microsoft Excel installed?')
  exit 1
}
`;
}

/**
 * Convert MAIN BERTH PLAN to portrait PDF filling a single page.
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

  const scriptPath = path.join(
    os.tmpdir(),
    `rsgt-excel-to-pdf-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
  );
  fs.writeFileSync(scriptPath, buildExportScript(absXlsx, absPdf, sheetName), 'utf8');

  let rect: PageRect | null = null;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
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
  } finally {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }
  }

  if (!fs.existsSync(absPdf)) {
    throw new Error(`PDF conversion finished but file is missing: ${absPdf}`);
  }

  // Tight page box: remove leftover side/bottom white only when bounds look sane.
  // With width-fit, left/right should already be near the margins — still trim pad.
  try {
    const raw = fs.readFileSync(absPdf, 'latin1');
    const mb = raw.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    const pageW = mb ? parseFloat(mb[3]) : 1224;
    const pageH = mb ? parseFloat(mb[4]) : 792;
    const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;

    if (rect && pageCount === 1) {
      // Single page: pull sides + bottom in to the plan (keep top)
      applyTightPageBox(absPdf, {
        left: Math.max(0, rect.left - PAD),
        bottom: Math.max(0, rect.bottom - PAD),
        right: Math.min(pageW, rect.right + PAD),
        top: pageH,
      });
    } else if (rect) {
      // Multi-page: only trim sides so every page stays full-width of the plan
      applyTightPageBox(absPdf, {
        left: Math.max(0, rect.left - PAD),
        bottom: 0,
        right: Math.min(pageW, rect.right + PAD),
        top: pageH,
      });
    }
  } catch {
    /* non-fatal */
  }
}
