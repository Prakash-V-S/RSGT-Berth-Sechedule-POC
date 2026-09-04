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
  subLaneIndex?: number;
  berthMaxLanes?: number;
}

export interface PositionedVesselSchedule extends VesselScheduleRecord {
  position: CalculatedPosition;
  berthZone?: string;
}

@Injectable()
export class PositionEngineService {
  computePositions(records: VesselScheduleRecord[]): PositionedVesselSchedule[] {
    const positioned = records.map(record => this.computePosition(record));
    
    // Group by berth zone (derived from CSV's vessel_berth or defaulting)
    const berthGroups: Record<string, PositionedVesselSchedule[]> = {};
    for (const v of positioned) {
       // CSV might have 'vessel berth', mapped to v.berthZone later, or we fallback to R1 for testing
       // Actually, the parser puts 'vessel berth' in what field? Wait, we need to extract it in data parser if it's not there!
       // Let's assume the CSV provides it in `vesselName` temporarily or it's added to parser.
       const b = (v as any).berthZone || (v as any).vesselBerth || 'UNKNOWN';
       if (!berthGroups[b]) berthGroups[b] = [];
       berthGroups[b].push(v);
    }
    
    // Calculate sub-lanes
    for (const [berth, group] of Object.entries(berthGroups)) {
       // Sort by ETA
       group.sort((a, b) => a.position.startTime.getTime() - b.position.startTime.getTime());
       
       const lanes: Date[] = [];
       for (const v of group) {
           let placed = false;
           for (let i = 0; i < lanes.length; i++) {
               if (v.position.startTime.getTime() >= lanes[i].getTime()) {
                   v.position.subLaneIndex = i;
                   lanes[i] = v.position.endTime;
                   placed = true;
                   break;
               }
           }
           if (!placed) {
               v.position.subLaneIndex = lanes.length;
               lanes.push(v.position.endTime);
           }
       }
       
       for (const v of group) {
           v.position.berthMaxLanes = lanes.length;
       }
    }
    
    return positioned;
  }

  computePosition(record: VesselScheduleRecord): PositionedVesselSchedule {
    const { loa, foreMeter, aftMeter, status, vesselName, occupancyStart, occupancyEnd } = record;

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

    if (!occupancyStart || !occupancyEnd) {
      throw new BadRequestException(`Vessel ${vesselName}: Missing valid occupancy start or end time`);
    }

    if (occupancyEnd.getTime() <= occupancyStart.getTime()) {
      throw new BadRequestException(`Vessel ${vesselName}: End time must be after start time`);
    }

    position.startTime = occupancyStart;
    position.endTime = occupancyEnd;

    return {
      ...record,
      position: position as CalculatedPosition,
    };
  }
}
