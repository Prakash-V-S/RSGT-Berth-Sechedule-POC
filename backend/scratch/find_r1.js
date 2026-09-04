const ExcelJS = require('exceljs');
const path = require('path');

async function searchR1() {
  const workbook = new ExcelJS.Workbook();
  const filePath = path.join(process.cwd(), '../empty-template.xlsx');
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('MAIN BERTH PLAN');

  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      if (cell.value && typeof cell.value === 'string' && (cell.value.includes('R1') || cell.value.includes('R2') || cell.value.includes('R3') || cell.value.includes('R4'))) {
        console.log(`Row ${rowNumber}, Col ${colNumber}: ${cell.value}`);
      }
    });
  });
}

searchR1().catch(console.error);
