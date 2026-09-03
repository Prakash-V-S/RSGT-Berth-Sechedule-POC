import { Test, TestingModule } from '@nestjs/testing';
import { BerthScheduleController } from './berth-schedule.controller';
import { BerthScheduleService } from './berth-schedule.service';

describe('BerthScheduleController', () => {
  let controller: BerthScheduleController;
  let service: jest.Mocked<BerthScheduleService>;

  beforeEach(async () => {
    const mockService = { getSchedule: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BerthScheduleController],
      providers: [{ provide: BerthScheduleService, useValue: mockService }],
    }).compile();

    controller = module.get<BerthScheduleController>(BerthScheduleController);
    service = module.get(BerthScheduleService);
  });

  it('should call getSchedule on the service and return the result', async () => {
    const mockResponse = { berth: { length: 600 }, vessels: [], errors: [] };
    service.getSchedule.mockResolvedValue(mockResponse);

    const result = await controller.getBerthSchedule();
    expect(service.getSchedule).toHaveBeenCalled();
    expect(result).toEqual(mockResponse);
  });
});
