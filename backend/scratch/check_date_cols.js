const ExcelJS = require('exceljs');
const path = require('path');

async function checkCols() {
  const workbook = new ExcelJS.Workbook();
  const filePath = path.join(process.cwd(), '../empty-template.xlsx');
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('MAIN BERTH PLAN');

  console.log(`Col 76 Row 20: ${sheet.getCell(20, 76).value}`);
  console.log(`Col 77 Row 20: ${sheet.getCell(20, 77).value}`);
  console.log(`Col 78 Row 20: ${sheet.getCell(20, 78).value}`);
  console.log(`Col 79 Row 20: ${sheet.getCell(20, 79).value}`);
}

checkCols().catch(console.error);
