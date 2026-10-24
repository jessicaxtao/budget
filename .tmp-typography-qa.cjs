const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const out = path.join(app.getPath('temp'), 'canopy-typography-fonts');
app.setPath('userData', path.join(out, 'render-profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1280,height:1200,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadFile(path.join(__dirname, 'docs/typography-review.html'));
  await win.webContents.executeJavaScript('document.fonts.ready');
  const inspect = () => win.webContents.executeJavaScript(`(() => {
    const app = document.getElementById('proposed-app');
    const overflows = [...document.querySelectorAll('.stat-value, .preview-label, .ledger, .choice, .font-specimen')].filter(el => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 2).map(el => ({text:el.textContent.trim().slice(0,65),width:el.clientWidth,scroll:el.scrollWidth}));
    return {width:innerWidth, pageWidth:document.documentElement.scrollWidth, status:document.getElementById('font-status').textContent, font:getComputedStyle(app).fontFamily, theme:document.documentElement.dataset.theme, overflows};
  })()`);
  const results = [];
  for (const family of ['Inter','DM Sans','Source Sans 3','Manrope']) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-font="${family}"]').click()`);
    results.push(await inspect());
  }
  await win.webContents.executeJavaScript(`document.querySelector('[data-font="Inter"]').click(); document.getElementById('comparison').scrollIntoView()`);
  fs.writeFileSync(path.join(out,'comparison-light.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('theme').click()`);
  results.push(await inspect());
  fs.writeFileSync(path.join(out,'comparison-dark.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('compare').click(); document.getElementById('phone').click()`);
  results.push(await win.webContents.executeJavaScript(`({single:document.getElementById('baseline').hidden,phone:document.getElementById('previews').classList.contains('phone'),previewWidth:document.getElementById('proposed-app').getBoundingClientRect().width})`));
  win.setContentSize(390,1100);
  await win.webContents.executeJavaScript(`document.getElementById('comparison').scrollIntoView()`);
  results.push(await inspect());
  fs.writeFileSync(path.join(out,'comparison-mobile.png'), (await win.webContents.capturePage()).toPNG());
  win.setContentSize(320,1000);
  results.push(await inspect());
  const digits = await win.webContents.executeJavaScript(`(() => {
    const results = {};
    const span = document.createElement('span');
    span.style.cssText = 'position:absolute;visibility:hidden;font-size:24px;font-variant-numeric:tabular-nums;white-space:pre';
    document.body.append(span);
    for(const family of ['Inter','DM Sans','Source Sans 3','Manrope']) {
      span.style.fontFamily = '"' + family + '"';
      span.textContent = '11111111'; const a = span.getBoundingClientRect().width;
      span.textContent = '88888888'; const b = span.getBoundingClientRect().width;
      results[family] = {ones:a,eights:b,equal:Math.abs(a-b)<.1};
    }
    span.remove(); return results;
  })()`);
  fs.writeFileSync(path.join(out,'checks.json'), JSON.stringify({results,digits},null,2));
  console.log(JSON.stringify({results,digits,out},null,2));
  app.quit();
}).catch(error => {console.error(error);app.exit(1);});
