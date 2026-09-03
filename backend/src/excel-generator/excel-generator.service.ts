import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { VesselScheduleRecord } from '../data-parser/interfaces/vessel-schedule.interface';
import { PositionEngineService } from '../position-engine/position-engine.service';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';

interface ProcessedRecord {
  record: VesselScheduleRecord;
  positioned: any; // from PositionEngine
  isValid: boolean;
  error?: string;
}

@Injectable()
export class ExcelGeneratorService {
  private readonly logger = new Logger(ExcelGeneratorService.name);
  
  // Grid configuration
  private readonly METERS_PER_COL = 25;
  private readonly LEFT_COLS = 13;
  private readonly GRID_COL_OFFSET = 14; // Grid starts at column 14 (1-based)
  private readonly TOTAL_GRID_COLS = 55; // 1350m / 25m
  private readonly HEADER_ROWS = 7;
  private readonly GRID_START_ROW = 8; // Grid starts at row 8

  private readonly TIME_SLOTS = [
    '0001-0200', '0201-0400', '0401-0600', '0601-0800',
    '0801-1000', '1001-1200', '1201-1400', '1401-1600',
    '1601-1800', '1801-2000', '2001-2200', '2201-2359',
  ];

  private readonly BERTH_ZONES = [
    { name: 'R1', startM: 0,   endM: 275  },
    { name: 'R2', startM: 275, endM: 550  },
    { name: 'R3', startM: 550, endM: 825  },
    { name: 'R4', startM: 825, endM: 1350 }, // R4 reversed scale (865 m quay)
  ];

  constructor(
    private readonly positionEngine: PositionEngineService,
    private readonly configService: ConfigService,
  ) {}

  private meterToGridCol(meter: number): number {
    return Math.floor(meter / this.METERS_PER_COL);
  }

