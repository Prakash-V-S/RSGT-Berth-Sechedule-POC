const ExcelJS = require('exceljs');
const path = require('path');

async function searchB() {
  const workbook = new ExcelJS.Workbook();
  const filePath = path.join(process.cwd(), '../empty-template.xlsx');
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('MAIN BERTH PLAN');

  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      if (cell.value && typeof cell.value === 'string' && (cell.value.includes('B4') || cell.value.includes('B5') || cell.value.includes('B6'))) {
        console.log(`Row ${rowNumber}, Col ${colNumber}: ${cell.value}`);
      }
    });
  });
}

searchB().catch(console.error);
