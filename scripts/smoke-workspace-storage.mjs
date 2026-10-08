// Real browser IndexedDB/React flow; synthetic project data, no external provider credentials.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { installKakaoMapDouble } from './helpers/kakao-map-double.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), output=path.join(root,'test-results/workspace-storage');
const require=createRequire(path.join(root,'package.json')), password=randomBytes(24).toString('base64url'), base='http://127.0.0.1:3102';
const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
if(process.env.PARCELGRID_CHROMIUM_PATH) launch.executablePath=process.env.PARCELGRID_CHROMIUM_PATH;
if(process.env.PARCELGRID_CHROMIUM_MODULE){const {default:binary}=await import(process.env.PARCELGRID_CHROMIUM_MODULE);launch.args=binary.args;}
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3102'],{cwd:root,env:{...process.env,SITE_ACCESS_PASSWORD:password,VWORLD_ENABLED:'false',KAKAO_REST_API_KEY:'',VWORLD_API_KEY:'',MOLIT_SERVICE_KEY:'',OPENAI_API_KEY:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
let logs='',browser;server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);
const errors=[];
function track(page){page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());return page;}
const rowInBrowser=async projectId=>new Promise((resolve,reject)=>{const request=indexedDB.open('parcelgrid-workspaces');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const read=db.transaction('projects').objectStore('projects').get(projectId);read.onsuccess=()=>{resolve(read.result);db.close();};read.onerror=()=>{reject(read.error);db.close();};};});
const saved=page=>page.getByText('이 브라우저에 저장됨',{exact:true}).waitFor();
async function download(page,label,file){const event=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const result=await event;const target=path.join(output,file);await result.saveAs(target);return JSON.parse(await fs.readFile(target,'utf8'));}
try{
  await fs.mkdir(output,{recursive:true});
  for(let n=0;n<100;n++){try{await fetch(`${base}/access`);break;}catch{if(n===99)throw new Error(logs);await new Promise(resolve=>setTimeout(resolve,300));}}
  browser=await chromium.launch(launch);const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  assert.equal((await context.request.post(`${base}/api/access/login`,{data:{password}})).status(),200);
  const projectId='1132010500102810023', seedPage=await context.newPage();
  const seed=await (await seedPage.goto(`${base}/api/projects/${projectId}`)).json();await seedPage.close();assert.ok(seed.parcel?.lotArea,JSON.stringify(seed));
  await context.addInitScript(installKakaoMapDouble);
  await context.route('**/api/projects/dynamic',route=>{const request=route.request().postDataJSON();return route.fulfill({json:{...seed,parcel:{...seed.parcel,...request.parcel},meta:{...seed.meta,intakeRevision:request.intakeRevision}}});});
  for(const route of ['**/api/parcels/nearby-stations?*','**/api/parcels/nearby-context*','**/api/parcels/cadastral-context*'])await context.route(route,r=>r.fulfill({json:{stations:[],buildings:[],parcels:[]}}));
  let page=track(await context.newPage());await page.goto(`${base}/projects/new`);await page.getByRole('combobox',{name:'주소 검색'}).waitFor();
  const intake={...seed.parcel,id:projectId,addressRoad:null,lawdCd:'11320',pnu:projectId,landPriceYear:'2026',acquired:'2026-10-08',acquiredPrice:123000,intakeRevision:'original-browser-fixture'};
  const document={schemaVersion:1,projectId,intake,payload:{projectData:null,envelopePlan:null,planningScenarios:[],selectedScenarioId:null,representativeScenarioId:null,representativeGeometry:null,draftAssumptions:{},draftAcquisitionPrice:null,financialSources:{},stage3Snapshot:null,priceVerifications:{},expertReviews:{}}};
  const data=JSON.stringify(document), backup=JSON.stringify({format:'parcelgrid-workspace-backup',version:1,data,sha256:createHash('sha256').update(data).digest('hex')});
  await page.getByLabel('프로젝트 백업 파일').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await page.getByRole('region',{name:'부지 현황 요약'}).waitFor();await saved(page);
  const imported=await page.evaluate(rowInBrowser,projectId);assert.notEqual(imported.intake.intakeRevision,intake.intakeRevision);assert.equal(imported.intake.acquiredPrice,123000);
  await page.getByRole('link',{name:'계획 검토하기 →',exact:true}).click();
  let name=page.getByRole('textbox',{name:'계획안 이름',exact:true});await name.waitFor({timeout:60000});await saved(page);
  await name.fill('브라우저에 보관할 계획');await saved(page);
  await page.getByRole('button',{name:'계획 변경 취소',exact:true}).click();assert.notEqual(await name.inputValue(),'브라우저에 보관할 계획');
  await page.getByRole('button',{name:'다시 적용',exact:true}).click();assert.equal(await name.inputValue(),'브라우저에 보관할 계획');await saved(page);
  await page.screenshot({path:path.join(output,'autosave-desktop.png'),fullPage:true});
  // Closing the only project tab loses sessionStorage. A fresh tab must use durable IndexedDB.
  await page.close();page=track(await context.newPage());await page.goto(`${base}/projects/new`);
  const item=page.locator('.saved-projects li').filter({hasText:intake.address});await item.getByRole('link',{name:'열기',exact:true}).click();
  await page.getByRole('region',{name:'부지 현황 요약'}).waitFor();await page.getByRole('link',{name:'계획 검토하기 →',exact:true}).click();
  name=page.getByRole('textbox',{name:'계획안 이름',exact:true});await name.waitFor({timeout:60000});assert.equal(await name.inputValue(),'브라우저에 보관할 계획');await saved(page);
  console.log('Import, undo/redo, tab-close recovery passed.');
  // A native IndexedDB failure must retain both the last commit and the visible unsaved edit.
  const before=await page.evaluate(rowInBrowser,projectId);
  await page.evaluate(()=>{window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='projects')throw new DOMException('Synthetic full disk','QuotaExceededError');return window.__put.apply(this,args);};});
  await name.fill('저장 실패 중에도 남길 계획');await page.getByText('저장하지 못함',{exact:true}).waitFor();
  assert.equal((await page.evaluate(rowInBrowser,projectId)).revision,before.revision);
  const failedBackup=await download(page,'현재 탭 백업','unsaved-backup.json');assert.equal(JSON.parse(failedBackup.data).payload.planningScenarios.find(plan=>plan.id===JSON.parse(failedBackup.data).payload.selectedScenarioId).name,'저장 실패 중에도 남길 계획');
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__put;});await page.getByRole('button',{name:'저장 다시 시도',exact:true}).click();await saved(page);
  console.log('Quota failure, unsaved export, retry passed.');
  const second=track(await context.newPage());await second.goto(`${base}/projects/${projectId}/envelope`);
  const secondName=second.getByRole('textbox',{name:'계획안 이름',exact:true});await secondName.waitFor({timeout:60000});await saved(second);
  await secondName.fill('다른 탭이 먼저 저장');await saved(second);
  await page.getByText('다른 탭과 충돌',{exact:true}).waitFor();assert.equal(await name.inputValue(),'저장 실패 중에도 남길 계획');
  await name.fill('충돌한 탭의 미저장 초안');
  const conflict=await download(page,'현재 탭 백업','conflict-backup.json');assert.ok(JSON.parse(conflict.data).payload.planningScenarios.some(plan=>plan.name==='충돌한 탭의 미저장 초안'));
  assert.ok((await page.evaluate(rowInBrowser,projectId)).payload.planningScenarios.some(plan=>plan.name==='다른 탭이 먼저 저장'));
  await page.screenshot({path:path.join(output,'conflict-desktop.png'),fullPage:true});
  await second.close();await page.getByRole('button',{name:'최신 저장본 열기',exact:true}).click();await name.waitFor();assert.equal(await name.inputValue(),'다른 탭이 먼저 저장');await saved(page);
  console.log('Two-tab conflict, local backup, explicit reload passed.');
  await page.getByRole('button',{name:'저장 기록',exact:true}).click();await page.locator('.workspace-history').waitFor();
  await page.locator('.workspace-history').getByRole('button',{name:'이 저장본 복구',exact:true}).first().click();await saved(page);await name.waitFor();
  const restored=await page.evaluate(rowInBrowser,projectId);assert.equal(restored.payload.representativeScenarioId,null);assert.equal(restored.payload.stage3Snapshot,null);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'storage toolbar mobile overflow');
  await page.screenshot({path:path.join(output,'recovery-mobile.png'),fullPage:true});
  await page.goto(`${base}/projects/new`);await page.locator('.saved-projects li').first().waitFor();
  const stable=await page.evaluate(rowInBrowser,projectId), corrupt=JSON.stringify({...JSON.parse(backup),sha256:'wrong'});
  await page.getByLabel('프로젝트 백업 파일').setInputFiles({name:'damaged.json',mimeType:'application/json',buffer:Buffer.from(corrupt)});
  await page.getByRole('alert').filter({hasText:'손상된 백업'}).waitFor();assert.equal((await page.evaluate(rowInBrowser,projectId)).revision,stable.revision);
  await page.screenshot({path:path.join(output,'library-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,checks:['import','undo-redo','tab-close-reopen','quota-rollback','unsaved-backup','retry','two-tab-conflict','history-restore','corrupt-backup','mobile'],pageErrors:errors}));
}catch(error){console.error(error);if(browser)for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error(logs.slice(-2000));process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');}
