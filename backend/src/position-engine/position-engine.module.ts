import { Module } from '@nestjs/common';
import { PositionEngineService } from './position-engine.service';

@Module({
  providers: [PositionEngineService],
  exports: [PositionEngineService],
})
export class PositionEngineModule {}
