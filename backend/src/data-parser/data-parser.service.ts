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

        const parseDate = (val: string) => {
          if (!val || val.trim() === '') return null;
          
          let cleanVal = val.trim();
          
          // Case 1: 30-08-2026 1900 (DD-MM-YYYY HHmm)
          const regexDDMMYYYY = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):?(\d{2})$/;
          const match1 = cleanVal.match(regexDDMMYYYY);
          if (match1) {
            return new Date(`${match1[3]}-${match1[2]}-${match1[1]}T${match1[4]}:${match1[5]}:00Z`);
          }

          // Case 2: 26-Sep-04 1900 (YY-MMM-DD HHmm)
          const regexYYMMMDD = /^(\d{2})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):?(\d{2})$/;
          const match2 = cleanVal.match(regexYYMMMDD);
          if (match2) {
            const months: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
            const m = months[match2[2].substring(0,3)] || '01';
            return new Date(`20${match2[1]}-${m}-${match2[3]}T${match2[4]}:${match2[5]}:00Z`);
          }

          // Case 3: 2026-09-04 1900 (YYYY-MM-DD HHmm)
          const regexYYYYMMDDHHmm = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):?(\d{2})$/;
          const match3 = cleanVal.match(regexYYYYMMDDHHmm);
          if (match3) {
            return new Date(`${match3[1]}-${match3[2]}-${match3[3]}T${match3[4]}:${match3[5]}:00Z`);
          }

          // Fallback
          const date = new Date(cleanVal);
          return isNaN(date.getTime()) ? null : date;
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

        records.push({
          vesselName: row['Vessel Name'],
          status: row['Phase'],
          loa: parseFloat(row['Vessel Loa M']) || 0,
          foreMeter: calculatedFore,
          aftMeter: calculatedAft,
          eta: parseDate(row['ETA']),
          ata: parseDate(row['ATA']),
          etd: parseDate(row['ETD']),
        });
      } catch (err: any) {
        errors.push({
          vesselName: vesselName,
          message: err.message,
        });
      }
    }

    return { records, errors };
  }
}
