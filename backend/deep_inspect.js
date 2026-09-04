const ExcelJS = require('exceljs');
const fs = require('fs');

async function run() {
  const w = new ExcelJS.Workbook();
  await w.xlsx.readFile('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx');
  const s = w.getWorksheet('MAIN BERTH PLAN');
  
  const out = [];
  
  out.push('=== 1. TIME SLOT LABELS (Cols J, K, L, M) ===');
  for (let r = 11; r <= 15; r++) {
    const row = s.getRow(r);
    out.push(`Row ${r} J(10): ${row.getCell(10).value} | K(11): ${row.getCell(11).value} | L(12): ${row.getCell(12).value} | M(13): ${row.getCell(13).value ? 'has value' : 'null'}`);
  }

  out.push('\n=== 2. DATE/DAY STRUCTURE (Rows 11-50) ===');
  // Check merges in cols 10, 11
  const merges = s._merges; // this is an object where keys are e.g. 'J11:J22'
  for (const range of Object.keys(merges)) {
    if (range.startsWith('J') || range.startsWith('K') || range.startsWith('L')) {
      out.push(`Merge: ${range} -> value: ${s.getCell(range.split(':')[0]).value}`);
    }
  }

  out.push('\n=== 3. METER RULER MAPPING (Row 10) ===');
  const r10 = s.getRow(10);
  r10.eachCell((c, cn) => {
    if (cn >= 14) {
      out.push(`Col Num: ${cn}, Address: ${c.address}, Value: ${c.value}`);
    }
  });

  out.push('\n=== 4. BERTH SECTIONS (Rows 7, 8, 9) ===');
  for(let i=7; i<=9; i++) {
     const row = s.getRow(i);
     row.eachCell((c, cn) => {
       if (cn >= 14 && c.value) {
         out.push(`Row ${i} Col ${cn} (${c.address}): ${c.value}`);
       }
     });
  }

  out.push('\n=== 5. MERGES IN DRAWING CANVAS (Rows 11+, Cols 14+) ===');
  let canvasMerges = 0;
  for (const range of Object.keys(merges)) {
    const startCell = s.getCell(range.split(':')[0]);
    if (startCell.col >= 14 && startCell.row >= 11) {
      canvasMerges++;
    }
  }
  out.push(`Found ${canvasMerges} existing merged cell ranges in the drawing canvas.`);
  
  out.push('\n=== 6. OTHER SHEET PROPERTIES ===');
  out.push(`Images count: ${s.getImages().length}`);
  out.push(`Row 11 height: ${s.getRow(11).height}`);
  out.push(`Col 14 width: ${s.getColumn(14).width}`);
  
  fs.writeFileSync('scratch_deep_inspect.txt', out.join('\n'));
  console.log('Saved to scratch_deep_inspect.txt');
}

run().catch(console.error);
