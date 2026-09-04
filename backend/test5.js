const ExcelJS = require('exceljs');

async function run() {
  const w = new ExcelJS.Workbook();
  await w.xlsx.readFile('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx');
  const s = w.getWorksheet('MAIN BERTH PLAN');
  
  let count = 0;
  s.eachRow((row, rn) => {
    row.eachCell((c, cn) => {
      let val = c.value;
      if (typeof val === 'object' && val !== null && val.result) val = val.result;
      const v = val ? val.toString() : '';
      if (v.includes('Thursday') || v.includes('03-09') || v.includes('2026') || v.includes('Sep')) {
        console.log(`Found at Row ${rn} Col ${cn}: ${v.substring(0, 50)}`);
        count++;
      }
    });
  });
  console.log('Total found:', count);
}
run();
