import { Test, TestingModule } from '@nestjs/testing';
import { PositionEngineService } from './position-engine.service';
import { VesselScheduleRecord } from '../data-parser/interfaces/vessel-schedule.interface';
import { BadRequestException } from '@nestjs/common';

describe('PositionEngineService', () => {
  let service: PositionEngineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PositionEngineService],
    }).compile();

    service = module.get<PositionEngineService>(PositionEngineService);
  });

  const getBaseRecord = (): VesselScheduleRecord => ({
    vesselName: 'TEST VESSEL',
    status: 'Inbound',
    loa: 200,
    foreMeter: 300,
    aftMeter: 100,
    eta: new Date('2026-09-02T19:00:00Z'),
    ata: null,
    etd: new Date('2026-09-04T19:00:00Z'),
  });

  it('1. Valid Inbound vessel', () => {
    const record = getBaseRecord();
    const result = service.computePosition(record);
    expect(result.position.startTime.toISOString()).toBe('2026-09-02T19:00:00.000Z');
    expect(result.position.endTime.toISOString()).toBe('2026-09-04T19:00:00.000Z');
  });

  it('2. Valid Working vessel', () => {
    const record = getBaseRecord();
    record.status = 'Working';
    record.ata = new Date('2026-09-02T20:00:00Z');
    const result = service.computePosition(record);
    expect(result.position.startTime.toISOString()).toBe('2026-09-02T20:00:00.000Z');
  });

  it('3. Fore/Aft meter calculation', () => {
    const record = getBaseRecord();
    const result = service.computePosition(record);
    expect(result.position.startMeter).toBe(100);
    expect(result.position.endMeter).toBe(300);
    expect(result.position.occupiedLength).toBe(200);
  });

  it('4. LOA matching meter range', () => {
    const record = getBaseRecord();
    const result = service.computePosition(record);
    expect(result.position.loaMismatch).toBeUndefined();
  });

  it('5. LOA mismatch', () => {
    const record = getBaseRecord();
    record.loa = 250;
    const result = service.computePosition(record);
    expect(result.position.loaMismatch).toBe(true);
  });

  it('6. Invalid fore meter', () => {
    const record = getBaseRecord();
    (record as any).foreMeter = 'invalid';
    expect(() => service.computePosition(record)).toThrow(BadRequestException);
  });

  it('7. Invalid aft meter', () => {
    const record = getBaseRecord();
    (record as any).aftMeter = null;
    expect(() => service.computePosition(record)).toThrow(BadRequestException);
  });

  it('8. Invalid LOA', () => {
    const record = getBaseRecord();
    record.loa = -10;
    expect(() => service.computePosition(record)).toThrow(BadRequestException);
  });

  it('9. Inbound vessel with missing ETA', () => {
    const record = getBaseRecord();
    record.eta = null;
    expect(() => service.computePosition(record)).toThrow(BadRequestException);
  });

  it('10. Working vessel with missing ATA', () => {
    const record = getBaseRecord();
    record.status = 'Working';
    record.ata = null;
    expect(() => service.computePosition(record)).toThrow(BadRequestException);
  });

  it('11. Missing ETD', () => {
    const record = getBaseRecord();
    record.etd = null;
    expect(() => service.computePosition(record)).toThrow(BadRequestException);
  });

  it('12. ETD before start time', () => {
    const record = getBaseRecord();
    record.etd = new Date('2026-09-01T19:00:00Z'); // Before ETA
    expect(() => service.computePosition(record)).toThrow(BadRequestException);
  });

  it('13. Case-insensitive status', () => {
    const record = getBaseRecord();
    record.status = 'INBoUnD';
    const result = service.computePosition(record);
    expect(result.position.startTime.toISOString()).toBe('2026-09-02T19:00:00.000Z');
  });
});
