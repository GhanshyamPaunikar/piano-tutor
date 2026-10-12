// Takes the README screenshots from the real app: `npm run screenshots` writes docs/screenshots/*.png.
// Uses the public edition (starter songs, ads on) so the pictures match what people download.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function takeScreenshots(win, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const run = (js) => win.webContents.executeJavaScript(js);
  const shot = async (name) => {
    await wait(400);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
    console.log('saved', name, img.getSize());
  };

  await wait(3000);
  await shot('library.png');

  // Practice: notes falling onto the keys, both hands
  await run(`location.hash = '#/play/' + encodeURIComponent('c:minuet-in-g.mid')`);
  await wait(1500);
  await run(`(() => { document.querySelector('#modeSeg [data-v="watch"]').click(); keys.seek(3.2); keys.play(); })()`);
  await wait(1100);
  await run('keys.pause()');
  await shot('practice.png');

  // Sheet music above the falling notes
  await run(`(() => { document.querySelector('#sheetBtn').click(); keys.seek(6); keys.play(); })()`);
  await wait(900);
  await run(`(() => { keys.pause(); })()`);
  await shot('sheet-music.png');
  await run(`document.querySelector('#sheetBtn').click()`);

  // Free Play: a little tune played on the computer keyboard rises from the keys
  await run(`location.hash = '#/free'`);
  await wait(800);
  await run(`(async () => {
    const tune = [60, 64, 67, 72, 71, 67, 64, 62, 65, 69, 72, 74, 76];
    for (const m of tune) { keys.noteOn(m); await new Promise(r => setTimeout(r, 160)); keys.noteOff(m); }
    keys.noteOn(48); keys.noteOn(55); keys.noteOn(64);
  })()`);
  await wait(2600);
  await shot('free-play.png');
  await run('[48, 55, 64].forEach(keys.noteOff)');

  // MIDI devices and keyboard size
  await run(`location.hash = '#/devices'`);
  await wait(800);
  await shot('devices.png');

  // Remove ads
  await run(`location.hash = '#/library'`);
  await wait(800);
  // Show the dialog as buyers see it once the checkout link is configured
  await run(`import('./js/config.js').then((m) => { m.CONFIG.upgrade.checkoutUrl = 'https://example.com/checkout'; document.querySelector('#upgradeBtn').click(); })`);
  await wait(500);
  await shot('remove-ads.png');
};
