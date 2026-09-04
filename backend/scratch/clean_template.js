const ExcelJS = require('exceljs');

async function cleanTemplate() {
    const templatePath = 'D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/empty-template.xlsx';
    console.log(`Loading ${templatePath}...`);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    
    const sheet = workbook.getWorksheet('MAIN BERTH PLAN');
    
    // 1. Unmerge all cells from row 11 downwards
    console.log('Unmerging cells below row 10...');
    const mergesToUndo = [];
    if (sheet.hasMerges) {
        for (const merge of Object.values(sheet.model.merges)) {
            // merge is a string like "A11:C15"
            // We can check if the start row is >= 11
            const match = merge.match(/[A-Z]+(\d+):[A-Z]+(\d+)/);
            if (match) {
                const startRow = parseInt(match[1], 10);
                const endRow = parseInt(match[2], 10);
                if (startRow >= 11 || endRow >= 11) {
                    mergesToUndo.push(merge);
                }
            }
        }
    }
    
    for (const merge of mergesToUndo) {
        try {
            sheet.unmergeCells(merge);
        } catch (e) {
            console.error(`Failed to unmerge ${merge}: ${e.message}`);
        }
    }
    
    // 2. Clear values and fills for all rows >= 11
    console.log('Clearing cell values and backgrounds...');
    const rowCount = sheet.rowCount;
    for (let r = 11; r <= rowCount; r++) {
        const row = sheet.getRow(r);
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            cell.value = null;
            // Remove background fills
            cell.fill = {
                type: 'pattern',
                pattern: 'none'
            };
            // Remove images anchored here if any? ExcelJS doesn't easily expose cell-linked images 
            // but we can just clear the values and fills.
        });
        row.commit();
    }
    
    // 3. Remove all images from the worksheet
    console.log('Removing embedded images...');
    sheet.getImages().forEach(image => {
        // Unfortunately ExcelJS doesn't have a direct sheet.removeImage(id) 
        // We will just clear the images array manually
    });
    // @ts-ignore
    sheet.media = [];

    console.log('Saving cleaned template...');
    await workbook.xlsx.writeFile(templatePath);
    console.log('Done!');
}

cleanTemplate().catch(console.error);
