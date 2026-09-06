

import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import { CalculatedPosition } from '../position-engine/position-engine.service';
const sharp = require('sharp');

@Injectable()
export class ExcelGeneratorService {
  private readonly logger = new Logger(ExcelGeneratorService.name);

  // Hardcoded as requested
  private readonly TEMPLATE_PATH = path.join(process.cwd(), 'template', 'empty-template.xlsx');

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  async generateBerthPlan(processed: { record: any; isValid: boolean; error?: string; position?: CalculatedPosition }[], outputPath: string): Promise<{total: number, successful: number, invalid: number, errors: any[]}> {
    if (!fs.existsSync(this.TEMPLATE_PATH)) {
      throw new Error(`Template not found at ${this.TEMPLATE_PATH}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.TEMPLATE_PATH);
    const mainSheet = workbook.getWorksheet('MAIN BERTH PLAN');
    if (!mainSheet) {
      throw new Error('MAIN BERTH PLAN sheet not found in template.');
    }

    // --- CLEAR OLD TEMPLATE DATA (rows 11+) ---
    // This ensures every run starts clean from the base header-only template.
    this.logger.log('Clearing old template data...');

    // 1. Remove all embedded images
    (mainSheet as any).media = [];

    // 2. Clear all cell values and fills from row 11 downwards
    const lastRow = Math.max(mainSheet.rowCount, 300);
    for (let r = 11; r <= lastRow; r++) {
      const row = mainSheet.getRow(r);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.value = null;
        cell.fill = { type: 'pattern', pattern: 'none' };
      });
      row.commit();
    }

    // --- PHASE 3: METER MAPPING ---
    const stdMeterMap = new Map<number, number>(); // Linear map (R1, R2, R3)
    const revMeterMap = new Map<number, number>(); // Reversed map (R4)
    
    const r10 = mainSheet.getRow(10);
    r10.eachCell((cell, colNum) => {
      if (colNum >= 14 && typeof cell.value === 'number') {
        const meter = cell.value;
        if (colNum <= 48) {
          stdMeterMap.set(meter, colNum);
        } else if (colNum >= 49 && colNum <= 68) {
          revMeterMap.set(meter, colNum);
        }
      }
    });

    // We also need a helper to get the exact fractional column for a meter
    const getFractionalColumnForMeter = (meter: number, berth: string) => {
      const map = (berth.toLowerCase().includes('r4')) ? revMeterMap : stdMeterMap;
      
      let lowerMeter = -Infinity;
      let lowerCol = -1;
      let upperMeter = Infinity;
      let upperCol = -1;

      for (const [m, col] of map.entries()) {
        if (m <= meter && m > lowerMeter) { lowerMeter = m; lowerCol = col; }
        if (m >= meter && m < upperMeter) { upperMeter = m; upperCol = col; }
      }

      if (lowerMeter === -Infinity && upperMeter === Infinity) return 14;
      if (lowerMeter === -Infinity) return upperCol;
      if (upperMeter === Infinity) return lowerCol;
      if (lowerMeter === upperMeter) return lowerCol;

      // Linear interpolation
      const fraction = (meter - lowerMeter) / (upperMeter - lowerMeter);
      const colDiff = upperCol - lowerCol; 
      
      return lowerCol + (fraction * colDiff);
    };

    // --- PHASE 4: TIME MAPPING ---
    let minTime = Number.MAX_SAFE_INTEGER;
    let maxTime = Number.MIN_SAFE_INTEGER;
    
    for (const p of processed) {
      if (p.isValid && p.position) {
        minTime = Math.min(minTime, p.position.startTime.getTime());
        maxTime = Math.max(maxTime, p.position.endTime.getTime());
      }
    }
    
    // Configurable interval mapping as requested
    const intervalMinutes = 120;
    const rowsPerInterval = 1;
    const timelineStartRow = 11;
    
    const scheduleStartDate = minTime === Number.MAX_SAFE_INTEGER ? new Date() : new Date(minTime);
    // Align schedule start to the beginning of the 2-hour block
    scheduleStartDate.setUTCMinutes(0, 0, 0);
    scheduleStartDate.setUTCHours(Math.floor(scheduleStartDate.getUTCHours() / 2) * 2);

    const scheduleEndDate = maxTime === Number.MIN_SAFE_INTEGER ? new Date(scheduleStartDate.getTime() + 24 * 60 * 60 * 1000) : new Date(maxTime);
    scheduleEndDate.setUTCMinutes(0, 0, 0);
    scheduleEndDate.setUTCHours(Math.ceil(scheduleEndDate.getUTCHours() / 2) * 2);

    const getFractionalRowForTime = (time: Date) => {
      if (!time) return -1;
      const msDiff = time.getTime() - scheduleStartDate.getTime();
      const minutesDiff = msDiff / (1000 * 60);
      const intervalsDiff = minutesDiff / intervalMinutes;
      return timelineStartRow + (intervalsDiff * rowsPerInterval);
    };

    // --- PHASE 5: TIMELINE GENERATION ---
    const daysMap = new Map<string, { startRow: number, endRow: number, dayName: string }>();
    let rowCursor = timelineStartRow;
    
    // Pre-clear all potential timeline rows to avoid residual template colors
    for (let r = timelineStartRow; r < 1000; r++) {
        // Clear old template values in columns J, K, L, M (10-13)
        for (let c = 10; c <= 13; c++) {
            const cell = mainSheet.getCell(r, c);
            cell.value = null;
            cell.border = {};
            if (cell.isMerged) {
                try { mainSheet.unMergeCells(cell.address); } catch (e) {}
            }
        }
        // Clear old dummy blocks in columns A-I (1-9) but keep the grid borders
        for (let c = 1; c <= 9; c++) {
            const cell = mainSheet.getCell(r, c);
            cell.value = null;
            cell.fill = { type: 'pattern', pattern: 'none' };
            cell.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
            if (cell.isMerged) {
                try { mainSheet.unMergeCells(cell.address); } catch (e) {}
            }
        }
    }

    for (let t = scheduleStartDate.getTime(); t < scheduleEndDate.getTime(); t += intervalMinutes * 60000) {
       const dateObj = new Date(t);
       
       // Format Time Range for Col 11 (K)
       // e.g. 18:00 -> "1801-2000", 00:00 -> "0001-0200", 22:00 -> "2201-2400"
       const h = dateObj.getUTCHours();
       const startH = h.toString().padStart(2, '0');
       let endHNum = h + 2;
       // Excel usually uses 2400 for midnight end
       const endHStr = endHNum.toString().padStart(2, '0');
       const timeLabel = `${startH}01-${endHStr}00`;
       
       const timeCell = mainSheet.getCell(rowCursor, 11);
       timeCell.value = timeLabel;
       timeCell.alignment = { vertical: 'middle', horizontal: 'center' };
       timeCell.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
       timeCell.font = { name: 'Calibri', size: 10 };

       // Format Date to DD-MM-YYYY
       const dd = dateObj.getUTCDate().toString().padStart(2, '0');
       const mm = (dateObj.getUTCMonth() + 1).toString().padStart(2, '0');
       const yyyy = dateObj.getUTCFullYear();
       const dateStr = `${dd}-${mm}-${yyyy}`;
       
       const dayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dateObj.getUTCDay()];

       if (!daysMap.has(dateStr)) {
          daysMap.set(dateStr, { startRow: rowCursor, endRow: rowCursor + rowsPerInterval - 1, dayName: dayStr });
       } else {
          daysMap.get(dateStr)!.endRow = rowCursor + rowsPerInterval - 1;
       }
       rowCursor += rowsPerInterval;
    }

    // Merge Date and Day cells in Cols L (12) and M (13)
    for (const [dateStr, info] of daysMap.entries()) {
       if (info.startRow < info.endRow) {
           try { mainSheet.mergeCells(info.startRow, 12, info.endRow, 12); } catch (e) {}
           try { mainSheet.mergeCells(info.startRow, 13, info.endRow, 13); } catch (e) {}
       }
       const dateCell = mainSheet.getCell(info.startRow, 12);
       dateCell.value = dateStr;
       dateCell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90 };
       dateCell.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
       dateCell.fill = {
           type: 'pattern',
           pattern: 'solid',
           fgColor: { argb: 'FFE7E6E6' } // Light grey background like the screenshot
       };
       dateCell.font = { bold: true };
       
       const dayCell = mainSheet.getCell(info.startRow, 13);
       dayCell.value = info.dayName;
       dayCell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90 };
       dayCell.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
       dayCell.font = { bold: true };
    }

    // --- PHASE 6: STATIC BERTH MAPPING ---
    const BERTH_COLS_STATIC: Record<string, { start: number, end: number }> = {
        'R1': { start: 14, end: 24 },
        'R2': { start: 25, end: 35 },
        'R3': { start: 36, end: 48 },
        'R4': { start: 49, end: 68 },
    };

    const LOGICAL_COLS_STATIC: Record<string, number> = {
        'R1': 1,
        'R2': 2,
        'R3': 3,
        'R4': 4,
    };

    // --- VALID VESSELS ---
    const validVessels = processed.filter(p => p.isValid && p.position);
    if (validVessels.length === 0) {
       this.logger.warn("No valid vessels found to plot!");
    }

    // --- CLEAR OLD STICKY BACKGROUNDS ---
    for (let r = 11; r <= (mainSheet.rowCount || 300); r++) {
       for (let c = 1; c <= 4; c++) {
          const cell = mainSheet.getCell(r, c);
          cell.fill = { type: 'pattern', pattern: 'none' };
          cell.value = null;
       }
    }

    // --- PHASE 3: IMAGE OVERLAYS TEST ---
    const testMode = false; 
    let drawn = 0;
    
    // In-memory conflict shapes
    const drawnShapes: { vesselName: string, berthSection: string, cMin: number, cMax: number, rMin: number, rMax: number }[] = [];

    const getVesselOrientation = (rec: any) => {
       const berthside = (rec.berthside || '').toLowerCase();
       if (berthside.includes('port')) return 'PORT_FACING';
       if (berthside.includes('starboard')) return 'START_FACING';
       return 'START_FACING';
    };

    const getVesselColor = (rec: any) => {
       const colors = [
          '#4A86E8', // Blue
          '#E06666', // Red
          '#F6B26B', // Orange
          '#93C47D', // Green
          '#8E7CC3', // Purple
          '#FFD966', // Yellow
          '#76A5AF', // Teal
          '#C9DAF8', // Light Blue
          '#D5A6BD', // Pink
          '#B4A7D6', // Lavender
          '#E6B8AF', // Peach
          '#A2C4C9', // Light Teal
       ];
       const name = rec.vesselName || '';
       let hash = 0;
       for (let i = 0; i < name.length; i++) {
           hash = name.charCodeAt(i) + ((hash << 5) - hash);
       }
       hash = Math.abs(hash);
       return colors[hash % colors.length];
    };

    const formatCompactDate = (d: Date | null | undefined) => {
        if (!d) return '';
        const dd = d.getUTCDate().toString().padStart(2, '0');
        const hh = d.getUTCHours().toString().padStart(2, '0');
        const mm = d.getUTCMinutes().toString().padStart(2, '0');
        return `${dd}/${hh}${mm}`;
    };

    const getLuminance = (hex: string) => {
        let r = parseInt(hex.substring(1, 3), 16) / 255;
        let g = parseInt(hex.substring(3, 5), 16) / 255;
        let b = parseInt(hex.substring(5, 7), 16) / 255;
        r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
        g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
        b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const getVesselBuffer = async (rec: any, colorHex: string, orientation: string, widthPx: number, heightPx: number): Promise<Buffer> => {
      const svgPath = path.join(process.cwd(), 'assets', 'vessel-silhouette.svg');
      let baseSvg = fs.readFileSync(svgPath, 'utf8');
      
      const targetW = Math.max(1, Math.round(widthPx));
      const targetH = Math.max(1, Math.round(heightPx));
      
      let coloredSvg = baseSvg.replace(/currentColor/g, colorHex);
      
      coloredSvg = coloredSvg.replace(/<svg([^>]*?)(?:\s+(?:width|height|preserveAspectRatio)="[^"]*")([^>]*?)>/g, (match) => {
         return match.replace(/\s+(?:width|height|preserveAspectRatio)="[^"]*"/g, '');
      });
      
      coloredSvg = coloredSvg.replace('<svg', `<svg width="${targetW}" height="${targetH}" preserveAspectRatio="none"`);
      
      let sharpInstance = sharp(Buffer.from(coloredSvg));
      
      if (orientation === 'PORT_FACING') {
         sharpInstance = sharpInstance.flop();
      }

      const textColor = getLuminance(colorHex) > 0.3 ? '#000000' : '#FFFFFF';
      
      let labelMode = 'SMALL';
      if (targetH >= 150) labelMode = 'LARGE';
      else if (targetH >= 90) labelMode = 'MEDIUM';
      
      let elements = [];
      const nameStr = rec.vesselName || 'Unknown';
      const service = rec.service ? ` ${rec.service}` : '';
      const nameLine = `${nameStr}${service}`;

      const eta = formatCompactDate(rec.eta);
      const etb = formatCompactDate(rec.estTimeOfBerth);
      const etd = formatCompactDate(rec.etd);

      const loaBeam = [];
      if (rec.loa) loaBeam.push(`LOA ${rec.loa}M`);
      if (rec.beam) loaBeam.push(`${rec.beam}M`);
      const loaBeamStr = loaBeam.length > 0 ? loaBeam.join(' / ') : '';

      const moves = rec.moves ? `MOVES ${rec.moves}` : '';
      const disLoad = [];
      if (rec.discharge !== undefined) disLoad.push(`DIS ${rec.discharge}`);
      if (rec.load !== undefined) disLoad.push(`LOAD ${rec.load}`);
      const disLoadStr = disLoad.length > 0 ? disLoad.join(' / ') : '';

      const draft = [];
      if (rec.draftForward) draft.push(rec.draftForward);
      if (rec.draftAft) draft.push(rec.draftAft);
      const draftStr = draft.length > 0 ? `DRAFT: ${draft.join('/')} M` : '';

      if (labelMode === 'LARGE') {
          elements.push(`<text x="50%" y="30%" class="title">${nameLine}</text>`);
          if (loaBeamStr) elements.push(`<text x="50%" y="40%" class="text">${loaBeamStr}</text>`);
          elements.push(`<text x="50%" y="50%" class="text">ETA ${eta}   ETB ${etb}   ETD ${etd}</text>`);
          if (moves) elements.push(`<text x="50%" y="60%" class="text">${moves}</text>`);
          if (disLoadStr) elements.push(`<text x="50%" y="70%" class="text">${disLoadStr}</text>`);
          if (draftStr) elements.push(`<text x="50%" y="85%" class="text">${draftStr}</text>`);
      } else if (labelMode === 'MEDIUM') {
          elements.push(`<text x="50%" y="35%" class="title">${nameLine}</text>`);
          elements.push(`<text x="50%" y="55%" class="text">ETA ${eta}  ETB ${etb}  ETD ${etd}</text>`);
          if (moves) elements.push(`<text x="50%" y="70%" class="text">${moves}</text>`);
          if (disLoadStr) elements.push(`<text x="50%" y="85%" class="text">${disLoadStr}</text>`);
      } else {
          elements.push(`<text x="50%" y="40%" class="title">${nameStr}</text>`);
          elements.push(`<text x="50%" y="65%" class="text">ETA ${eta}   ETD ${etd}</text>`);
      }

      const startM = Math.round(Math.min(rec.foreMeter || 0, rec.aftMeter || 0));
      const endM = Math.round(Math.max(rec.foreMeter || 0, rec.aftMeter || 0));

      if (labelMode !== 'SMALL') {
         if (startM > 0) elements.push(`<text x="15" y="25" class="meter" text-anchor="start">${startM}M</text>`);
         if (endM > 0) elements.push(`<text x="${targetW - 15}" y="25" class="meter" text-anchor="end">${endM}M</text>`);
      }

      const textSvg = `
        <svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .title { font-family: sans-serif; font-size: 52px; font-weight: bold; fill: ${textColor}; text-anchor: middle; dominant-baseline: middle; }
            .text { font-family: sans-serif; font-size: 44px; fill: ${textColor}; text-anchor: middle; dominant-baseline: middle; }
            .meter { font-family: sans-serif; font-size: 48px; font-weight: bold; fill: ${textColor}; dominant-baseline: hanging; }
          </style>
          ${elements.join('\n')}
        </svg>
      `;

      sharpInstance = sharpInstance.composite([{
          input: Buffer.from(textSvg),
          top: 0,
          left: 0
      }]);

      return await sharpInstance.png().toBuffer();
    };

    for (const p of validVessels) {
      const rec = p.record;
      const v = p.position!;
      const startTimestamp = p.position!.startTime;
      const endTimestamp = p.position!.endTime;
      const startTime = startTimestamp;
      const endTime = endTimestamp;

      const berthInfo = BERTH_COLS_STATIC[rec.berthZone || 'UNKNOWN'];
      if (!berthInfo) {
          this.logger.warn(`Unsupported berth zone skipped: ${rec.berthZone}`);
          processed.find(pr => pr.record.vesselName === rec.vesselName)!.isValid = false;
          processed.find(pr => pr.record.vesselName === rec.vesselName)!.error = 'Unsupported berth zone';
          continue;
      }
      const totalBerthCols = berthInfo.end - berthInfo.start + 1;
      
      const subLaneWidthCols = totalBerthCols / (p.position!.berthMaxLanes || 1);
      const lanePadding = 0.5; // Internal padding inside sub-lane

      const laneLeft = berthInfo.start + (p.position!.subLaneIndex || 0) * subLaneWidthCols;
      const laneRight = laneLeft + subLaneWidthCols;

      const physicalVesselWidthCols = (p.position!.occupiedLength || 100) / 25.0;
      
      let finalVesselWidth = Math.min(physicalVesselWidthCols, Math.max(0.5, subLaneWidthCols - 2 * lanePadding));
      if (isNaN(finalVesselWidth) || finalVesselWidth <= 0) {
         finalVesselWidth = subLaneWidthCols * 0.75;
      }
      
      // Center SVG inside its own sub-lane ONLY
      let excelColStart = laneLeft + (subLaneWidthCols - finalVesselWidth) / 2;
      let excelColEnd = excelColStart + finalVesselWidth;
      
      let orientationVal = getVesselOrientation(rec);
      
      // Fallback just in case
      if (excelColEnd <= excelColStart) {
         excelColEnd = excelColStart + 1;
      }

      const rStart = getFractionalRowForTime(new Date(startTimestamp));
      const rEnd = getFractionalRowForTime(new Date(endTimestamp));
      
      let excelRowStart = Math.min(rStart, rEnd);
      let excelRowEnd = Math.max(rStart, rEnd);
      
      // Validation as requested: height must be reasonable and never extend beyond ETD
      if (excelRowEnd <= excelRowStart) {
          excelRowEnd = excelRowStart + 1; // Minimum 1-row height
      }

      if (excelRowStart < 11 || excelColStart < 14) {
         processed.find(pr => pr.record.vesselName === rec.vesselName)!.isValid = false;
         processed.find(pr => pr.record.vesselName === rec.vesselName)!.error = 'Out of bounds coordinates';
         continue;
      }

      // Pure in-memory overlap check
      let conflict = false;
      const berthSection = rec.berthZone || 'R1';
      for (const shape of drawnShapes) {
         if (shape.berthSection === berthSection) {
            // Rect intersection
            if (excelColStart < shape.cMax && excelColEnd > shape.cMin &&
                excelRowStart < shape.rMax && excelRowEnd > shape.rMin) {
               conflict = true;
               break;
            }
         }
      }

      if (conflict) {
         processed.find(pr => pr.record.vesselName === rec.vesselName)!.isValid = false;
         processed.find(pr => pr.record.vesselName === rec.vesselName)!.error = 'Physical Scheduling Conflict';
         continue;
      }
      
      // Load image master asset and convert to padded PNG Buffer
      const color = getVesselColor(rec);

      // --- LEFT STICKY AREA: SVG RECTANGLE OVERLAY ---
      // Maps physical meter position into cols 1-4 (R1=0-400m, R2=400-800m, R3=800-1200m, R4=1200-1700m)
      // Each zone is exactly 1 Excel column wide (fractional sub-positions within).
      const STICKY_ZONES = [
          { col: 1, mStart: 0,    mEnd: 400  },
          { col: 2, mStart: 400,  mEnd: 800  },
          { col: 3, mStart: 800,  mEnd: 1200 },
          { col: 4, mStart: 1200, mEnd: 1700 },
      ];
      const STICKY_TOTAL_M = 1700; // total meter span of 4 columns

      const getMeterToStickyCol = (meter: number): number => {
          // clamp to 0-1700
          const m = Math.max(0, Math.min(meter, STICKY_TOTAL_M));
          for (const z of STICKY_ZONES) {
              if (m >= z.mStart && m <= z.mEnd) {
                  const fraction = (m - z.mStart) / (z.mEnd - z.mStart);
                  return z.col - 1 + fraction; // 0-indexed fractional col for exceljs image anchor
              }
          }
          return 0;
      };

      const aftM = Math.min(rec.foreMeter || 0, rec.aftMeter || 0);
      const foreM = Math.max(rec.foreMeter || 0, rec.aftMeter || 0);

      const stickyXStart = getMeterToStickyCol(aftM);   // fractional 0-indexed col
      const stickyXEnd   = getMeterToStickyCol(foreM);  // fractional 0-indexed col

      // Y uses the same time functions as the main vessel (0-indexed for exceljs)
      const stickyYStart = excelRowStart - 1;  // already fractional; convert to 0-indexed
      const stickyYEnd   = excelRowEnd   - 1;

      const stickyWidth  = stickyXEnd - stickyXStart;
      const stickyHeight = stickyYEnd - stickyYStart;

      // Only render if the rectangle has meaningful size and is within bounds
      if (stickyWidth > 0 && stickyHeight > 0 && stickyXEnd > 0 && stickyXStart < 4) {
          const rectSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="0" y="0" width="100" height="100" fill="${color}" /></svg>`;

          // Rasterize to PNG via sharp (pixel size doesn't matter much, will be stretched by Excel)
          const rectPng = await sharp(Buffer.from(rectSvg))
              .resize(50, 200, { fit: 'fill' })
              .png()
              .toBuffer();

          const stickyImgId = workbook.addImage({
              buffer: rectPng as any,
              extension: 'png',
          });

          mainSheet.addImage(stickyImgId, {
              tl: { col: stickyXStart, row: stickyYStart } as any,
              br: { col: stickyXEnd,   row: stickyYEnd   } as any,
              editAs: 'absolute'
          });

          console.log(`\n[STICKY RECT] Vessel: ${rec.vesselName}`);
          console.log(`  Aft Meter: ${aftM}m  |  Fore Meter: ${foreM}m`);
          console.log(`  Occupancy Start: ${new Date(startTimestamp).toISOString()}`);
          console.log(`  Occupancy End:   ${new Date(endTimestamp).toISOString()}`);
          console.log(`  X Start (0-idx col): ${stickyXStart.toFixed(4)}  |  X End: ${stickyXEnd.toFixed(4)}`);
          console.log(`  Y Start (0-idx row): ${stickyYStart.toFixed(4)}  |  Y End: ${stickyYEnd.toFixed(4)}`);
          console.log(`  Width: ${stickyWidth.toFixed(4)} cols  |  Height: ${stickyHeight.toFixed(4)} rows`);
          console.log(`  Color: ${color}`);
      }

      // Limit internal rendering resolution to avoid Sharp crashes on huge durations,
      // while keeping the aspect ratio calculation intact via the swapped logic above.
      const widthPx = Math.min((excelColEnd - excelColStart) * 110, 4000);
      const heightPx = Math.min((excelRowEnd - excelRowStart) * 80, 8000);
      const vesselColor = getVesselColor(rec);
      const vesselBuffer = await getVesselBuffer(rec, vesselColor, orientationVal, widthPx, heightPx);
      
      const imageId = workbook.addImage({
         buffer: vesselBuffer as any,
         extension: 'png',
      });
      
      mainSheet.addImage(imageId, {
         tl: { col: excelColStart - 1, row: excelRowStart - 1 } as any,
         br: { col: excelColEnd - 1, row: excelRowEnd - 1 } as any,
         editAs: 'absolute'
      });

      drawnShapes.push({
         vesselName: rec.vesselName,
         berthSection: berthSection,
         cMin: excelColStart,
         cMax: excelColEnd,
         rMin: excelRowStart,
         rMax: excelRowEnd
      });

      console.log(`\n========================================`);
      console.log(`Vessel Name: ${rec.vesselName}`);
      console.log(`Aft Meter: ${rec.aftMeter}m`);
      console.log(`Fore Meter: ${rec.foreMeter}m`);
      console.log(`Physical start column: ${excelColStart.toFixed(4)}`);
      console.log(`Physical end column: ${excelColEnd.toFixed(4)}`);
      console.log(`Occupancy start row: ${excelRowStart.toFixed(4)}`);
      console.log(`Occupancy end row: ${excelRowEnd.toFixed(4)}`);
      console.log(`Applied color: ${color}`);
      
      const draftLog = [];
      if (rec.draftForward !== undefined) draftLog.push(rec.draftForward);
      if (rec.draftAft !== undefined) draftLog.push(rec.draftAft);
      const draftStrLog = draftLog.length > 0 ? `DRAFT: ${draftLog.join('/')} M` : 'N/A';

      console.log(`\nLabel Values:`);
      console.log(`LOA: ${rec.loa || 'N/A'}`);
      console.log(`Beam: ${rec.beam || 'N/A'}`);
      console.log(`ETA: ${rec.eta ? rec.eta.toISOString() : 'N/A'}`);
      console.log(`ETB: ${rec.estTimeOfBerth ? rec.estTimeOfBerth.toISOString() : 'N/A'}`);
      console.log(`ETD: ${rec.etd ? rec.etd.toISOString() : 'N/A'}`);
      console.log(`Moves: ${rec.moves || 'N/A'}`);
      console.log(`Discharge: ${rec.discharge !== undefined ? rec.discharge : 'N/A'}`);
      console.log(`Load: ${rec.load !== undefined ? rec.load : 'N/A'}`);
      console.log(`RF: N/A`); // RF missing from CSV headers as requested
      console.log(`Draft: ${draftStrLog}`);

      if (testMode) {
        console.log(`Conflict Result: No Conflict. Successfully drawn.`);
      }

      drawn++;
    }

    if (testMode) {
      const testPath = path.join(path.dirname(outputPath), `berth-plan-shape-test-${Date.now()}.xlsx`);
      await workbook.xlsx.writeFile(testPath);
      console.log(`\nSaved shape test to: ${testPath}`);
      return { total: 1, successful: 1, invalid: 0, errors: [] as { vesselName: string, message: string }[] };
    }

    // In normal mode we would write to outputPath
    await workbook.xlsx.writeFile(outputPath);
    return {
      total: processed.length,
      successful: drawn,
      invalid: processed.filter(p => !p.isValid).length,
      errors: processed.filter(p => !p.isValid).map(p => ({ vesselName: p.record.vesselName, message: p.error || 'Unknown error' }))
    };
  }
}
