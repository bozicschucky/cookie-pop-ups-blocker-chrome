const fs = require('fs-extra');
const path = require('path');

// Define paths
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const buildDir = path.join(distDir, 'build');

// Files and directories to copy
const filesToCopy = [
  'manifest.json',
  'readme.md',
  'src',
  'images'
];

async function build() {
  try {
    console.log('Building extension...');

    // Clean dist directory if it exists
    await fs.emptyDir(distDir);
    
    // Create build directory
    await fs.ensureDir(buildDir);

    // Copy all required files to build directory
    for (const file of filesToCopy) {
      const src = path.join(rootDir, file);
      const dest = path.join(buildDir, file);
      await fs.copy(src, dest);
      console.log(`Copied ${file} to build directory`);
    }

    // Create build info file with timestamp
    const buildInfo = {
      version: require('../package.json').version,
      buildDate: new Date().toISOString(),
      builtBy: 'GitHub Actions'
    };

    await fs.writeJSON(path.join(buildDir, 'build-info.json'), buildInfo, { spaces: 2 });

    console.log('Extension build complete!');
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

// Run build
build();