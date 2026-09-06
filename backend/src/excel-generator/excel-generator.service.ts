

import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';
import { CalculatedPosition } from '../position-engine/position-engine.service';
import { restoreTemplateHeaderShapes } from '../export/restore-template-shapes';
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

  async generateBerthPlan(
    processed: { record: any; isValid: boolean; error?: string; position?: CalculatedPosition; drawn?: boolean }[],
    outputPath: string,
    parseErrors: { vesselName?: string; message: string }[] = [],
  ): Promise<{total: number, successful: number, invalid: number, errors: any[]}> {
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

    // 1. Keep header images (logo / top nav); drop timeline leftovers only
    const sheetMedia = (mainSheet as any).media as any[] | undefined;
    if (Array.isArray(sheetMedia)) {
      (mainSheet as any).media = sheetMedia.filter((m) => {
        const row = m?.range?.tl?.nativeRow;
        const w = Number(m?.range?.ext?.width || 0);
        const h = Number(m?.range?.ext?.height || 0);
        return typeof row === 'number' && row < 10 && w > 0 && h > 0;
      });
    }

    // 2. Clear existing template body only (do not invent empty rows)
    const templateBodyLastRow = mainSheet.rowCount || 11;
    for (let r = 11; r <= templateBodyLastRow; r++) {
      const row = mainSheet.getRow(r);
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.value = null;
        cell.fill = { type: 'pattern', pattern: 'none' };
        cell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: 0 };
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
    
    const intervalMinutes = 120;
    const rowsPerInterval = 1;
    const timelineStartRow = 11;
    const berthGridStartCol = 14; // first berth meter column
    const berthGridEndCol = 68;   // last R4 column
    const templateLastRow = Math.max(mainSheet.rowCount || timelineStartRow, timelineStartRow);

    const makeThinBorder = () => ({
      top: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    });

    const makeDayEndBorder = () => ({
      top: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'medium' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } },
    });

    const noneFill = (): ExcelJS.Fill => ({ type: 'pattern', pattern: 'none' });
    const grayFill = (): ExcelJS.Fill => ({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE7E6E6' },
    });

    /**
     * ExcelJS shares style records — mutating cell.fill/alignment on one cell
     * can paint gray + rotation across the whole sheet. Always replace `style`
     * with a fresh object.
     */
    const setCellStyle = (
      cell: ExcelJS.Cell,
      opts: {
        fill?: ExcelJS.Fill;
        border?: Partial<ExcelJS.Borders>;
        alignment?: Partial<ExcelJS.Alignment>;
        font?: Partial<ExcelJS.Font>;
      },
    ) => {
      cell.style = {
        fill: opts.fill ? { ...opts.fill } : noneFill(),
        border: opts.border ? JSON.parse(JSON.stringify(opts.border)) : {},
        alignment: opts.alignment
          ? { ...opts.alignment }
          : { vertical: 'middle', horizontal: 'center', textRotation: 0 },
        font: opts.font ? { ...opts.font } : { name: 'Calibri', size: 10 },
      };
    };
    
    const scheduleStartDate = minTime === Number.MAX_SAFE_INTEGER ? new Date() : new Date(minTime);
    // Align schedule start to the beginning of the 2-hour block
    scheduleStartDate.setUTCMinutes(0, 0, 0);
    scheduleStartDate.setUTCHours(Math.floor(scheduleStartDate.getUTCHours() / 2) * 2);

    // End exactly at last vessel time (snapped up to 2h). No extra buffer day.
    const scheduleEndDate = maxTime === Number.MIN_SAFE_INTEGER
      ? new Date(scheduleStartDate.getTime() + 24 * 60 * 60 * 1000)
      : new Date(maxTime);
    scheduleEndDate.setUTCMinutes(0, 0, 0);
    scheduleEndDate.setUTCHours(Math.ceil(scheduleEndDate.getUTCHours() / 2) * 2);
    if (scheduleEndDate.getTime() <= scheduleStartDate.getTime()) {
      scheduleEndDate.setTime(scheduleStartDate.getTime() + intervalMinutes * 60000);
    }

    const getFractionalRowForTime = (time: Date) => {
      if (!time) return -1;
      const msDiff = time.getTime() - scheduleStartDate.getTime();
      const minutesDiff = msDiff / (1000 * 60);
      const intervalsDiff = minutesDiff / intervalMinutes;
      return timelineStartRow + (intervalsDiff * rowsPerInterval);
    };

    const plannedSlots = Math.max(
      1,
      Math.ceil((scheduleEndDate.getTime() - scheduleStartDate.getTime()) / (intervalMinutes * 60000)),
    );
    const lastTimelineRow = timelineStartRow + plannedSlots - 1;

    // --- PHASE 5: TIMELINE GENERATION ---
    const daysMap = new Map<string, { startRow: number, endRow: number, dayName: string }>();
    let rowCursor = timelineStartRow;

    // Clear template leftovers without creating rows past the real schedule
    const clearThrough = Math.max(templateLastRow, lastTimelineRow);
    for (let r = timelineStartRow; r <= clearThrough; r++) {
      for (let c = 1; c <= berthGridEndCol; c++) {
        const cell = mainSheet.getCell(r, c);
        if (cell.isMerged) {
          try { mainSheet.unMergeCells(cell.address); } catch (e) {}
        }
        cell.value = null;
        setCellStyle(cell, { fill: noneFill(), border: {} });
      }
    }

    /** Apply left sticky + right berth-grid borders for one timeline row (template right borders removed). */
    const paintRowGridBorders = (r: number, isDayEnd: boolean) => {
      for (let c = 1; c <= berthGridEndCol; c++) {
        if (c >= 10 && c <= 13) continue;
        setCellStyle(mainSheet.getCell(r, c), {
          fill: noneFill(),
          border: isDayEnd ? makeDayEndBorder() : makeThinBorder(),
        });
      }
    };

    for (let t = scheduleStartDate.getTime(); t < scheduleEndDate.getTime(); t += intervalMinutes * 60000) {
       const dateObj = new Date(t);
       
       const h = dateObj.getUTCHours();
       const startH = h.toString().padStart(2, '0');
       const endHNum = h + 2;
       const endHStr = endHNum === 24 ? '24' : endHNum.toString().padStart(2, '0');
       // Reference format: 0001-0200, 0201-0400 (horizontal)
       const timeLabel = `${startH}01-${endHStr}00`;
       
       const timeCell = mainSheet.getCell(rowCursor, 11);
       timeCell.value = timeLabel;
       setCellStyle(timeCell, {
         fill: grayFill(),
         border: makeThinBorder(),
         alignment: { vertical: 'middle', horizontal: 'center', textRotation: 0, wrapText: false },
         font: { name: 'Calibri', size: 9 },
       });

       const dd = dateObj.getUTCDate().toString().padStart(2, '0');
       const mm = (dateObj.getUTCMonth() + 1).toString().padStart(2, '0');
       const yyyy = dateObj.getUTCFullYear();
       const dateStr = `${dd}-${mm}-${yyyy}`;
       const dayStr = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dateObj.getUTCDay()];

       // Day ends at last 2h slot of the calendar day (2201-2400)
       const isDayEnd = h === 22;

       if (!daysMap.has(dateStr)) {
          daysMap.set(dateStr, { startRow: rowCursor, endRow: rowCursor + rowsPerInterval - 1, dayName: dayStr });
       } else {
          daysMap.get(dateStr)!.endRow = rowCursor + rowsPerInterval - 1;
       }

       // Right-side berth grid borders (user cleared these from empty template)
       paintRowGridBorders(rowCursor, isDayEnd);

       rowCursor += rowsPerInterval;
    }

    // Merge Date and Day cells in Cols L (12) and M (13)
    for (const [dateStr, info] of daysMap.entries()) {
       if (info.startRow < info.endRow) {
           try { mainSheet.mergeCells(info.startRow, 12, info.endRow, 12); } catch (e) {}
           try { mainSheet.mergeCells(info.startRow, 13, info.endRow, 13); } catch (e) {}
       }
       for (let r = info.startRow; r <= info.endRow; r++) {
         setCellStyle(mainSheet.getCell(r, 12), {
           fill: grayFill(),
           border: makeThinBorder(),
           alignment: { vertical: 'middle', horizontal: 'center', textRotation: 90 },
           font: { bold: true, name: 'Calibri', size: 10 },
         });
         setCellStyle(mainSheet.getCell(r, 13), {
           fill: noneFill(),
           border: makeThinBorder(),
           alignment: { vertical: 'middle', horizontal: 'center', textRotation: 90 },
           font: { bold: true, name: 'Calibri', size: 10 },
         });
       }
       mainSheet.getCell(info.startRow, 12).value = dateStr;
       mainSheet.getCell(info.startRow, 13).value = info.dayName;
    }

    this.logger.log(
      `Timeline ${scheduleStartDate.toISOString()} → ${scheduleEndDate.toISOString()} ` +
      `(rows ${timelineStartRow}–${lastTimelineRow}, ${plannedSlots} slots); right-side borders painted`,
    );

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

    // --- CLEAR OLD STICKY BACKGROUNDS (R1–R4, B6, B4, B7) keep borders ---
    for (let r = timelineStartRow; r <= lastTimelineRow; r++) {
       for (let c = 1; c <= 7; c++) {
          const cell = mainSheet.getCell(r, c);
          cell.value = null;
          setCellStyle(cell, {
            fill: noneFill(),
            border: makeThinBorder(),
          });
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

    const escapeXml = (s: string) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    /**
     * Rectangle vessel card: colored rounded rect + full top-down ship
     * (clear bow direction from Berthside) + arrow + schedule text.
     * Portside  → ship faces left
     * Starboardside → ship faces right (asset default)
     */
    const getVesselBuffer = async (rec: any, colorHex: string, orientation: string, widthPx: number, heightPx: number): Promise<Buffer> => {
      const targetW = Math.max(80, Math.round(widthPx));
      const targetH = Math.max(80, Math.round(heightPx));
      const facesLeft = orientation === 'PORT_FACING';
      const textColor = getLuminance(colorHex) > 0.35 ? '#111111' : '#FFFFFF';
      const arrowColor = '#1A3A6B';

      let labelMode: 'SMALL' | 'MEDIUM' | 'LARGE' = 'SMALL';
      if (targetH >= 220) labelMode = 'LARGE';
      else if (targetH >= 130) labelMode = 'MEDIUM';

      const padX = Math.max(8, Math.round(targetW * 0.05));
      const padTop = Math.max(6, Math.round(targetH * 0.03));
      const radius = Math.max(8, Math.round(Math.min(targetW, targetH) * 0.04));

      // Ship band: keep enough height so the FULL hull (bow→stern) stays visible
      const shipBandH = labelMode === 'SMALL'
        ? Math.round(targetH * 0.42)
        : Math.round(targetH * 0.30);
      const arrowBandH = labelMode === 'SMALL'
        ? Math.round(targetH * 0.14)
        : Math.round(targetH * 0.07);
      const shipW = Math.max(40, targetW - padX * 2);
      const shipH = Math.max(28, shipBandH - padTop);

      const bgSvg = `
        <svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${targetW}" height="${targetH}" rx="${radius}" ry="${radius}" fill="${colorHex}"/>
        </svg>`;

      const layers: { input: Buffer; top: number; left: number }[] = [];

      // Full ship graphic (bow RIGHT by default). Use contain so nothing is cropped.
      const photoPath = path.join(process.cwd(), 'assets', 'vessel-full.png');
      const photoFallback = path.join(process.cwd(), 'assets', 'vessel-photo.png');
      const shipSrc = fs.existsSync(photoPath) ? photoPath : photoFallback;
      if (fs.existsSync(shipSrc)) {
        // Transparent canvas so card color shows around the ship
        let shipPipeline = sharp(shipSrc)
          .resize(shipW, shipH, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });
        if (facesLeft) {
          shipPipeline = shipPipeline.flop();
        }
        const shipBuf = await shipPipeline.png().toBuffer();
        layers.push({ input: shipBuf, top: padTop, left: padX });
      }

      const arrowTop = padTop + shipH + Math.max(2, Math.round(arrowBandH * 0.1));
      const arrowW = Math.min(Math.round(targetW * 0.55), 280);
      const arrowH = Math.max(10, Math.min(Math.round(arrowBandH * 0.75), 36));
      const arrowLeft = Math.round((targetW - arrowW) / 2);
      const arrowSvg = facesLeft
        ? `<svg width="${arrowW}" height="${arrowH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24">
             <polygon points="0,12 28,0 28,7 100,7 100,17 28,17 28,24" fill="${arrowColor}"/>
           </svg>`
        : `<svg width="${arrowW}" height="${arrowH}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24">
             <polygon points="100,12 72,0 72,7 0,7 0,17 72,17 72,24" fill="${arrowColor}"/>
           </svg>`;
      layers.push({
        input: Buffer.from(arrowSvg),
        top: arrowTop,
        left: arrowLeft,
      });

      const nameStr = escapeXml(rec.vesselName || 'Unknown');
      const service = rec.service ? ` ${escapeXml(rec.service)}` : '';
      const nameLine = `${nameStr}${service}`;

      const eta = formatCompactDate(rec.eta) || 'TBA';
      const etb = formatCompactDate(rec.estTimeOfBerth) || 'TBA';
      const etd = formatCompactDate(rec.etd) || 'TBA';

      const loaBeam: string[] = [];
      if (rec.loa) loaBeam.push(`LOA ${rec.loa}M`);
      if (rec.beam) loaBeam.push(`${rec.beam}M`);
      const loaBeamStr = loaBeam.join('/');

      const portPair = [rec.previousPort, rec.nextPort].filter(Boolean).join('/');
      const movesParts: string[] = [];
      if (rec.moves !== undefined && rec.moves !== null && rec.moves !== '') {
        movesParts.push(`MOVES ${rec.moves}`);
      } else {
        movesParts.push('MOVES TBA');
      }
      if (rec.line) movesParts.push(escapeXml(rec.line));
      if (portPair) movesParts.push(escapeXml(portPair));
      const movesStr = movesParts.join(' ');

      const disVal = rec.discharge !== undefined && rec.discharge !== null ? rec.discharge : 'TBA';
      const loadVal = rec.load !== undefined && rec.load !== null ? rec.load : 'TBA';
      const disLoadStr = `DIS ${disVal}/ LOAD ${loadVal}`;

      const draftParts: string[] = [];
      if (rec.draftForward) draftParts.push(String(rec.draftForward));
      if (rec.draftAft) draftParts.push(String(rec.draftAft));
      const draftStr = draftParts.length > 0
        ? `DRAFT: ${draftParts.join('/')} M`
        : 'DRAFT: TBA M';

      const textTopY = arrowTop + arrowH + Math.max(4, Math.round(targetH * 0.02));
      const textAreaH = Math.max(20, targetH - textTopY - padTop);
      const titleSize = labelMode === 'LARGE' ? Math.max(18, Math.round(targetW * 0.045))
        : labelMode === 'MEDIUM' ? Math.max(14, Math.round(targetW * 0.04))
        : Math.max(12, Math.round(targetW * 0.05));
      const bodySize = Math.max(11, Math.round(titleSize * 0.85));

      const lines: string[] = [];
      if (labelMode === 'LARGE') {
        lines.push(nameLine);
        if (loaBeamStr) lines.push(loaBeamStr);
        lines.push(`ETA ${eta} ETB ${etb} ETD ${etd}`);
        lines.push(movesStr);
        lines.push(disLoadStr);
        lines.push(draftStr);
      } else if (labelMode === 'MEDIUM') {
        lines.push(nameLine);
        lines.push(`ETA ${eta} ETB ${etb} ETD ${etd}`);
        lines.push(movesStr);
        lines.push(disLoadStr);
      } else {
        lines.push(nameStr);
        lines.push(`ETA ${eta}  ETD ${etd}`);
      }

      const lineGap = textAreaH / (lines.length + 0.5);
      const textEls = lines.map((line, i) => {
        const y = Math.round(lineGap * (i + 0.7));
        const cls = i === 0 ? 'title' : 'text';
        return `<text x="50%" y="${y}" class="${cls}">${line}</text>`;
      });

      const textSvg = `
        <svg width="${targetW}" height="${textAreaH}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .title { font-family: Arial, sans-serif; font-size: ${titleSize}px; font-weight: bold; fill: ${textColor}; text-anchor: middle; dominant-baseline: middle; }
            .text { font-family: Arial, sans-serif; font-size: ${bodySize}px; font-weight: bold; fill: ${textColor}; text-anchor: middle; dominant-baseline: middle; }
          </style>
          ${textEls.join('\n')}
        </svg>`;
      layers.push({ input: Buffer.from(textSvg), top: textTopY, left: 0 });

      return await sharp(Buffer.from(bgSvg))
        .composite(layers)
        .png()
        .toBuffer();
    };

    /** Soften hex color toward white for sticky lane readability (ops-board pastels). */
    const softenColor = (hex: string, amount = 0.35): string => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const mix = (c: number) => Math.round(c + (255 - c) * amount);
      return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    };

    const getStickyLabel = (rec: any): string => {
      const raw = (rec.service || rec.line || rec.vesselName || '').toString().trim();
      if (!raw) return 'N/A';
      // Compact service codes like RES2WB / REX2-WB for vertical sticky text
      return raw.replace(/\s+/g, '').toUpperCase().slice(0, 12);
    };

    /**
     * Left sticky lane card (R1–R4): no ship photo.
     * Shows START / END berth meters (aft→fore) + vertical service code.
     */
    const getStickyBuffer = async (
      rec: any,
      colorHex: string,
      _orientation: string,
      widthPx: number,
      heightPx: number,
    ): Promise<Buffer> => {
      const targetW = Math.max(48, Math.round(widthPx));
      const targetH = Math.max(64, Math.round(heightPx));
      const fill = softenColor(colorHex, 0.28);
      const borderHex = (() => {
        const r = parseInt(colorHex.slice(1, 3), 16);
        const g = parseInt(colorHex.slice(3, 5), 16);
        const b = parseInt(colorHex.slice(5, 7), 16);
        const darken = (c: number) => Math.max(0, Math.round(c * 0.72));
        return `#${[darken(r), darken(g), darken(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
      })();
      const textColor = getLuminance(fill) > 0.4 ? '#1A1A1A' : '#FFFFFF';
      const label = escapeXml(getStickyLabel(rec));
      const startM = Math.round(Math.min(rec.foreMeter || 0, rec.aftMeter || 0));
      const endM = Math.round(Math.max(rec.foreMeter || 0, rec.aftMeter || 0));
      const startLabel = startM > 0 ? `${startM}M` : '—';
      const endLabel = endM > 0 ? `${endM}M` : '—';
      const radius = Math.max(6, Math.round(targetW * 0.18));
      const pad = Math.max(4, Math.round(targetW * 0.1));
      const headerH = Math.max(36, Math.round(targetW * 0.85));
      const footerH = Math.max(36, Math.round(targetW * 0.85));
      const midTop = headerH + 2;
      const midH = Math.max(24, targetH - headerH - footerH - 4);
      const fontSm = Math.max(8, Math.round(targetW * 0.22));
      const fontMd = Math.max(10, Math.round(targetW * 0.30));
      const fontLg = Math.max(11, Math.min(20, Math.round(targetW * 0.38)));
      const cx = targetW / 2;
      const lineX = Math.round(targetW * 0.22);

      // Single SVG: start node → vertical rail → end node + service label
      const cardSvg = `
        <svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${fill}"/>
              <stop offset="100%" stop-color="${softenColor(colorHex, 0.12)}"/>
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="${targetW - 2}" height="${targetH - 2}"
                rx="${radius}" ry="${radius}" fill="url(#g)" stroke="${borderHex}" stroke-width="2"/>

          <!-- START point (top) -->
          <circle cx="${lineX}" cy="${Math.round(headerH * 0.42)}" r="${Math.max(4, Math.round(targetW * 0.1))}"
                  fill="${borderHex}" stroke="${textColor}" stroke-width="1.5"/>
          <text x="${Math.round(targetW * 0.55)}" y="${Math.round(headerH * 0.28)}"
                fill="${textColor}" font-family="Arial, sans-serif" font-size="${fontSm}"
                font-weight="700" text-anchor="middle">START</text>
          <text x="${Math.round(targetW * 0.55)}" y="${Math.round(headerH * 0.62)}"
                fill="${textColor}" font-family="Arial, sans-serif" font-size="${fontMd}"
                font-weight="700" text-anchor="middle">${escapeXml(startLabel)}</text>

          <!-- Connecting rail -->
          <line x1="${lineX}" y1="${Math.round(headerH * 0.55)}" x2="${lineX}" y2="${targetH - Math.round(footerH * 0.55)}"
                stroke="${borderHex}" stroke-width="3" stroke-linecap="round"/>

          <!-- Vertical service code -->
          <text x="${cx + Math.round(targetW * 0.12)}" y="${midTop + midH / 2}" fill="${textColor}"
                font-family="Arial, sans-serif" font-size="${fontLg}" font-weight="700"
                text-anchor="middle" dominant-baseline="middle"
                transform="rotate(-90 ${cx + Math.round(targetW * 0.12)} ${midTop + midH / 2})">${label}</text>

          <!-- END point (bottom) -->
          <circle cx="${lineX}" cy="${targetH - Math.round(footerH * 0.42)}" r="${Math.max(4, Math.round(targetW * 0.1))}"
                  fill="${textColor}" stroke="${borderHex}" stroke-width="2"/>
          <text x="${Math.round(targetW * 0.55)}" y="${targetH - Math.round(footerH * 0.55)}"
                fill="${textColor}" font-family="Arial, sans-serif" font-size="${fontSm}"
                font-weight="700" text-anchor="middle">END</text>
          <text x="${Math.round(targetW * 0.55)}" y="${targetH - Math.round(footerH * 0.22)}"
                fill="${textColor}" font-family="Arial, sans-serif" font-size="${fontMd}"
                font-weight="700" text-anchor="middle">${escapeXml(endLabel)}</text>
        </svg>`;

      return await sharp(Buffer.from(cardSvg)).png().toBuffer();
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
          p.isValid = false;
          p.error = 'Unsupported berth zone';
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
         p.isValid = false;
         p.error = 'Out of bounds coordinates';
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
         p.isValid = false;
         p.error = 'Physical Scheduling Conflict';
         continue;
      }
      
      // Load image master asset and convert to padded PNG Buffer
      const color = getVesselColor(rec);

      // --- LEFT STICKY AREA: berth-lane service pills (ops-board style) ---
      // Full column width per berth zone (R1–R4), spanning occupancy time.
      // Visual: pastel rounded card + mini ship (L/R) + vertical service code.
      const stickyCol1Based = LOGICAL_COLS_STATIC[rec.berthZone || ''] || null;

      if (stickyCol1Based) {
          const inset = 0.08; // leave a thin gutter so adjacent lanes don't touch
          const stickyXStart = (stickyCol1Based - 1) + inset; // 0-indexed for exceljs
          const stickyXEnd = stickyCol1Based - inset;
          const stickyYStart = excelRowStart - 1;
          const stickyYEnd = excelRowEnd - 1;
          const stickyWidth = stickyXEnd - stickyXStart;
          const stickyHeight = stickyYEnd - stickyYStart;

          if (stickyWidth > 0 && stickyHeight > 0) {
              // ~9 Excel char-widths ≈ 70–90px; height scales with duration rows
              const stickyWpx = Math.max(56, Math.min(120, Math.round(stickyWidth * 90)));
              const stickyHpx = Math.max(80, Math.min(2400, Math.round(stickyHeight * 72)));
              const stickyPng = await getStickyBuffer(rec, color, orientationVal, stickyWpx, stickyHpx);

              const stickyImgId = workbook.addImage({
                  buffer: stickyPng as any,
                  extension: 'png',
              });

              mainSheet.addImage(stickyImgId, {
                  tl: { col: stickyXStart, row: stickyYStart } as any,
                  br: { col: stickyXEnd, row: stickyYEnd } as any,
                  editAs: 'absolute',
              });

              console.log(`\n[STICKY LANE] Vessel: ${rec.vesselName}`);
              console.log(`  Berth zone: ${rec.berthZone} → sticky col ${stickyCol1Based}`);
              console.log(`  Label: ${getStickyLabel(rec)}`);
              console.log(`  Orientation: ${orientationVal}`);
              console.log(`  Y ${stickyYStart.toFixed(3)} → ${stickyYEnd.toFixed(3)} (h=${stickyHeight.toFixed(3)} rows)`);
              console.log(`  Color: ${color}`);
          }
      } else {
          this.logger.warn(`No sticky column mapping for berth zone: ${rec.berthZone}`);
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
      console.log(`Berthside: ${rec.berthside || 'N/A'} → orientation: ${orientationVal} (${orientationVal === 'PORT_FACING' ? 'faces LEFT' : 'faces RIGHT'})`);
      
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

      p.drawn = true;
      drawn++;
    }

    if (testMode) {
      const testPath = path.join(path.dirname(outputPath), `berth-plan-shape-test-${Date.now()}.xlsx`);
      await workbook.xlsx.writeFile(testPath);
      console.log(`\nSaved shape test to: ${testPath}`);
      return { total: 1, successful: 1, invalid: 0, errors: [] as { vesselName: string, message: string }[] };
    }

    // Validation / conflict / valid summary lives on BERTH DETAILS (not MAIN BERTH PLAN)
    this.writeBerthDetailsSheet(workbook, processed, parseErrors);

    // Re-normalize timeline styles AFTER vessel drawing.
    // ExcelJS shared styles can leak date gray/rotation onto the berth grid.
    for (let r = timelineStartRow; r <= lastTimelineRow; r++) {
      const timeVal = String(mainSheet.getCell(r, 11).value || '');
      const isDayEnd = timeVal.startsWith('2201');

      // Sticky lanes + berth grid: white, borders only (no gray)
      for (let c = 1; c <= berthGridEndCol; c++) {
        if (c >= 11 && c <= 13) continue;
        setCellStyle(mainSheet.getCell(r, c), {
          fill: noneFill(),
          border: isDayEnd ? makeDayEndBorder() : makeThinBorder(),
        });
      }

      // Time column: light gray, horizontal 0001-0200
      if (timeVal) {
        setCellStyle(mainSheet.getCell(r, 11), {
          fill: grayFill(),
          border: makeThinBorder(),
          alignment: { vertical: 'middle', horizontal: 'center', textRotation: 0, wrapText: false },
          font: { name: 'Calibri', size: 9 },
        });
      }
    }
    for (const info of daysMap.values()) {
      for (let r = info.startRow; r <= info.endRow; r++) {
        setCellStyle(mainSheet.getCell(r, 12), {
          fill: grayFill(),
          border: makeThinBorder(),
          alignment: { vertical: 'middle', horizontal: 'center', textRotation: 90 },
          font: { bold: true, name: 'Calibri', size: 10 },
        });
        setCellStyle(mainSheet.getCell(r, 13), {
          fill: noneFill(),
          border: makeThinBorder(),
          alignment: { vertical: 'middle', horizontal: 'center', textRotation: 90 },
          font: { bold: true, name: 'Calibri', size: 10 },
        });
      }
    }

    // Strip extra columns past berth grid (template had cols out to ~123 with leaked borders/gray)
    const maxCol = Math.max(mainSheet.columnCount || berthGridEndCol, berthGridEndCol + 1);
    for (let c = berthGridEndCol + 1; c <= maxCol; c++) {
      try {
        mainSheet.getColumn(c).hidden = true;
      } catch (e) {}
      for (let r = timelineStartRow; r <= lastTimelineRow; r++) {
        const cell = mainSheet.getCell(r, c);
        cell.value = null;
        setCellStyle(cell, { fill: noneFill(), border: {} });
      }
    }

    // --- STOP AFTER LAST DATE/TIME ROW: no empty grids below ---
    // IMPORTANT: do NOT assign cell.border = {} on leftover rows — exceljs uses
    // shared styles, so clearing borders there also wipes the painted schedule grid.
    const maxRowProbe = Math.max(mainSheet.rowCount || lastTimelineRow, templateLastRow, lastTimelineRow + 50);
    for (let r = lastTimelineRow + 1; r <= maxRowProbe; r++) {
      const row = mainSheet.getRow(r);
      row.hidden = true;
      row.height = 0.1;
    }
    const rowsArrFinal = (mainSheet as any)._rows as any[] | undefined;
    if (rowsArrFinal && rowsArrFinal.length > lastTimelineRow + 1) {
      rowsArrFinal.length = lastTimelineRow + 1;
    }
    mainSheet.views = [
      {
        state: 'normal',
        showGridLines: false,
        showRowColHeaders: true,
        zoomScale: 70,
      },
    ];
    // Fit content to one landscape page — template ships with scale=10% which leaves huge PDF whitespace
    const printArea = `A1:${mainSheet.getColumn(berthGridEndCol).letter}${lastTimelineRow}`;
    try {
      mainSheet.pageSetup = {
        ...mainSheet.pageSetup,
        printArea,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        scale: 100,
        horizontalCentered: true,
        verticalCentered: true,
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.25,
          bottom: 0.25,
          header: 0.1,
          footer: 0.1,
        },
      };
    } catch (e) {}
    this.logger.log(`Sheet trimmed after row ${lastTimelineRow}; print area ${printArea}; fit-to-page enabled`);

    await workbook.xlsx.writeFile(outputPath);

    // ExcelJS drops AutoShapes on write — restore top-nav legend / draft marker shapes
    try {
      const restored = await restoreTemplateHeaderShapes(this.TEMPLATE_PATH, outputPath);
      this.logger.log(`Restored ${restored} template header shapes into output workbook`);
    } catch (e: any) {
      this.logger.warn(`Could not restore template header shapes: ${e?.message || e}`);
    }

    return {
      total: processed.length + parseErrors.length,
      successful: drawn,
      invalid: processed.filter(p => !p.isValid).length + parseErrors.length,
      errors: [
        ...parseErrors.map(e => ({ vesselName: e.vesselName || 'Unknown', message: e.message })),
        ...processed.filter(p => !p.isValid).map(p => ({ vesselName: p.record.vesselName, message: p.error || 'Unknown error' })),
      ],
    };
  }

  /**
   * Separate sheet listing every vessel with VALID / CONFLICT / INVALID status.
   * Conflict & invalid records are reported here instead of only on MAIN BERTH PLAN console output.
   */
  private writeBerthDetailsSheet(
    workbook: ExcelJS.Workbook,
    processed: { record: any; isValid: boolean; error?: string; position?: CalculatedPosition; drawn?: boolean }[],
    parseErrors: { vesselName?: string; message: string }[] = [],
  ): void {
    const sheetName = 'BERTH DETAILS';
    const existing = workbook.getWorksheet(sheetName);
    if (existing) workbook.removeWorksheet(existing.id);

    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'normal', showGridLines: true, zoomScale: 90 }],
    });

    const headers = [
      'S.No',
      'Status',
      'Vessel Name',
      'Berth',
      'Service',
      'Line',
      'Berthside',
      'LOA (m)',
      'Beam (m)',
      'Aft Meter',
      'Fore Meter',
      'ETA',
      'ETB',
      'ETD',
      'Moves',
      'Discharge',
      'Load',
      'Draft F/A',
      'Remarks / Error',
    ];

    const headerRow = sheet.getRow(1);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headerRow.height = 28;

    const fmt = (d: Date | null | undefined) => {
      if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
      const dd = d.getUTCDate().toString().padStart(2, '0');
      const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      const hh = d.getUTCHours().toString().padStart(2, '0');
      const mi = d.getUTCMinutes().toString().padStart(2, '0');
      return `${dd}-${mm}-${yyyy} ${hh}:${mi}`;
    };

    const statusOf = (p: { isValid: boolean; error?: string; drawn?: boolean }) => {
      if (p.drawn && p.isValid) return 'VALID';
      const err = (p.error || '').toLowerCase();
      if (err.includes('conflict')) return 'CONFLICT';
      if (!p.isValid) return 'INVALID';
      return 'VALID';
    };

    const statusFill: Record<string, string> = {
      VALID: 'FFC6EFCE',
      CONFLICT: 'FFFFC7CE',
      INVALID: 'FFFFEB9C',
    };
    const statusFont: Record<string, string> = {
      VALID: 'FF006100',
      CONFLICT: 'FF9C0006',
      INVALID: 'FF9C5700',
    };

    let rowNum = 2;
    let sno = 1;

    const writeRow = (vals: any[], status: string) => {
      const row = sheet.getRow(rowNum);
      vals.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v ?? '';
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
        cell.alignment = { vertical: 'middle', horizontal: i <= 1 ? 'center' : 'left', wrapText: true };
        if (i === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFill[status] || 'FFFFFFFF' } };
          cell.font = { bold: true, color: { argb: statusFont[status] || 'FF000000' } };
        }
      });
      rowNum++;
      sno++;
    };

    for (const p of processed) {
      const rec = p.record || {};
      const status = statusOf(p);
      const draftParts = [rec.draftForward, rec.draftAft].filter(v => v !== undefined && v !== null);
      writeRow([
        sno,
        status,
        rec.vesselName || '',
        rec.berthZone || '',
        rec.service || '',
        rec.line || '',
        rec.berthside || '',
        rec.loa ?? '',
        rec.beam ?? '',
        rec.aftMeter ?? '',
        rec.foreMeter ?? '',
        fmt(rec.eta),
        fmt(rec.estTimeOfBerth),
        fmt(rec.etd),
        rec.moves ?? '',
        rec.discharge ?? '',
        rec.load ?? '',
        draftParts.length ? draftParts.join(' / ') : '',
        p.error || (status === 'VALID' ? 'Plotted on MAIN BERTH PLAN' : ''),
      ], status);
    }

    for (const err of parseErrors) {
      writeRow([
        sno,
        'INVALID',
        err.vesselName || 'Unknown',
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        err.message || 'Parse error',
      ], 'INVALID');
    }

    // Summary block
    rowNum += 1;
    const validCount = processed.filter(p => statusOf(p) === 'VALID').length;
    const conflictCount = processed.filter(p => statusOf(p) === 'CONFLICT').length;
    const invalidCount = processed.filter(p => statusOf(p) === 'INVALID').length + parseErrors.length;

    const summaryStart = rowNum;
    [
      ['SUMMARY', ''],
      ['Total records', processed.length + parseErrors.length],
      ['VALID (on main plan)', validCount],
      ['CONFLICT (not plotted)', conflictCount],
      ['INVALID (not plotted)', invalidCount],
    ].forEach(([label, value]) => {
      const row = sheet.getRow(rowNum++);
      row.getCell(1).value = label;
      row.getCell(2).value = value;
      row.getCell(1).font = { bold: true };
    });
    sheet.getRow(summaryStart).getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1F4E79' } };

    const widths = [8, 12, 22, 8, 12, 10, 12, 10, 10, 10, 10, 18, 18, 18, 8, 10, 8, 12, 36];
    widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

    this.logger.log(
      `BERTH DETAILS sheet: ${validCount} valid, ${conflictCount} conflict, ${invalidCount} invalid`,
    );
  }
}
