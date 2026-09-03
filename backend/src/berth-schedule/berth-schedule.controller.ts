import { Controller, Get } from '@nestjs/common';
import { BerthScheduleService, ScheduleResponse } from './berth-schedule.service';

@Controller('berth-schedule')
export class BerthScheduleController {
  constructor(private readonly berthScheduleService: BerthScheduleService) {}

  @Get()
  async getBerthSchedule(): Promise<ScheduleResponse> {
    return this.berthScheduleService.getSchedule();
  }
}
