import { Module } from '@nestjs/common';
import { DataParserService } from './data-parser.service';

@Module({
  providers: [DataParserService],
  exports: [DataParserService],
})
export class DataParserModule {}
