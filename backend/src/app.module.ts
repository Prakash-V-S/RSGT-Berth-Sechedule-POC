import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { CsvReaderModule } from './csv-reader/csv-reader.module';
import { DataParserModule } from './data-parser/data-parser.module';
import { PositionEngineModule } from './position-engine/position-engine.module';
import { BerthScheduleModule } from './berth-schedule/berth-schedule.module';
import { ExcelGeneratorModule } from './excel-generator/excel-generator.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    CsvReaderModule,
    DataParserModule,
    PositionEngineModule,
    BerthScheduleModule,
    ExcelGeneratorModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
