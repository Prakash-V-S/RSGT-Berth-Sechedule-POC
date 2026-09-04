const potrace = require('potrace');
const fs = require('fs');

const imagePath = 'D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/backend/assets/vessel-silhouette.png';

potrace.trace(imagePath, function(err, svg) {
  if (err) throw err;
  
  // Clean up SVG and inject currentColor
  let cleanSvg = svg.replace(/fill="black"/g, 'fill="currentColor"');
  
  fs.writeFileSync('D:/RSGT Berth Sechedule POC/rsgt-berth-schedule/backend/assets/vessel-silhouette.svg', cleanSvg);
  console.log('Successfully traced PNG to SVG master asset');
});
