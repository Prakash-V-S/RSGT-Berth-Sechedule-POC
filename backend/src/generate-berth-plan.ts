import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { DataParserService } from './data-parser/data-parser.service';
import { PositionEngineService } from './position-engine/position-engine.service';
import { ExcelGeneratorService } from './excel-generator/excel-generator.service';
import { convertExcelToPdf } from './export/excel-to-pdf';

/** both = Excel + PDF, pdf = PDF only, xlsx = Excel only */
type OutputFormat = 'both' | 'pdf' | 'xlsx';

function parseFormat(argv: string[]): OutputFormat {
  const arg = argv.find(a => a.startsWith('--format='));
  if (!arg) return 'both';
  const value = arg.split('=')[1]?.toLowerCase();
  if (value === 'both' || value === 'pdf' || value === 'xlsx') return value;
  console.error(`Invalid --format value "${value}". Use both, pdf, or xlsx.`);
  process.exit(1);
}

async function bootstrap() {
  const format = parseFormat(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const configService = app.get(ConfigService);
  const dataParser = app.get(DataParserService);
  const positionEngine = app.get(PositionEngineService);
  const excelGenerator = app.get(ExcelGeneratorService);

  const inputPath = configService.get<string>('INPUT_CSV_PATH') || './data/vessels.csv';
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  let excelOutputPath = configService.get<string>('OUTPUT_EXCEL_PATH') || './output/berth-plan.xlsx';
  if (excelOutputPath === './output/berth-plan.xlsx') {
    excelOutputPath = `./output/berth-plan-${ts}.xlsx`;
  }

  // For pdf-only, write a temp workbook then delete after conversion
  const keepExcel = format === 'both' || format === 'xlsx';
  const excelPathForGeneration =
    format === 'pdf'
      ? path.join(path.dirname(excelOutputPath), `berth-plan-${ts}.tmp.xlsx`)
      : excelOutputPath;

  const pdfOutputPath =
    configService.get<string>('OUTPUT_PDF_PATH') ||
    excelOutputPath.replace(/\.xlsx$/i, '.pdf');

  console.log(`Format: ${format.toUpperCase()}`);
  console.log(`Reading:`);
  console.log(inputPath);
  console.log();

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found at ${inputPath}`);
    process.exit(1);
  }

  const outDir = path.dirname(excelOutputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const rawCsv = fs.readFileSync(inputPath, 'utf8');
  const { records, errors: parseErrors } = dataParser.parse(rawCsv);

  console.log(`Total records: ${records.length + parseErrors.length}`);
  console.log();
  console.log('Processing berth plan...');
  console.log();

  const processed = records.map(record => {
    try {
      const pos = positionEngine.computePosition(record);
      return { record: record, isValid: true, position: pos.position };
    } catch (e: any) {
      return { record: record, isValid: false, error: e.message };
    }
  });

  const result = await excelGenerator.generateBerthPlan(
    processed,
    excelPathForGeneration,
    parseErrors,
  );

  console.log(`Successfully processed: ${result.successful}`);
  console.log(`Validation errors: ${result.invalid}`);
  console.log();

  if (result.errors.length > 0) {
    console.log('Errors:');
    for (const err of result.errors) {
      console.log(`- ${err.vesselName}: ${err.message}`);
    }
    console.log();
  }

  const wantPdf = format === 'both' || format === 'pdf';
  const wantXlsx = format === 'both' || format === 'xlsx';

  if (wantPdf) {
    console.log('Converting MAIN BERTH PLAN to PDF...');
    console.log();
    try {
      await convertExcelToPdf(excelPathForGeneration, pdfOutputPath);
    } catch (err: any) {
      console.error(err?.message || err);
      if (format === 'pdf' && fs.existsSync(excelPathForGeneration)) {
        try { fs.unlinkSync(excelPathForGeneration); } catch (_) {}
      }
      await app.close();
      process.exit(1);
    }
  }

  if (format === 'pdf' && fs.existsSync(excelPathForGeneration)) {
    try {
      fs.unlinkSync(excelPathForGeneration);
    } catch (_) {}
  }

  console.log('Output:');
  if (wantPdf) console.log(`PDF:   ${pdfOutputPath}`);
  if (wantXlsx) console.log(`Excel: ${excelOutputPath}`);
  console.log();

  await app.close();
}

bootstrap().catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
