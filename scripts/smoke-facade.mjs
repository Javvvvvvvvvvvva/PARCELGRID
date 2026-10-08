// Run after pnpm build. Installs no browser or external data; see docs/KR-FACADE-QUANTITIES.md.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output=path.join(root,'test-results/facade');
const password=randomBytes(24).toString('base64url');
const require=createRequire(path.join(root,'package.json'));
const browserOptions={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
if(process.env.PARCELGRID_CHROMIUM_PATH) browserOptions.executablePath=process.env.PARCELGRID_CHROMIUM_PATH;
if(process.env.PARCELGRID_CHROMIUM_MODULE) {
  const {default:binary}=await import(process.env.PARCELGRID_CHROMIUM_MODULE);
  browserOptions.args=binary.args;
}
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3100'],{cwd:root,env:{...process.env,SITE_ACCESS_PASSWORD:password,VWORLD_ENABLED:'false',KAKAO_REST_API_KEY:'',VWORLD_API_KEY:'',MOLIT_SERVICE_KEY:'',OPENAI_API_KEY:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
let serverLog=''; server.stdout.on('data',v=>serverLog+=v);server.stderr.on('data',v=>serverLog+=v);
let browser;
try {
  for(let i=0;i<100;i++) {try{await fetch('http://127.0.0.1:3100/access',{signal:AbortSignal.timeout(3000)});break;}catch{if(i===99||server.exitCode!==null)throw new Error('Server unavailable '+serverLog);await new Promise(r=>setTimeout(r,300));}}
  browser=await chromium.launch(browserOptions);
  const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const login=await context.request.post('http://127.0.0.1:3100/api/access/login',{data:{password}});
  if(login.status()!==200)throw new Error('Login failed '+login.status());
  const page=await context.newPage();const errors=[];const failed=[];
  page.on('console',m=>{if(m.type()==='error'&&/THREE|WebGL|shader/i.test(m.text()))errors.push({message:m.text()});});
  page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
  page.on('requestfailed',r=>{if(r.url().startsWith('http://127.0.0.1'))failed.push(r.url()+': '+r.failure()?.errorText);});
  await page.goto('http://127.0.0.1:3100/projects/1132010500102810023/envelope',{waitUntil:'domcontentloaded',timeout:60000});
  console.log('Opened demo planning workspace.');
  await page.getByLabel('주 외장재',{exact:true}).selectOption('brick-veneer');
  await page.getByLabel('주 외장재 비율',{exact:false}).fill('100');
  const editor=page.getByRole('region',{name:'면별 외장재 설정',exact:true});
  await editor.getByText('면별 재료·개구부·공유벽 설정',{exact:true}).click();
  await editor.getByLabel('면 재료',{exact:true}).selectOption('metal-panel');
  await editor.getByLabel('개구부 면적 (㎡)',{exact:true}).fill('1');
  await editor.getByLabel('단가 적용 방식',{exact:true}).selectOption('by-material');
  for(const material of ['치장벽돌','금속패널']) {
    await editor.getByText(material+' 단가·견적 근거',{exact:true}).click();
    await editor.getByLabel(material+' 기준 단가 (원/㎡)',{exact:true}).fill('100000');
    await editor.getByLabel(material+' 선택 단가 (원/㎡)',{exact:true}).fill('150000');
    await editor.getByLabel(material+' 출처명',{exact:true}).fill('자동 검증용 가상 견적');
    await editor.getByLabel(material+' 기준일',{exact:true}).fill('2026-10-08');
    await editor.getByLabel(material+' 포함·제외 범위',{exact:true}).fill('가상 데이터 · 실거래 견적 아님');
  }
  console.log('Material and face edits entered.');
  await page.getByText('이 브라우저에 저장됨',{exact:true}).waitFor();
  await fs.mkdir(output,{recursive:true});
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Plan DNA JSON 다운로드',exact:true}).click();
  const file=path.join(output,'plan-dna.json'); await (await download).saveAs(file);
  const dna=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(dna.facadeCost.areaBasis,'geometry-derived');
  assert.equal(dna.facadeCost.pricingMode,'by-material');
  assert.equal(dna.facadeCost.quantities.faces.filter(f=>f.material==='metal-panel').length,1);
  assert.equal(dna.facadeCost.quantities.faces.find(f=>f.material==='metal-panel').openingAreaSqm,1);
  assert.equal(dna.facadeCost.priced,true);
  assert.ok(Math.abs(dna.facadeCost.rows.reduce((n,r)=>n+r.areaSqm,0)-dna.facadeCost.facadeAreaSqm)<1e-7);
  assert.ok(Math.abs(dna.facadeCost.adjustmentManwon-dna.facadeCost.facadeAreaSqm*5)<1e-7);
  console.log('Quantity and cost export reconciled.');
  while (await editor.locator('details[open]').count()) await editor.locator('details[open] > summary').first().click();
  await editor.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  await editor.screenshot({path:path.join(output,'facade-editor.png')});
  const canvas=page.locator('.planning-massing-layout canvas').first(); if(await canvas.count()) { await canvas.scrollIntoViewIfNeeded(); await canvas.hover(); for(let i=0;i<16;i++){ await page.mouse.wheel(0,-100); await page.waitForTimeout(30); } await page.mouse.move(10,10); await page.waitForTimeout(2000); await canvas.screenshot({path:path.join(output,'facade-3d.png')}); const box=await canvas.boundingBox(); assert.ok(box); await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down(); await page.mouse.move(box.x+box.width/2+180,box.y+box.height/2,{steps:12}); await page.mouse.up(); await page.mouse.move(10,10); await page.waitForTimeout(700); await canvas.screenshot({path:path.join(output,'facade-3d-opposite.png')}); }
  await page.reload({waitUntil:'domcontentloaded'});
  const restored=page.getByRole('region',{name:'면별 외장재 설정',exact:true});
  await restored.getByText('면별 재료·개구부·공유벽 설정',{exact:true}).click();
  assert.equal(await restored.getByLabel('면 재료',{exact:true}).inputValue(),'metal-panel');
  assert.equal(await restored.getByLabel('개구부 면적 (㎡)',{exact:true}).inputValue(),'1');
  assert.equal(await restored.getByLabel('단가 적용 방식',{exact:true}).inputValue(),'by-material');
  const again=page.waitForEvent('download'); await page.getByRole('button',{name:'Plan DNA JSON 다운로드',exact:true}).click();
  await (await again).saveAs(path.join(output,'reloaded.json'));
  const after=JSON.parse(await fs.readFile(path.join(output,'reloaded.json'),'utf8'));
  assert.equal(after.facadeCost.costKey,dna.facadeCost.costKey);
  assert.equal(after.facadeCost.quantities.geometryHash,dna.facadeCost.quantities.geometryHash);
  await page.setViewportSize({width:390,height:844});
  await restored.getByText('면별 재료·개구부·공유벽 설정',{exact:true}).click();
  await restored.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  await restored.screenshot({path:path.join(output,'facade-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({quantityKey:dna.facadeCost.quantities.quantityKey,costKey:dna.facadeCost.costKey,area:dna.facadeCost.facadeAreaSqm,adjustment:dna.facadeCost.adjustmentManwon,pageErrors:errors.length,persistence:'passed',mobile:'passed'}));
} catch(error) { console.error(error); if(browser) { const pages=browser.contexts()[0]?.pages(); if(pages?.[0]) { await fs.mkdir(output,{recursive:true}); await pages[0].screenshot({path:path.join(output,'failure.png'),fullPage:true}); console.error((await pages[0].locator('body').innerText()).slice(-16000)); } } process.exitCode=1; }
finally { await browser?.close(); server.kill('SIGTERM'); }
