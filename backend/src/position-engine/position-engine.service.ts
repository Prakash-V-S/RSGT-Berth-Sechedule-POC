import { Injectable, BadRequestException } from '@nestjs/common';
import { VesselScheduleRecord } from '../data-parser/interfaces/vessel-schedule.interface';

export interface CalculatedPosition {
  startMeter: number;
  endMeter: number;
  loa: number;
  occupiedLength: number;
  loaMismatch?: boolean;
  startTime: Date;
  endTime: Date;
}

export interface PositionedVesselSchedule extends VesselScheduleRecord {
  position: CalculatedPosition;
}

@Injectable()
export class PositionEngineService {
  computePositions(records: VesselScheduleRecord[]): PositionedVesselSchedule[] {
    return records.map(record => this.computePosition(record));
  }

  computePosition(record: VesselScheduleRecord): PositionedVesselSchedule {
    const { loa, foreMeter, aftMeter, status, eta, ata, etd, vesselName } = record;

    // Meter Validation
    if (typeof aftMeter !== 'number' || isNaN(aftMeter)) {
      throw new BadRequestException(`Vessel ${vesselName}: aftMeter is not a valid number`);
    }
    if (typeof foreMeter !== 'number' || isNaN(foreMeter)) {
      throw new BadRequestException(`Vessel ${vesselName}: foreMeter is not a valid number`);
    }
    if (typeof loa !== 'number' || isNaN(loa) || loa <= 0) {
      throw new BadRequestException(`Vessel ${vesselName}: LOA is not a valid positive number`);
    }
    const startMeter = Math.min(foreMeter, aftMeter);
    const endMeter = Math.max(foreMeter, aftMeter);
    const occupiedLength = endMeter - startMeter;
    const loaMismatch = occupiedLength !== loa;

    const position: Partial<CalculatedPosition> = {
      startMeter: startMeter,
      endMeter: endMeter,
      loa: loa,
      occupiedLength: occupiedLength,
    };

    if (loaMismatch) {
      position.loaMismatch = true;
    }

    // Time Validation & Calculation
    const normalizedStatus = (status || '').toLowerCase();
    let startTime: Date | null = null;

    if (normalizedStatus === 'inbound') {
      if (!eta) {
        throw new BadRequestException(`Vessel ${vesselName}: Inbound vessel missing ETA`);
      }
      startTime = eta;
    } else if (normalizedStatus === 'working') {
      if (!ata) {
        throw new BadRequestException(`Vessel ${vesselName}: Working vessel missing ATA`);
      }
      startTime = ata;
    } else {
      throw new BadRequestException(`Vessel ${vesselName}: Unknown or unsupported status '${status}'`);
    }

    if (!etd) {
      throw new BadRequestException(`Vessel ${vesselName}: Missing ETD`);
    }

    if (etd.getTime() <= startTime.getTime()) {
      throw new BadRequestException(`Vessel ${vesselName}: ETD must be after start time`);
    }

    position.startTime = startTime;
    position.endTime = etd;

    return {
      ...record,
      position: position as CalculatedPosition,
    };
  }
}