  private addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  private dateOnly(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private isoWeek(d: Date): number {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  async generateBerthPlan(records: VesselScheduleRecord[], outputPath: string) {
    const workbook = new ExcelJS.Workbook();
    
    workbook.creator = 'RSGT Berth Schedule POC';
    workbook.created = new Date();

    const mainSheet = workbook.addWorksheet('MAIN BERTH PLAN', {
      properties: { defaultRowHeight: 20 },
      views: [{ state: 'frozen', ySplit: this.GRID_START_ROW - 1, xSplit: this.LEFT_COLS }]
    });

    const summarySheet = workbook.addWorksheet('DATA SUMMARY');

    // Process records through Position Engine
    const processed: ProcessedRecord[] = [];
    let minTime = Infinity;
    let maxTime = -Infinity;

    for (const record of records) {
      try {
        const positioned = this.positionEngine.computePosition(record);
        processed.push({ record, positioned, isValid: true });

        const sTime = positioned.position.startTime.getTime();
        const eTime = positioned.position.endTime.getTime();
        if (sTime < minTime) minTime = sTime;
        if (eTime > maxTime) maxTime = eTime;

      } catch (err: any) {
        processed.push({ record, positioned: null, isValid: false, error: err.message });
      }
    }

    // Determine Schedule Date Range
    const envStart = this.configService.get<string>('PLAN_START_DATE');
    const envEnd = this.configService.get<string>('PLAN_END_DATE');

    let scheduleStart = envStart ? new Date(envStart).getTime() : minTime;
    let scheduleEnd = envEnd ? new Date(envEnd).getTime() : maxTime;

    if (scheduleStart === Infinity) {
      // Fallback if no valid vessels and no env vars
      scheduleStart = Date.now();
      scheduleEnd = Date.now() + 7 * 24 * 60 * 60 * 1000; // +7 days
    }

    const startDate = this.dateOnly(new Date(scheduleStart));
    const endDate = this.dateOnly(new Date(scheduleEnd));

    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const totalSlots = totalDays * 12; // 12 two-hour slots per day

    // --- SETUP MAIN SHEET ---
    
    // Set column widths for left section
    for (let i = 1; i <= 7; i++) mainSheet.getColumn(i).width = 4; // R1-B7
    mainSheet.getColumn(8).width = 18; // COMMERCIAL QC
    mainSheet.getColumn(9).width = 14; // HOURLY QC
    mainSheet.getColumn(10).width = 12; // Time Slot
    mainSheet.getColumn(11).width = 15; // Date
    mainSheet.getColumn(12).width = 6;  // 12:00
    mainSheet.getColumn(13).width = 2;  // Separator

    // Set grid column widths
    for (let i = 0; i < this.TOTAL_GRID_COLS; i++) {
      mainSheet.getColumn(this.GRID_COL_OFFSET + i).width = 2.5;
    }

    // Logo & Headers (Rows 1-2)
    mainSheet.mergeCells(1, this.GRID_COL_OFFSET, 2, this.GRID_COL_OFFSET + this.TOTAL_GRID_COLS - 1);
    const titleCell = mainSheet.getCell(1, this.GRID_COL_OFFSET);
    titleCell.value = 'RSGT LOGO / HEADER\nRED SEA GATEWAY TERMINAL';
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    
    // Row 4: Berth Zone headers
    const leftHeaders = ['R1', 'R2', 'R3', 'R4', 'B6', 'B4', 'B7', 'COMMERCIAL QC', "HOURLY QC'S", `WEEK ${this.isoWeek(startDate)}`];
    leftHeaders.forEach((text, i) => {
      const col = i + 1;
      const mergeTo = col === 10 ? 12 : col;
      mainSheet.mergeCells(4, col, 6, mergeTo);
      const cell = mainSheet.getCell(4, col);
      cell.value = text;
      cell.alignment = { horizontal: 'center', vertical: 'middle', textRotation: col <= 7 ? 90 : 0, wrapText: true };
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    const zoneMap = [
      { name: 'R1', start: 0, len: 11, label: 'Berth #1' },
      { name: 'R2', start: 11, len: 11, label: 'Berth #2' },
      { name: 'R3', start: 22, len: 13, label: 'Berth #3' },
      { name: 'R4', start: 35, len: 20, label: 'Berth #4' }
    ];

    zoneMap.forEach(z => {
      mainSheet.mergeCells(4, this.GRID_COL_OFFSET + z.start, 4, this.GRID_COL_OFFSET + z.start + z.len - 1);
      const c1 = mainSheet.getCell(4, this.GRID_COL_OFFSET + z.start);
      c1.value = z.name;
      c1.alignment = { horizontal: 'center' };
      c1.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

      mainSheet.mergeCells(5, this.GRID_COL_OFFSET + z.start, 6, this.GRID_COL_OFFSET + z.start + z.len - 1);
      const c2 = mainSheet.getCell(5, this.GRID_COL_OFFSET + z.start);
      c2.value = z.label;
      c2.alignment = { horizontal: 'center', vertical: 'middle' };
      c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } }; // Light green
      c2.border = { top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    // Row 7: Meter Ruler
    for (let i = 0; i < this.TOTAL_GRID_COLS; i++) {
      const cell = mainSheet.getCell(7, this.GRID_COL_OFFSET + i);
      cell.value = (i + 1) * this.METERS_PER_COL;
      cell.font = { size: 8 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
      cell.border = { bottom: { style: 'medium' }, left: { style: 'dotted' }, right: { style: 'dotted' } };
    }
    
    for (let i = 1; i < this.GRID_COL_OFFSET; i++) {
      mainSheet.getCell(7, i).border = { bottom: { style: 'medium' } };
    }

    // Build Vessel Blocks
    const vesselBlocks: any[] = [];
    const slotBerthService: Record<number, Record<string, Set<string>>> = {};

    for (const p of processed) {
      if (!p.isValid || !p.positioned) continue;
      const pos = p.positioned.position;
      
      const startMs = pos.startTime.getTime();
      const endMs = pos.endTime.getTime();
      
      if (endMs < startDate.getTime() || startMs > this.addDays(endDate, 1).getTime()) continue;

      const absStart = Math.max(0, Math.floor((startMs - startDate.getTime()) / (1000 * 60 * 60 * 2)));
      const absEnd = Math.min(totalSlots - 1, Math.ceil((endMs - startDate.getTime()) / (1000 * 60 * 60 * 2)) - 1);

      if (absStart > absEnd) continue;

      let berthZone = 'R1';
      for (const z of this.BERTH_ZONES) {
        if (pos.startMeter >= z.startM && pos.startMeter < z.endM) { berthZone = z.name; break; }
      }

      vesselBlocks.push({
        record: p.record,
        pos, absStart, absEnd, berthZone,
        startM: pos.startMeter, endM: pos.endMeter
      });

      for (let s = absStart; s <= absEnd; s++) {
        if (!slotBerthService[s]) slotBerthService[s] = {};
        if (!slotBerthService[s][berthZone]) slotBerthService[s][berthZone] = new Set();
        slotBerthService[s][berthZone].add((p.record as any).service || p.record.vesselName);
      }
    }

    // --- DRAW GRID & TIME AXIS ---
    let currentRow = this.GRID_START_ROW;
    let currentDayStr = '';

    for (let slot = 0; slot < totalSlots; slot++) {
      const dayIndex  = Math.floor(slot / 12);
      const slotInDay = slot % 12;
      const slotDay   = this.addDays(startDate, dayIndex);
      const timeLabel = this.TIME_SLOTS[slotInDay];
      const dayStr = slotDay.toLocaleDateString('en-GB', { weekday: 'long' });

      // Col 10: Time slot
      mainSheet.getCell(currentRow, 10).value = timeLabel;
      mainSheet.getCell(currentRow, 10).alignment = { horizontal: 'center', vertical: 'middle' };
      mainSheet.getCell(currentRow, 10).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

      // Col 11: Date (Day name merged)
      if (slotInDay === 0) {
        mainSheet.mergeCells(currentRow, 11, currentRow + 11, 11);
        const dateCell = mainSheet.getCell(currentRow, 11);
        
        const dd = slotDay.getDate().toString().padStart(2, '0');
        const mon = slotDay.toLocaleString('en-GB', { month: '2-digit' });
        const yyyy = slotDay.getFullYear();
        
        dateCell.value = `${dayStr}\n\n\n\n\n${dd}-${mon}-${yyyy}`;
        dateCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        dateCell.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };
      }

      // Col 12: Noon marker
      if (slotInDay === 6) {
        mainSheet.getCell(currentRow, 12).value = '12:00';
        mainSheet.getCell(currentRow, 12).font = { size: 8 };
        mainSheet.getCell(currentRow, 12).alignment = { horizontal: 'center' };
      }

      // Col 8: Commercial QC, Col 9: Hourly QC
      let activeVessels = 0;
      vesselBlocks.forEach(vb => {
        if (slot >= vb.absStart && slot <= vb.absEnd) activeVessels++;
      });
      
      mainSheet.getCell(currentRow, 8).value = activeVessels > 0 ? activeVessels * 2 + 10 : '';
      mainSheet.getCell(currentRow, 8).alignment = { horizontal: 'center' };
      mainSheet.getCell(currentRow, 8).border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
      
      mainSheet.getCell(currentRow, 9).value = '16';
      mainSheet.getCell(currentRow, 9).alignment = { horizontal: 'center' };
      mainSheet.getCell(currentRow, 9).border = { top: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'medium' } };

      // Apply borders to grid cells
      for (let i = 0; i < this.TOTAL_GRID_COLS; i++) {
        const c = mainSheet.getCell(currentRow, this.GRID_COL_OFFSET + i);
        c.border = { top: { style: 'dotted' }, bottom: { style: 'dotted' }, left: { style: 'dotted' }, right: { style: 'dotted' } };
        // Thicker border for end of day
        if (slotInDay === 11) {
          c.border.bottom = { style: 'medium' };
        }
      }

      currentRow++;
    }

    // --- PLOT VESSELS ---
    for (const vb of vesselBlocks) {
      const rowStart = this.GRID_START_ROW + vb.absStart;
      const rowEnd = this.GRID_START_ROW + vb.absEnd;

      const gridColStart = this.GRID_COL_OFFSET + this.meterToGridCol(vb.startM);
      const gridColEnd   = this.GRID_COL_OFFSET + Math.ceil(vb.endM / this.METERS_PER_COL) - 1;

      const colStart = Math.max(this.GRID_COL_OFFSET, gridColStart);
      const colEnd = Math.min(this.GRID_COL_OFFSET + this.TOTAL_GRID_COLS - 1, gridColEnd);

      if (colStart > colEnd) continue;

      try {
        mainSheet.mergeCells(rowStart, colStart, rowEnd, colEnd);
        const vesselCell = mainSheet.getCell(rowStart, colStart);

        const isPortside = ((vb.record as any).berthside || '').toLowerCase().includes('port');
        const bumpStr = isPortside ? `◀ ` : ` ▶`;
        
        vesselCell.value = isPortside ? `${bumpStr}${vb.record.vesselName}` : `${vb.record.vesselName}${bumpStr}`;
        vesselCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: 90 };
        
        // Deterministic unique color per vessel
        const palette = [
          'FF4A86E8', // Blue
          'FF93C47D', // Green
          'FFF6B26B', // Orange
          'FFFFD966', // Yellow
          'FFB4A7D6', // Purple
          'FFE06666', // Red
          'FF76A5AF', // Teal
          'FFC27BA0', // Pink
          'FFB7B7B7', // Gray
          'FF9FC5E8', // Light Blue
          'FFE6B8AF', // Light Red
          'FF8E7CC3', // Dark Purple
        ];
        
        let hash = 0;
        const colorKey = vb.record.vesselName || 'default';
        for (let i = 0; i < colorKey.length; i++) {
          hash = colorKey.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colorIdx = Math.abs(hash) % palette.length;
        const bgColor = palette[colorIdx];

        vesselCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        vesselCell.border = { top: { style: 'thick' }, bottom: { style: 'thick' }, left: { style: 'thick' }, right: { style: 'thick' } };

        // Plot left-side service merge
        const berthColMap: Record<string, number> = { R1: 1, R2: 2, R3: 3, R4: 4, B6: 5, B4: 6, B7: 7 };
        const leftCol = berthColMap[vb.berthZone];
        if (leftCol) {
          try {
            mainSheet.mergeCells(rowStart, leftCol, rowEnd, leftCol);
            const serviceCell = mainSheet.getCell(rowStart, leftCol);
            serviceCell.value = (vb.record as any).service || vb.record.vesselName;
            serviceCell.alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
            serviceCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
            serviceCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
          } catch (mergeErr: any) {
            this.logger.warn(`Could not merge left service column for ${vb.record.vesselName}: ${mergeErr.message}`);
          }
        }
      } catch (mergeErr: any) {
        this.logger.warn(`Could not plot vessel ${vb.record.vesselName}: ${mergeErr.message}`);
      }
    }

    // --- SETUP SUMMARY SHEET ---
    summarySheet.columns = [
      { header: 'Vessel Name', key: 'vesselName', width: 25 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Validation', key: 'validation', width: 15 },
      { header: 'Error Message', key: 'error', width: 40 },
      { header: 'LOA', key: 'loa', width: 10 },
      { header: 'Fore Meter', key: 'foreMeter', width: 15 },
      { header: 'Aft Meter', key: 'aftMeter', width: 15 },
    ];

    summarySheet.getRow(1).font = { bold: true };

    for (const p of processed) {
      summarySheet.addRow({
        vesselName: p.record.vesselName,
        status: p.record.status,
        validation: p.isValid ? 'VALID' : 'INVALID',
        error: p.error || '',
        loa: p.record.loa,
        foreMeter: p.record.foreMeter,
        aftMeter: p.record.aftMeter,
      });
    }

    // Write file
    const outputDir = path.dirname(outputPath);
    const fs = require('fs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    await workbook.xlsx.writeFile(outputPath);
    
    // Return summary for CLI
    return {
      total: processed.length,
      successful: processed.filter(p => p.isValid).length,
      invalid: processed.filter(p => !p.isValid).length,
      errors: processed.filter(p => !p.isValid).map(p => ({ vesselName: p.record.vesselName, message: p.error }))
    };
  }
}
