import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { resolve } from 'path';

/**
 * CsvReaderService
 *
 * Single responsibility: locate and read the raw CSV file contents
 * from the configured location (CSV_FILE_PATH). It does not know
 * anything about the CSV's columns or how to turn rows into domain
 * objects — that is the DataParser's job.
 *
 * No business/parsing logic is implemented yet. This is a POC stub.
 */
@Injectable()
export class CsvReaderService {
  private readonly logger = new Logger(CsvReaderService.name);

  constructor(private readonly configService: ConfigService) {}

  private getConfiguredFilePath(): string {
    const filePath = this.configService.get<string>('csv.filePath');
    if (!filePath) {
      throw new Error('CSV_FILE_PATH is not configured');
    }
    return resolve(process.cwd(), filePath);
  }

  /**
   * Reads the raw CSV file as a UTF-8 string.
   * Parsing into rows/objects happens in DataParserService.
   */
  async readRawCsv(): Promise<string> {
    const filePath = this.getConfiguredFilePath();

    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      this.logger.error(`Failed to read CSV file at ${filePath}`, error as Error);
      throw new NotFoundException(`CSV file not found at configured path: ${filePath}`);
    }
  }
}
