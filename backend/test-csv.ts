import { ConfigService } from '@nestjs/config';
import { CsvReaderService } from './src/csv-reader/csv-reader.service';
import { DataParserService } from './src/data-parser/data-parser.service';

async function test() {
  const configService = new ConfigService();
  // Override for test script
  configService.get = (key: string) => {
    if (key === 'csv.filePath') return './data/vessels.csv';
    return null;
  };

  const csvReader = new CsvReaderService(configService);
  const dataParser = new DataParserService();

  try {
    const rawCsv = await csvReader.readRawCsv();
    const records = dataParser.parse(rawCsv);
    console.log('Successfully parsed records:', records.length);
    console.log('Example record (first):', records[0]);
  } catch (error) {
    console.error('Error:', (error as Error).message);
  }
}

test();
