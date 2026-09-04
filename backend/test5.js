const ExcelJS = require('exceljs');

async function test() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx');
  const sheet = workbook.getWorksheet('MAIN BERTH PLAN');
  
  const r8 = sheet.getRow(8);
  const r9 = sheet.getRow(9);
  const r10 = sheet.getRow(10);
  
  for(let i=1; i<=10; i++) {
     console.log(`Col ${i}: R8='${r8.getCell(i).value}' R9='${r9.getCell(i).value}' R10='${r10.getCell(i).value}'`);
  }
}
test();
