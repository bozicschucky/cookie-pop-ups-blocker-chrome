const fs = require('fs-extra');
const path = require('path');

// Define paths
const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const packageJsonPath = path.join(rootDir, 'package.json');

async function updateVersion() {
  try {
    console.log('Updating extension version...');

    // Read the current manifest and package.json
    const manifest = await fs.readJSON(manifestPath);
    const packageJson = await fs.readJSON(packageJsonPath);
    
    // Parse current version
    const currentVersion = manifest.version;
    console.log(`Current version: ${currentVersion}`);
    
    // Split into components
    const versionParts = currentVersion.split('.');
    const major = parseInt(versionParts[0]);
    const minor = parseInt(versionParts[1]);
    let patch = parseInt(versionParts[2]);
    
    // Increment patch version
    patch += 1;
    const newVersion = `${major}.${minor}.${patch}`;
    
    // Update manifest.json
    manifest.version = newVersion;
    await fs.writeJSON(manifestPath, manifest, { spaces: 2 });
    
    // Update package.json
    packageJson.version = newVersion;
    await fs.writeJSON(packageJsonPath, packageJson, { spaces: 2 });
    
    console.log(`Version updated to: ${newVersion}`);
    return newVersion;
  } catch (err) {
    console.error('Version update failed:', err);
    process.exit(1);
  }
}

// Run the version update
updateVersion();