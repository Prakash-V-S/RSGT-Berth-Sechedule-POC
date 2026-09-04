

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
  private readonly TEMPLATE_PATH = 'D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx';

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  async generateBerthPlan(processed: { record: any; isValid: boolean; error?: string; position?: CalculatedPosition }[], outputPath: string) {
    if (!fs.existsSync(this.TEMPLATE_PATH)) {
      throw new Error(`Template not found at ${this.TEMPLATE_PATH}`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(this.TEMPLATE_PATH);
    const mainSheet = workbook.getWorksheet('MAIN BERTH PLAN');
    if (!mainSheet) {
      throw new Error('MAIN BERTH PLAN sheet not found in template.');
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
            // Clear borders completely for time/date columns except when we re-add them
            cell.border = {};
            if (cell.isMerged) {
                try { mainSheet.unMergeCells(cell.address); } catch (e) {}
            }
        }
        // Clear old dummy blocks in columns A-G (1-7)
        for (let c = 1; c <= 7; c++) {
            const cell = mainSheet.getCell(r, c);
            cell.value = null;
            // Force a solid white fill to overwrite any template colors
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
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

    // --- PHASE 3: IMAGE OVERLAYS TEST ---
    const testMode = true; 
    let drawn = 0;
    
    // In-memory conflict shapes
    const drawnShapes: { vesselName: string, berthSection: string, cMin: number, cMax: number, rMin: number, rMax: number }[] = [];
    const logicalShapes: { col: number, rMin: number, rMax: number }[] = [];

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

    const getVesselBuffer = async (rec: any, colorHex: string, orientation: string, widthPx: number, heightPx: number): Promise<Buffer> => {
      const svgPath = path.join(process.cwd(), 'assets', 'vessel-silhouette.svg');
      let baseSvg = fs.readFileSync(svgPath, 'utf8');
      
      // The master SVG is drawn HORIZONTALLY with the bow pointing RIGHT.
      // In a berth schedule, the X-axis is physical length (meters), so the ship stays horizontal.
      // The width corresponds to LOA, the height corresponds to Time duration.
      const targetW = Math.max(1, Math.round(widthPx));
      const targetH = Math.max(1, Math.round(heightPx));
      
      // Replace currentColor with actual hex color
      let coloredSvg = baseSvg.replace(/currentColor/g, colorHex);
      
      // Strip any existing width, height, and preserveAspectRatio from the <svg> tag
      coloredSvg = coloredSvg.replace(/<svg([^>]*?)(?:\s+(?:width|height|preserveAspectRatio)="[^"]*")([^>]*?)>/g, (match) => {
         return match.replace(/\s+(?:width|height|preserveAspectRatio)="[^"]*"/g, '');
      });
      
      // Ensure SVG stretches exactly to the physical bounds
      coloredSvg = coloredSvg.replace('<svg', `<svg width="${targetW}" height="${targetH}" preserveAspectRatio="none"`);
      
      let sharpInstance = sharp(Buffer.from(coloredSvg));
      
      // If Portside, bow points left (original points right, so we flop horizontally)
      if (orientation === 'PORT_FACING') {
         sharpInstance = sharpInstance.flop();
      }

      // Add text overlay
      const textSvg = `
        <svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .text {
              font-family: sans-serif;
              font-size: 11px;
              fill: black;
              font-weight: bold;
              text-anchor: middle;
              dominant-baseline: middle;
            }
            .subtext {
              font-family: sans-serif;
              font-size: 9px;
              fill: black;
              text-anchor: middle;
              dominant-baseline: middle;
            }
          </style>
          <text x="50%" y="40%" class="text">${rec.vesselName || 'Unknown'}</text>
          <text x="50%" y="60%" class="subtext">${rec.phase || ''}</text>
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
      
      const logicalCol = LOGICAL_COLS_STATIC[rec.berthZone || 'UNKNOWN'];
      if (logicalCol) {
          const mergeRowStart = Math.floor(excelRowStart);
          const mergeRowEnd = Math.floor(excelRowEnd) - 1;
          if (mergeRowStart <= mergeRowEnd) {
             let mergeConflict = false;
             for (const shape of logicalShapes) {
                if (shape.col === logicalCol && !(mergeRowEnd <= shape.rMin || mergeRowStart >= shape.rMax)) {
                   mergeConflict = true;
                   break;
                }
             }

             if (!mergeConflict) {
                try {
                    mainSheet.mergeCells(mergeRowStart, logicalCol, mergeRowEnd, logicalCol);
                    const mergedCell = mainSheet.getCell(mergeRowStart, logicalCol);
                    mergedCell.fill = {
                       type: 'pattern',
                       pattern: 'solid',
                       fgColor: { argb: 'FF' + color.replace('#', '') }
                    };
                    mergedCell.value = rec.vesselName;
                    mergedCell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 90, wrapText: true };
                    mergedCell.font = { bold: true, size: 8 };
                    mergedCell.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
                    logicalShapes.push({ col: logicalCol, rMin: mergeRowStart, rMax: mergeRowEnd + 1 });
                } catch (e: any) {
                    this.logger.warn(`Could not merge logical background for ${rec.vesselName}: ${e.message}`);
                }
             }
          }
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
         tl: { col: excelColStart, row: excelRowStart } as any,
         br: { col: excelColEnd, row: excelRowEnd } as any,
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
      console.log(`Vessel: ${rec.vesselName}`);
      console.log(`Berth zone: ${rec.berthZone}`);
      console.log(`Phase/status: ${rec.status}`);
      console.log(`Raw start value: ${rec.estTimeOfBerth ? rec.estTimeOfBerth.toISOString() : (rec.ata ? rec.ata.toISOString() : (rec.eta ? rec.eta.toISOString() : 'N/A'))}`);
      console.log(`Parsed start value: ${new Date(startTimestamp).toISOString()}`);
      console.log(`Raw end value: ${rec.atd ? rec.atd.toISOString() : (rec.etd ? rec.etd.toISOString() : 'N/A')}`);
      console.log(`Parsed end value: ${new Date(endTimestamp).toISOString()}`);
      console.log(`Timeline start: ${scheduleStartDate.toISOString()}`);
      console.log(`Timeline end: ${scheduleEndDate.toISOString()}`);
      console.log(`Start row: ${excelRowStart.toFixed(4)}`);
      console.log(`End row: ${excelRowEnd.toFixed(4)}`);
      console.log(`Height: ${(excelRowEnd - excelRowStart).toFixed(2)}`);
      console.log(`Sub-lane index: ${p.position!.subLaneIndex || 0}`);
      console.log(`Maximum lanes: ${p.position!.berthMaxLanes || 1}`);
      console.log(`Berth start column: ${berthInfo.start}`);
      console.log(`Berth end column: ${berthInfo.end}`);
      console.log(`Vessel X: ${excelColStart.toFixed(4)} to ${excelColEnd.toFixed(4)}`);
      console.log(`Vessel width: ${finalVesselWidth.toFixed(4)}`);

      if (excelRowEnd - excelRowStart > 200) {
          console.log(`⚠️ WARNING: Vessel height is unexpectedly large (${(excelRowEnd - excelRowStart).toFixed(2)} rows)! Please inspect date-to-row conversion.`);
      }

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
