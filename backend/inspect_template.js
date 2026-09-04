const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

async function run() {
  const w = new ExcelJS.Workbook();
  await w.xlsx.readFile('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx');
  const s = w.getWorksheet('MAIN BERTH PLAN');
  if(!s) {
    console.log('Sheet not found');
    return;
  }
  
  const out = [];
  
  // Row 8, 9 Berth Headers
  out.push('=== BERTH HEADERS (Row 8) ===');
  s.getRow(8).eachCell((c, cn) => { if(cn >= 14) out.push(`Col ${cn}: ${c.value}`); });

  out.push('=== BERTH HEADERS (Row 9) ===');
  s.getRow(9).eachCell((c, cn) => { if(cn >= 14) out.push(`Col ${cn}: ${c.value}`); });

  // Row 10 Meter Ruler
  out.push('=== METER RULER (Row 10) ===');
  s.getRow(10).eachCell((c, cn) => { if(cn >= 14) out.push(`Col ${cn}: ${c.value}`); });

  // Left panel Time
  out.push('=== LEFT PANEL TIME ===');
  for (let i = 11; i <= 100; i++) {
    const row = s.getRow(i);
    const c10 = row.getCell(10).value;
    const c11 = row.getCell(11).value;
    
    // Some merged cells might evaluate to object with formula or string
    const val10 = (typeof c10 === 'object' && c10 !== null && c10.result) ? c10.result : c10;
    const val11 = (typeof c11 === 'object' && c11 !== null && c11.result) ? c11.result : c11;
    
    if (val10 || val11) {
       out.push(`Row ${i} - C10(Date/Day): ${val10}, C11(Slot): ${val11}`);
    } else {
       // stop if 5 empty rows
       if (!s.getRow(i+1).getCell(11).value && !s.getRow(i+2).getCell(11).value) {
         out.push(`(Empty at row ${i})`);
         break;
       }
    }
  }

  const outputPath = path.join(__dirname, 'inspect_results.txt');
  fs.writeFileSync(outputPath, out.join('\n'));
  console.log('Done, saved to', outputPath);
}

run().catch(console.error);
