import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MAIN_SHEET_NAME = 'MAIN BERTH PLAN';

/**
 * Convert only the MAIN BERTH PLAN worksheet to PDF via Microsoft Excel COM (Windows).
 * Requires Microsoft Excel to be installed.
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

  # Template historically used ~10% zoom, which leaves the plan tiny with huge white space.
  # Fit MAIN BERTH PLAN print area to a single landscape page before PDF export.
  $used = $sheet.UsedRange
  $printArea = $sheet.PageSetup.PrintArea
  if ([string]::IsNullOrWhiteSpace($printArea)) {
    $printArea = $used.Address
  }
  $sheet.PageSetup.PrintArea = $printArea
  $sheet.PageSetup.Orientation = 2          # xlLandscape
  $sheet.PageSetup.Zoom = $false            # required for FitToPages* to apply
  $sheet.PageSetup.FitToPagesWide = 1
  $sheet.PageSetup.FitToPagesTall = 1
  $sheet.PageSetup.LeftMargin = $excel.InchesToPoints(0.25)
  $sheet.PageSetup.RightMargin = $excel.InchesToPoints(0.25)
  $sheet.PageSetup.TopMargin = $excel.InchesToPoints(0.25)
  $sheet.PageSetup.BottomMargin = $excel.InchesToPoints(0.25)
  $sheet.PageSetup.HeaderMargin = $excel.InchesToPoints(0.1)
  $sheet.PageSetup.FooterMargin = $excel.InchesToPoints(0.1)
  $sheet.PageSetup.CenterHorizontally = $true
  $sheet.PageSetup.CenterVertically = $true

  # Export only MAIN BERTH PLAN (0 = xlTypePDF); IgnorePrintAreas = false
  $sheet.ExportAsFixedFormat(0, '${psPdf}', 0, $true, $false)
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

  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
      },
    );
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
}
