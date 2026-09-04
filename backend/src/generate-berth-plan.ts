import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { CsvReaderService } from './csv-reader/csv-reader.service';
import { DataParserService } from './data-parser/data-parser.service';
import { PositionEngineService } from './position-engine/position-engine.service';
import { ExcelGeneratorService } from './excel-generator/excel-generator.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const configService = app.get(ConfigService);
  const csvReader = app.get(CsvReaderService);
  const dataParser = app.get(DataParserService);
  const positionEngine = app.get(PositionEngineService);
  const excelGenerator = app.get(ExcelGeneratorService);

  const inputPath = configService.get<string>('INPUT_CSV_PATH') || './data/vessels.csv';
  let outputPath = configService.get<string>('OUTPUT_EXCEL_PATH') || './output/berth-plan.xlsx';

  // Auto-append timestamp if the default path is used to prevent EBUSY locks
  if (outputPath === './output/berth-plan.xlsx') {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    outputPath = `./output/berth-plan-${ts}.xlsx`;
  }

  console.log(`Reading:`);
  console.log(inputPath);
  console.log();

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found at ${inputPath}`);
    process.exit(1);
  }

  // 1. Read CSV
  const rawCsv = fs.readFileSync(inputPath, 'utf8');
  
  // 2. Parse data
  const { records, errors: parseErrors } = dataParser.parse(rawCsv);

  console.log(`Total records: ${records.length + parseErrors.length}`);
  console.log();
  console.log('Processing berth plan...');
  console.log();

  // 2.5 Run Position Engine
  const processed = records.map(record => {
    try {
      const pos = positionEngine.computePosition(record);
      return { record: record, isValid: true, position: pos.position };
    } catch (e: any) {
      return { record: record, isValid: false, error: e.message };
    }
  });

  // 3. Generate Excel Plan (handles math & positions inside the service)
  const result = await excelGenerator.generateBerthPlan(processed, outputPath);

  console.log(`Successfully processed: ${result.successful}`);
  console.log(`Validation errors: ${result.invalid + parseErrors.length}`);
  console.log();

  if (result.invalid > 0 || parseErrors.length > 0) {
    console.log('Errors:');
    for (const err of parseErrors) {
      console.log(`- ${err.vesselName}: ${err.message}`);
    }
    for (const err of result.errors) {
      console.log(`- ${err.vesselName}: ${err.message}`);
    }
    console.log();
  }

  console.log('Generating Excel berth plan...');
  console.log();
  console.log('Output:');
  console.log(outputPath);
  console.log();
  
  await app.close();
}

bootstrap().catch(err => {
  console.error('Fatal error during execution:', err);
  process.exit(1);
});
