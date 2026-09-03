import { Module } from '@nestjs/common';
import { ExcelGeneratorService } from './excel-generator.service';
import { PositionEngineModule } from '../position-engine/position-engine.module';

@Module({
  imports: [PositionEngineModule],
  providers: [ExcelGeneratorService],
  exports: [ExcelGeneratorService],
})
export class ExcelGeneratorModule {}
