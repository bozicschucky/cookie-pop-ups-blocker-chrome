const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

// Define paths
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const buildDir = path.join(distDir, 'build');
const packageName = 'cookie-popup-blocker.zip';

async function packageExtension() {
  try {
    console.log('Packaging extension...');

    // Ensure the build directory exists
    if (!fs.existsSync(buildDir)) {
      throw new Error('Build directory not found. Run build script first.');
    }

    // Create a new zip file
    const zip = new AdmZip();
    
    // Add the entire build directory to the zip
    zip.addLocalFolder(buildDir);
    
    // Write the zip file to the dist directory
    const outputPath = path.join(distDir, packageName);
    zip.writeZip(outputPath);

    console.log(`Extension packaged successfully: ${outputPath}`);
  } catch (err) {
    console.error('Packaging failed:', err);
    process.exit(1);
  }
}

// Run packaging
packageExtension();