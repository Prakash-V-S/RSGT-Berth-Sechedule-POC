import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAIN_SHEET_NAME = 'MAIN BERTH PLAN';
/** Side padding around cropped content (PDF points). */
const PAD = 5;

type SideCrop = { left: number; right: number };

/**
 * Crop left/right letterboxing only. Never touch top/bottom —
 * vertical MediaBox crops were slicing vessel blocks and sticky lanes.
 */
function applySideCrop(pdfPath: string, sides: SideCrop): boolean {
  let pdf = fs.readFileSync(pdfPath, 'latin1');
  const mb = pdf.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!mb) return false;

  const pageW = parseFloat(mb[3]);
  const pageH = parseFloat(mb[4]);

  let left = Math.max(0, Math.min(sides.left, pageW - 40));
  let right = Math.max(left + 40, Math.min(sides.right, pageW));
  const bottom = 0;
  const top = pageH;

  const box = `[${left.toFixed(2)} ${bottom.toFixed(2)} ${right.toFixed(2)} ${top.toFixed(2)}]`;
  const mediaBox = `/MediaBox ${box}`;
  const cropBox = `/CropBox ${box}`;

  pdf = pdf.replace(/\/MediaBox\s*\[[^\]]*\]/g, mediaBox);
  if (/\/CropBox\s*\[/.test(pdf)) {
    pdf = pdf.replace(/\/CropBox\s*\[[^\]]*\]/g, cropBox);
  } else {
    pdf = pdf.replace(/\/MediaBox\s*\[[^\]]*\]/g, (m) => `${m}\n${cropBox}`);
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

  $marginPts = 8.0
  $topMarginPts = 12.0
  $bottomMarginPts = 10.0

  $excel.PrintCommunication = $false
  try {
    $ps = $sheet.PageSetup
    $ps.PrintArea = $printArea
    $ps.Orientation = 2
    try { $ps.PaperSize = 3 } catch { try { $ps.PaperSize = 1 } catch {} }
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
  } finally {
    $excel.PrintCommunication = $true
  }

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
  $pageWPts = $excel.InchesToPoints([Math]::Max($a, $b))
  $pageHPts = $excel.InchesToPoints([Math]::Min($a, $b))
  $printableW = [Math]::Max(1.0, $pageWPts - (2 * $marginPts))
  $printableH = [Math]::Max(1.0, $pageHPts - $topMarginPts - $bottomMarginPts)
  if ($contentW -le 0) { $contentW = $printableW }
  if ($contentH -le 0) { $contentH = $printableH }

  $fitScale = [Math]::Min($printableW / $contentW, $printableH / $contentH)
  $scaledW = $contentW * $fitScale
  $contentLeft = (($pageWPts - $scaledW) / 2.0)
  $contentRight = $contentLeft + $scaledW
  if (($scaledW / $pageWPts) -gt 0.92) {
    $scaledW = $pageWPts * 0.78
    $contentLeft = ($pageWPts - $scaledW) / 2.0
    $contentRight = $contentLeft + $scaledW
  }

  # Re-assert fit-to-1x1 after PrintCommunication is on (Excel often ignores the first set)
  $excel.PrintCommunication = $false
  try {
    $sheet.PageSetup.Zoom = $false
    $sheet.PageSetup.FitToPagesWide = 1
    $sheet.PageSetup.FitToPagesTall = 1
  } finally {
    $excel.PrintCommunication = $true
  }
  $sheet.PageSetup.Zoom = $false
  $sheet.PageSetup.FitToPagesWide = 1
  $sheet.PageSetup.FitToPagesTall = 1

  # Export every printed page so nothing is dropped if Excel still paginates
  $sheet.ExportAsFixedFormat(0, '${q(pdfPath)}', 0, $true, $false)

  Write-Output ("RSGT_CROP|$contentLeft|$contentRight")
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

  const scriptPath = path.join(
    os.tmpdir(),
    `rsgt-excel-to-pdf-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`,
  );
  fs.writeFileSync(scriptPath, buildExportScript(absXlsx, absPdf, sheetName), 'utf8');

  let sides: SideCrop | null = null;
  try {
    const { stdout, stderr } = await execFileAsync(
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
      sides = {
        left: parseFloat(p[1]) || 0,
        right: parseFloat(p[2]) || 0,
      };
    }
    if (stderr && String(stderr).trim()) {
      // non-fatal diagnostics from Write-Output paths shouldn't appear here
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

  try {
    const raw = fs.readFileSync(absPdf, 'latin1');
    const mb = raw.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    const pageW = mb ? parseFloat(mb[3]) : 1224;

    const src = sides ?? {
      left: pageW * 0.11,
      right: pageW * 0.89,
    };
    applySideCrop(absPdf, {
      left: src.left - PAD,
      right: src.right + PAD,
    });
  } catch {
    /* non-fatal */
  }
}
