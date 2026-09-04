const ExcelJS = require('exceljs');
const path = require('path');

async function checkRow() {
  const workbook = new ExcelJS.Workbook();
  const filePath = path.join(process.cwd(), '../empty-template.xlsx');
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('MAIN BERTH PLAN');

  for (let c = 14; c <= 68; c++) {
    const val8 = sheet.getCell(8, c).value;
    const val9 = sheet.getCell(9, c).value;
    if (val8) console.log(`Col ${c} Row 8: ${val8}`);
    if (val9) console.log(`Col ${c} Row 9: ${val9}`);
  }
}

checkRow().catch(console.error);
