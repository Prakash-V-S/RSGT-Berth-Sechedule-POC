import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BerthScheduleController } from './berth-schedule.controller';
import { BerthScheduleService } from './berth-schedule.service';
import { CsvReaderModule } from '../csv-reader/csv-reader.module';
import { DataParserModule } from '../data-parser/data-parser.module';
import { PositionEngineModule } from '../position-engine/position-engine.module';

@Module({
  imports: [ConfigModule, CsvReaderModule, DataParserModule, PositionEngineModule],
  controllers: [BerthScheduleController],
  providers: [BerthScheduleService],
})
export class BerthScheduleModule {}
