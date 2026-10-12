// Personal build: the public app plus your private songs/ collection (no ads). `npm run dist:personal`
const base = require('../package.json').build;

module.exports = {
  ...base,
  files: [...base.files, 'songs/**'],
  artifactName: 'Piano-Tutor-Personal-${version}-${arch}.${ext}',
  nsis: { ...base.nsis, artifactName: 'Piano-Tutor-Personal-Setup-${version}.${ext}' },
};
