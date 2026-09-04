const ExcelJS = require('exceljs');

async function run() {
  const w = new ExcelJS.Workbook();
  await w.xlsx.readFile('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx');
  const s = w.getWorksheet('MAIN BERTH PLAN');
  
  // Inspect Col H, I, J, K for Date labels
  for (let r = 11; r <= 35; r++) {
    const iVal = s.getCell(r, 9).value;
    const jVal = s.getCell(r, 10).value;
    const kVal = s.getCell(r, 11).value;

    const iStr = (typeof iVal === 'object' && iVal) ? (iVal.result || JSON.stringify(iVal)) : String(iVal);
    const jStr = (typeof jVal === 'object' && jVal) ? (jVal.result || JSON.stringify(jVal)) : String(jVal);
    const kStr = (typeof kVal === 'object' && kVal) ? (kVal.result || JSON.stringify(kVal)) : String(kVal);

    console.log(`Row ${r} I(9):${iStr.substring(0,20)} J(10):${jStr.substring(0,20)} K(11):${kStr.substring(0,20)}`);
  }
}
run();
