import { Module } from '@nestjs/common';
import { CsvReaderService } from './csv-reader.service';

@Module({
  providers: [CsvReaderService],
  exports: [CsvReaderService],
})
export class CsvReaderModule {}
