import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';

describe('Excel Berth Plan Generator CLI', () => {
  const inputDir = path.join(__dirname, '../data');
  const inputPath = path.join(inputDir, 'test-excel-input.csv');
  const outputDir = path.join(__dirname, '../output');
  const outputPath = path.join(outputDir, 'berth-plan.xlsx');

  beforeAll(() => {
    if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
    
    // Create a mock input CSV with valid dates
    const mockCsv = `Displaying 10 item(s) at 2026-09-02,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
Visit,Vessel Name,Line,Vessel Class,I/B Vyg,O/B Vyg,Phase,Est. Time of Berth,ETD,ETA,ATA,ATD,ATB,Service,Vessel Loa M,BEAM M,Berthside,Bollard Fore,Bollard Fore offset,Bollard Aft,Bollard Aft offset,Draft Forward,Draft Aft,Est Disch,Previous Port,Next Port,EST Loading,Additional Moves,Total Moves,vessel berth,Bollard Fore Meter,Bollard Aft Meter,"LOA Check (Fore-Aft, m)"
TSSNTSGP2606W,VALID VESSEL,TSL,TSSN,TSGP2606W,TSGP2606W,Inbound,26-Sep-02 0800,2026-09-04 19:00,2026-08-30 19:00,,,,ADHOC,260,32,Starboardside,1R19,6,1R2,1,,,,,JIB,,,,R1,291,31,0
INVALID_NO_ETA,INVALID VESSEL,TSL,TSSN,TSGP2606W,TSGP2606W,Inbound,26-Sep-02 0800,2026-09-04 19:00,,,,,ADHOC,260,32,Starboardside,1R19,6,1R2,1,,,,,JIB,,,,R1,291,31,0
`;
    fs.writeFileSync(inputPath, mockCsv, 'utf8');
  });

  afterAll(() => {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  });

  it('generates the excel workbook correctly', async () => {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    // Run CLI
    const output = execSync(`npx ts-node src/generate-berth-plan.ts`, {
      env: {
        ...process.env,
        INPUT_CSV_PATH: inputPath,
        OUTPUT_EXCEL_PATH: outputPath,
      },
      encoding: 'utf8',
    });

    expect(output).toContain('Total records: 2');
    expect(output).toContain('Successfully processed: 1');
    expect(output).toContain('Validation errors: 1');
    expect(output).toContain('INVALID VESSEL');

    // Verify output file creation
    expect(fs.existsSync(outputPath)).toBe(true);

    // Read the Excel workbook to verify structure
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(outputPath);

    // Verify sheet names
    const mainSheet = workbook.getWorksheet('MAIN BERTH PLAN');
    const dataSheet = workbook.getWorksheet('DATA SUMMARY');

    expect(mainSheet).toBeDefined();
    expect(dataSheet).toBeDefined();

    // Verify MAIN BERTH PLAN grid
    const title = mainSheet!.getCell(1, 1).value as string;
    expect(title).toContain('RSGT LOGO');
    
    // Verify Vessel plotting logic
    // The valid vessel should be present in the summary sheet at least
    let foundValid = false;
    dataSheet!.eachRow((row) => {
      if (row.getCell(1).value === 'VALID VESSEL') {
         foundValid = true;
         expect(row.getCell(3).value).toBe('VALID');
      }
    });
    expect(foundValid).toBe(true);
  }, 30000);
});
