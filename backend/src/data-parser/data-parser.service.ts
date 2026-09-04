import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { VesselScheduleRecord } from './interfaces/vessel-schedule.interface';

@Injectable()
export class DataParserService {
  private readonly logger = new Logger(DataParserService.name);

  parse(rawCsv: string): { records: VesselScheduleRecord[]; errors: { vesselName?: string; message: string }[] } {
    if (!rawCsv || rawCsv.trim().length === 0) {
      throw new BadRequestException('CSV file is empty');
    }

    let rows: any[];
    try {
      rows = parse(rawCsv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        from_line: 2, // Skip the first metadata row in the sample
      });
    } catch (error) {
      this.logger.error('Failed to parse CSV structure', error);
      throw new BadRequestException('Invalid CSV structure');
    }

    if (rows.length === 0) {
      throw new BadRequestException('CSV contains no data rows');
    }

    const records: VesselScheduleRecord[] = [];
    const errors: { vesselName?: string; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const vesselName = row['Vessel Name'] || `Row ${i + 2}`;
      
      try {
        if (!row['Vessel Name']) {
          throw new BadRequestException(`Missing required value 'Vessel Name' at row ${i + 2}`);
        }
        if (!row['Phase']) {
          throw new BadRequestException(`Missing required value 'Phase' (Status)`);
        }

        const parseRsgtDate = (val: string, vName: string): Date | null => {
          if (!val || val.trim() === '') return null;
          
          let cleanVal = val.trim();
          
          const validateParts = (y: number, m: number, d: number, h: number, min: number) => {
             if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(h) || isNaN(min)) return false;
             if (m < 1 || m > 12) return false;
             if (d < 1 || d > 31) return false;
             if (h < 0 || h > 23) return false;
             if (min < 0 || min > 59) return false;
             return true;
          };

          // Case 1: 30-08-2026 1900 (DD-MM-YYYY HHmm)
          const regexDDMMYYYY = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):?(\d{2})$/;
          const match1 = cleanVal.match(regexDDMMYYYY);
          if (match1) {
            const d = parseInt(match1[1], 10);
            const m = parseInt(match1[2], 10);
            const y = parseInt(match1[3], 10);
            const h = parseInt(match1[4], 10);
            const min = parseInt(match1[5], 10);
            if (validateParts(y, m, d, h, min)) {
              return new Date(Date.UTC(y, m - 1, d, h, min, 0));
            }
          }

          // Case 2: 26-Sep-04 1900 (YY-MMM-DD HHmm)
          const regexYYMMMDD = /^(\d{2})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):?(\d{2})$/;
          const match2 = cleanVal.match(regexYYMMMDD);
          if (match2) {
            const months: Record<string, number> = { 
               Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12,
               jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12
            };
            const y = 2000 + parseInt(match2[1], 10);
            const m = months[match2[2].substring(0,3)];
            const d = parseInt(match2[3], 10);
            const h = parseInt(match2[4], 10);
            const min = parseInt(match2[5], 10);
            if (m && validateParts(y, m, d, h, min)) {
              return new Date(Date.UTC(y, m - 1, d, h, min, 0));
            }
          }

          // Case 3: 2026-09-04 1900 (YYYY-MM-DD HHmm)
          const regexYYYYMMDDHHmm = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):?(\d{2})$/;
          const match3 = cleanVal.match(regexYYYYMMDDHHmm);
          if (match3) {
            const y = parseInt(match3[1], 10);
            const m = parseInt(match3[2], 10);
            const d = parseInt(match3[3], 10);
            const h = parseInt(match3[4], 10);
            const min = parseInt(match3[5], 10);
            if (validateParts(y, m, d, h, min)) {
              return new Date(Date.UTC(y, m - 1, d, h, min, 0));
            }
          }

          this.logger.warn(`Failed to parse date for ${vName}: '${cleanVal}'`);
          return null;
        };

        // Bollard Meter Calculation
        let bollards: Record<string, number> = {};
        try {
          const jsonPath = path.join(process.cwd(), 'data', 'bollards.json');
          if (fs.existsSync(jsonPath)) {
            bollards = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          }
        } catch (e) {
          this.logger.warn('Failed to load bollards.json');
        }

        let calculatedFore = parseFloat(row['Bollard Fore Meter']) || 0;
        let calculatedAft = parseFloat(row['Bollard Aft Meter']) || 0;

        const bollardForeId = (row['Bollard Fore'] || '').toString().trim();
        const bollardAftId = (row['Bollard Aft'] || '').toString().trim();

        if (bollardForeId && bollards[bollardForeId] !== undefined) {
          const offset = parseFloat(row['Bollard Fore offset']) || 0;
          calculatedFore = bollards[bollardForeId] + offset;
        }

        if (bollardAftId && bollards[bollardAftId] !== undefined) {
          const offset = parseFloat(row['Bollard Aft offset']) || 0;
          calculatedAft = bollards[bollardAftId] + offset;
        }

        const eta = parseRsgtDate(row['ETA'], vesselName);
        const ata = parseRsgtDate(row['ATA'], vesselName);
        const etd = parseRsgtDate(row['ETD'], vesselName);
        const estTimeOfBerth = parseRsgtDate(row['Est. Time of Berth'], vesselName);
        const atb = parseRsgtDate(row['ATB'], vesselName);
        const atd = parseRsgtDate(row['ATD'], vesselName);

        const record: VesselScheduleRecord = {
          vesselName: row['Vessel Name'],
          status: row['Phase'],
          loa: parseFloat(row['Vessel Loa M']) || 0,
          foreMeter: calculatedFore,
          aftMeter: calculatedAft,
          eta,
          ata,
          etd,
          estTimeOfBerth,
          atb,
          atd,
          berthZone: row['vessel berth']?.trim() || 'UNKNOWN',
          service: row['Service']?.trim(),
          beam: parseFloat(row['BEAM M']) || undefined,
          moves: parseInt(row['Total Moves'], 10) || undefined,
          discharge: parseInt(row['Est Disch'], 10) || undefined,
          load: parseInt(row['EST Loading'], 10) || undefined,
          draftForward: parseFloat(row['Draft Forward']) || undefined,
          draftAft: parseFloat(row['Draft Aft']) || undefined,
        };

        const range = this.getVesselOccupancyRange(record);
        record.occupancyStart = range.startTime;
        record.occupancyEnd = range.endTime;

        records.push(record);
      } catch (err: any) {
        errors.push({
          vesselName: vesselName,
          message: err.message,
        });
      }
    }

    return { records, errors };
  }

  getVesselOccupancyRange(vessel: VesselScheduleRecord): { startTime: Date | null, endTime: Date | null } {
    let start: Date | null = null;
    let end: Date | null = null;
    
    if (vessel.status === 'Working') {
      start = vessel.atb ?? vessel.estTimeOfBerth ?? vessel.ata ?? vessel.eta;
      end = vessel.atd ?? vessel.etd;
    } else {
      start = vessel.estTimeOfBerth ?? vessel.eta;
      end = vessel.etd;
    }
    
    return { startTime: start, endTime: end };
  }
}
