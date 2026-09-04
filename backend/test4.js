const ExcelJS = require('exceljs');

async function run() {
  const w = new ExcelJS.Workbook();
  await w.xlsx.readFile('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx');
  const s = w.getWorksheet('MAIN BERTH PLAN');
  
  for (let r = 10; r <= 35; r++) {
    const row = s.getRow(r);
    let str = `Row ${r}: `;
    for (let c = 1; c <= 13; c++) {
      const val = row.getCell(c).value;
      if (val) {
        let v = (typeof val === 'object') ? (val.result || JSON.stringify(val)) : String(val);
        str += `C${c}(${v.substring(0,15)}) `;
      }
    }
    console.log(str);
  }
}
run();
