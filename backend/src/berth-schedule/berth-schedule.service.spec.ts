import { Test, TestingModule } from '@nestjs/testing';
import { BerthScheduleService } from './berth-schedule.service';
import { CsvReaderService } from '../csv-reader/csv-reader.service';
import { DataParserService } from '../data-parser/data-parser.service';
import { PositionEngineService } from '../position-engine/position-engine.service';
import { ConfigService } from '@nestjs/config';

describe('BerthScheduleService', () => {
  let service: BerthScheduleService;
  let csvReader: jest.Mocked<CsvReaderService>;
  let dataParser: jest.Mocked<DataParserService>;
  let positionEngine: jest.Mocked<PositionEngineService>;

  beforeEach(async () => {
    const mockCsvReader = { readRawCsv: jest.fn() };
    const mockDataParser = { parse: jest.fn() };
    const mockPositionEngine = { computePosition: jest.fn() };
    const mockConfigService = { get: jest.fn().mockImplementation((key) => key === 'BERTH_LENGTH' ? 600 : null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BerthScheduleService,
        { provide: CsvReaderService, useValue: mockCsvReader },
        { provide: DataParserService, useValue: mockDataParser },
        { provide: PositionEngineService, useValue: mockPositionEngine },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BerthScheduleService>(BerthScheduleService);
    csvReader = module.get(CsvReaderService);
    dataParser = module.get(DataParserService);
    positionEngine = module.get(PositionEngineService);
  });

  const makeVessel = (name: string) => ({
    vesselName: name, status: 'Inbound', loa: 100, foreMeter: 200, aftMeter: 100, eta: new Date(), ata: null, etd: new Date()
  });

  const makePositionedVessel = (name: string, startMeter: number, endMeter: number, loaMismatch = false) => ({
    ...makeVessel(name),
    position: {
      startMeter,
      endMeter,
      loa: 100,
      occupiedLength: endMeter - startMeter,
      loaMismatch,
      startTime: new Date(),
      endTime: new Date(),
    }
  });

  it('1. All valid vessels', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1'), makeVessel('V2')],
      errors: [],
    });
    positionEngine.computePosition
      .mockReturnValueOnce(makePositionedVessel('V1', 10, 110))
      .mockReturnValueOnce(makePositionedVessel('V2', 200, 300));

    const result = await service.getSchedule();
    expect(result.vessels).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('2. Mix of valid and invalid vessels (DataParser error)', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1')],
      errors: [{ vesselName: 'V2', message: 'Missing ETA' }],
    });
    positionEngine.computePosition.mockReturnValue(makePositionedVessel('V1', 10, 110));

    const result = await service.getSchedule();
    expect(result.vessels).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].vesselName).toBe('V2');
  });

  it('3. Missing ETA (handled by Position Engine)', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1')],
      errors: [],
    });
    positionEngine.computePosition.mockImplementation(() => {
      throw new Error('Inbound vessel missing ETA');
    });

    const result = await service.getSchedule();
    expect(result.vessels).toHaveLength(0);
    expect(result.errors[0].message).toContain('Inbound vessel missing ETA');
  });

  it('4. Missing ATA', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1')],
      errors: [],
    });
    positionEngine.computePosition.mockImplementation(() => {
      throw new Error('Working vessel missing ATA');
    });

    const result = await service.getSchedule();
    expect(result.errors[0].message).toContain('Working vessel missing ATA');
  });

  it('5. Missing ETD', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1')],
      errors: [],
    });
    positionEngine.computePosition.mockImplementation(() => {
      throw new Error('Missing ETD');
    });

    const result = await service.getSchedule();
    expect(result.errors[0].message).toContain('Missing ETD');
  });

  it('6. Vessel outside berth length', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1')],
      errors: [],
    });
    // BERTH_LENGTH is 600
    positionEngine.computePosition.mockReturnValue(makePositionedVessel('V1', 550, 650));

    const result = await service.getSchedule();
    expect(result.vessels).toHaveLength(0);
    expect(result.errors[0].message).toContain('exceeds berth length (600)');
  });

  it('7. Invalid meter positions (< 0)', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1')],
      errors: [],
    });
    positionEngine.computePosition.mockReturnValue(makePositionedVessel('V1', -50, 50));

    const result = await service.getSchedule();
    expect(result.vessels).toHaveLength(0);
    expect(result.errors[0].message).toContain('cannot be less than 0');
  });

  it('8. LOA mismatch should be reported but should not necessarily reject the vessel', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockReturnValue({
      records: [makeVessel('V1')],
      errors: [],
    });
    positionEngine.computePosition.mockReturnValue(makePositionedVessel('V1', 10, 110, true));

    const result = await service.getSchedule();
    expect(result.vessels).toHaveLength(1);
    expect(result.vessels[0].position.loaMismatch).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('9. Empty CSV (DataParser throws)', async () => {
    csvReader.readRawCsv.mockResolvedValue('dummy');
    dataParser.parse.mockImplementation(() => {
      throw new Error('CSV file is empty');
    });

    await expect(service.getSchedule()).rejects.toThrow('CSV file is empty');
  });

  it('10. CSV file error (CsvReader throws)', async () => {
    csvReader.readRawCsv.mockRejectedValue(new Error('File not found'));

    await expect(service.getSchedule()).rejects.toThrow('Failed to read CSV: File not found');
  });
});
