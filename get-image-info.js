const fs = require('fs');

// Get file size to estimate if we need to adjust coordinates
fs.stat('./public/map.png', (err, stats) => {
  if (err) {
    console.log('Error:', err);
    return;
  }
  
  console.log('File size:', Math.round(stats.size / 1024 / 1024), 'MB');
  
  // The original image is very large (533MB), so coordinates should be much larger
  console.log('Your image is very large. The coordinates should probably be scaled up significantly.');
  console.log('For a ~10000x30000 pixel image, try coordinates in the thousands range.');
});