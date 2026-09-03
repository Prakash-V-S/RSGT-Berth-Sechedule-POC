import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsvReaderService } from '../csv-reader/csv-reader.service';
import { DataParserService } from '../data-parser/data-parser.service';
import { PositionEngineService, PositionedVesselSchedule } from '../position-engine/position-engine.service';

export interface ScheduleResponse {
  berth: {
    length: number;
  };
  vessels: PositionedVesselSchedule[];
  errors: {
    vesselName: string;
    message: string;
  }[];
}

@Injectable()
export class BerthScheduleService {
  private readonly logger = new Logger(BerthScheduleService.name);

  constructor(
    private readonly csvReaderService: CsvReaderService,
    private readonly dataParserService: DataParserService,
    private readonly positionEngineService: PositionEngineService,
    private readonly configService: ConfigService,
  ) {}

  async getSchedule(): Promise<ScheduleResponse> {
    const berthLength = this.configService.get<number>('BERTH_LENGTH') || 600;
    const errors: { vesselName: string; message: string }[] = [];
    const vessels: PositionedVesselSchedule[] = [];

    let rawCsv: string;
    try {
      rawCsv = await this.csvReaderService.readRawCsv();
    } catch (err: any) {
      throw new Error(`Failed to read CSV: ${err.message}`);
    }

    let parsedResult;
    try {
      parsedResult = this.dataParserService.parse(rawCsv);
    } catch (err: any) {
      // If parsing fails entirely (e.g. empty file, invalid structure)
      throw new Error(`Failed to parse CSV: ${err.message}`);
    }

    // Add any row-level parsing errors
    if (parsedResult.errors && parsedResult.errors.length > 0) {
      for (const err of parsedResult.errors) {
        errors.push({
          vesselName: err.vesselName || 'Unknown Vessel',
          message: err.message,
        });
      }
    }

    // Process valid parsed records through Position Engine
    for (const record of parsedResult.records) {
      try {
        const positionedVessel = this.positionEngineService.computePosition(record);

        // Validate against berth length
        const { startMeter, endMeter } = positionedVessel.position;
        if (startMeter < 0) {
          throw new Error(`startMeter (${startMeter}) cannot be less than 0`);
        }
        if (endMeter > berthLength) {
          throw new Error(`endMeter (${endMeter}) exceeds berth length (${berthLength})`);
        }

        vessels.push(positionedVessel);
      } catch (err: any) {
        errors.push({
          vesselName: record.vesselName || 'Unknown Vessel',
          message: err.message || 'Validation failed in Position Engine',
        });
      }
    }

    return {
      berth: {
        length: berthLength,
      },
      vessels,
      errors,
    };
  }
}
