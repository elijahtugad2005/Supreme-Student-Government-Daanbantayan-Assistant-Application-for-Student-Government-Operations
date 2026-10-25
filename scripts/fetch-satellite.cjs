const fs = require('fs');
const path = require('path');
const https = require('https');

const outDir = path.join(__dirname, '..', 'public', 'satellite');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const z = 18;
const xMin = 221371;
const xMax = 221373;
const yMin = 122813;
const yMax = 122815;

const downloadTile = (x, y) => {
  return new Promise((resolve, reject) => {
    const filename = 'tile-' + z + '-' + x + '-' + y + '.jpg';
    const filePath = path.join(outDir, filename);
    const file = fs.createWriteStream(filePath);
    const url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
    
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filePath);
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {});
      reject(err);
    });
  });
};

async function main() {
  const promises = [];
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      promises.push(downloadTile(x, y));
    }
  }
  const results = await Promise.all(promises);
  console.log('Successfully saved', results.length, 'tiles into:', outDir);
  results.forEach(r => {
    console.log(path.basename(r), fs.statSync(r).size, 'bytes');
  });
}

main().catch(console.error);
