const { execFileSync } = require('child_process');
const path = require('path');
const { productName } = require('../../package.json');

if (process.platform === 'darwin') {
  const electronPath = require('electron');
  const infoPlist = path.resolve(electronPath, '..', '..', 'Info.plist');

  ['CFBundleDisplayName', 'CFBundleName'].forEach((key) => {
    execFileSync('plutil', [
      '-replace',
      key,
      '-string',
      productName,
      infoPlist,
    ]);
  });
}
