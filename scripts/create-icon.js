const fs = require('fs');
const path = require('path');
const toIco = require('to-ico');

const buildDir = path.join(__dirname, '..', 'build');
const iconPath = path.join(buildDir, 'icon.png');
const icoPath = path.join(buildDir, 'icon.ico');

// Create build directory if it doesn't exist
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

async function createIcoFromPng() {
  try {
    if (fs.existsSync(iconPath)) {
      console.log('Converting icon.png to icon.ico for Windows...');
      const pngBuffer = fs.readFileSync(iconPath);
      // to-ico expects an array of buffers
      const icoBuffer = await toIco([pngBuffer], {
        sizes: [16, 24, 32, 48, 64, 128, 256]
      });
      fs.writeFileSync(icoPath, icoBuffer);
      console.log('✓ icon.ico created successfully at', icoPath);
    } else {
      console.log('⚠ icon.png not found at', iconPath);
    }
  } catch (err) {
    console.error('Error creating ICO:', err.message);
    console.log('Stack:', err.stack);
  }
}

createIcoFromPng();
