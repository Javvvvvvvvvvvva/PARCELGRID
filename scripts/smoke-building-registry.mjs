// Synthetic UI evidence only; no official parcel response or API key is used. See docs/KR-BUILDING-EVIDENCE.md.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output=path.join(root,'test-results/building-registry');
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
  for(let i=0;i<100;i++) {try{await fetch('http://127.0.0.1:3100/access',{signal:AbortSignal.timeout(3000)});break;}catch{if(i===99)throw new Error('Server unavailable '+serverLog);await new Promise(r=>setTimeout(r,300));}}
  browser=await chromium.launch(browserOptions);
  const context=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  const login=await context.request.post('http://127.0.0.1:3100/api/access/login',{data:{password}});
  if(login.status()!==200)throw new Error('Login failed '+login.status());
  const page=await context.newPage();const errors=[];const failed=[];
  page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
  page.on('requestfailed',r=>{if(r.url().startsWith('http://127.0.0.1'))failed.push(r.url()+': '+r.failure()?.errorText);});
  const projectId='1132010500102810023';
  const query={sigunguCd:'11320',bjdongCd:'10500',platGbCd:'0',bun:'0281',ji:'0023'};
  const titleFields={...query,mgmBldrgstPk:'SYNTHETIC-TITLE',rnum:'1',crtnDay:'20260901',bldNm:'검증용 합성 건물',dongNm:'A동',totArea:'200.3'};
  const record=fields=>({registryPk:fields.mgmBldrgstPk,rowNumber:fields.rnum,generatedDate:fields.crtnDay,fields});
  const dataset=(operation,fields)=>({operation,status:'complete',retrievedAt:'2026-09-28T00:00:00.000Z',requestUrl:`https://apis.data.go.kr/1613000/BldRgstHubService/${operation}?${new URLSearchParams(query)}`,totalCount:fields.length,fetchedCount:fields.length,pagesFetched:1,issues:[],rows:fields.map(record)});
  const registry={version:'building-registry-2026.1',sourceUrl:'https://www.data.go.kr/data/15134735/openapi.do',query,
    title:dataset('getBrTitleInfo',[titleFields]),
    floors:dataset('getBrFlrOulnInfo',[
      {...titleFields,rnum:'1',flrGbCdNm:'지상',flrNoNm:'1층',mainPurpsCdNm:'공동주택',area:'100.1',areaExctYn:'N'},
      {...titleFields,rnum:'2',flrGbCdNm:'지상',flrNoNm:'2층',mainPurpsCdNm:'공동주택',area:'100.2',areaExctYn:'N'},
    ]),exclusiveCommon:dataset('getBrExposPubuseAreaInfo',[
      {...titleFields,mgmBldrgstPk:'SYNTHETIC-UNIT',rnum:'1',hoNm:'101',area:'40.1',exposPubuseGbCd:'1',exposPubuseGbCdNm:'전유'},
      {...titleFields,mgmBldrgstPk:'SYNTHETIC-UNIT',rnum:'2',hoNm:'101',area:'5.2',exposPubuseGbCd:'2',exposPubuseGbCdNm:'공용'},
    ])};
  let mode='complete';
  await page.route(`**/api/projects/${projectId}`, async route=>{
    const response=await route.fetch();const data=await response.json();
    const evidence=structuredClone(registry);
    const current={registry:evidence,source:'building-registry',hasBuilding:true,totalBuildingArea:200.3,
      oldestApprovalDate:'2000-01-01',maxAgeYears:26,averageAgeYears:26,redevelopmentSignal:'renovate',signalLabel:'합성 테스트 건물',signalReasoning:'공식 관측값이 아닌 브라우저 검증 자료',
      buildings:[{registryId:'SYNTHETIC-TITLE',name:'검증용 합성 건물',mainPurpose:'공동주택',detailPurpose:'다세대주택',groundFloors:2,undergroundFloors:0,totalArea:200.3,buildingArea:60,buildingCoverage:50,floorAreaRatio:169,structure:'철근콘크리트',height:6,approvalDate:'2000-01-01',ageYears:26,isMainBuilding:true,householdCount:4,familyCount:0,unitCount:0,parkingCount:2,passengerElevators:0,emergencyElevators:0,roof:'평지붕'}]};
    if(mode==='zero'||mode==='error'){
      current.hasBuilding=false;current.buildings=[];current.totalBuildingArea=0;
      evidence.title={...evidence.title,rows:[],fetchedCount:0,totalCount:mode==='zero'?0:null,pagesFetched:mode==='zero'?1:0,status:mode==='zero'?'complete':'unavailable',issues:mode==='zero'?[]:['access-denied']};
      evidence.floors={...evidence.floors,status:'not-requested',rows:[],totalCount:null,fetchedCount:0,pagesFetched:0};
      evidence.exclusiveCommon={...evidence.exclusiveCommon,status:'not-requested',rows:[],totalCount:null,fetchedCount:0,pagesFetched:0};
      current.redevelopmentSignal=mode==='zero'?'vacant':'unknown';
    }
    if(mode==='partial') {evidence.floors.status='partial';evidence.floors.issues=['page-limit'];evidence.floors.totalCount=5;}
    if(mode==='old-tax') for(const scenario of data.scenarios) delete scenario.taxModelVersion;
    data.parcel.currentBuilding=current;
    await route.fulfill({response,json:data});
  });
  await page.goto(`http://127.0.0.1:3100/projects/${projectId}/status`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('button',{name:'상세 현황과 근거 보기 +',exact:false}).click();
  const panel=page.getByRole('region',{name:'건축물대장 조회 근거'});
  await panel.getByText('기존 건물 속성 확보',{exact:true}).waitFor({timeout:20000});
  await panel.locator('summary').filter({hasText:'층별개요'}).click();
  await panel.locator('summary').filter({hasText:'전유·공용'}).click();
  assert.match(await panel.innerText(),/차이 0㎡/);
  assert.match(await panel.innerText(),/전유 40.1㎡ · 공용 5.2㎡/);
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'대장 근거 JSON 저장'}).click();
  await fs.mkdir(output,{recursive:true});const downloadPath=path.join(output,'building-evidence.json');await (await download).saveAs(downloadPath);
  const saved=JSON.parse(await fs.readFile(downloadPath,'utf8'));
  assert.equal(saved.registry.exclusiveCommon.rows[0].registryPk,'SYNTHETIC-UNIT');
  assert.ok(!JSON.stringify(saved).includes('serviceKey'));
  await panel.screenshot({path:path.join(output,'evidence-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await panel.screenshot({path:path.join(output,'evidence-mobile.png')});
  assert.ok(await panel.evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth));
  await page.setViewportSize({width:1440,height:1100});
  await page.goto(`http://127.0.0.1:3100/projects/${projectId}/report`,{waitUntil:'domcontentloaded'});
  await panel.getByText('기존 건물 속성 확보',{exact:true}).waitFor({timeout:20000});
  assert.match(await panel.innerText(),/SYNTHETIC-UNIT/);
  await page.emulateMedia({media:'print'});
  await panel.screenshot({path:path.join(output,'evidence-print.png')});
  await page.emulateMedia({media:'screen'});
  mode='old-tax';await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('세금 근거 기준 변경 · Stage 3 재저장 필요',{exact:true}).waitFor();
  for(const next of ['partial','zero','error']) {
    mode=next;
    await page.goto(`http://127.0.0.1:3100/projects/${projectId}/status`,{waitUntil:'domcontentloaded'});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'상세 현황과 근거 보기 +',exact:false}).click();
    if(mode==='partial') {
      await panel.locator('summary').filter({hasText:'층별개요'}).click();
      await panel.getByText(/최대 10페이지 도달/).waitFor();
      assert.match(await panel.innerText(),/대조 미완료/);
    } else {
      await panel.getByText(mode==='zero'?'조회 범위 내 표제부 0건 · 현장 미확인':'대장 조회 미확인 · 건물 유무 확인 필요',{exact:true}).waitFor();
      assert.ok(!(await panel.innerText()).includes('즉시 신축'));
    }
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: synthetic title/floor/unit evidence, area comparison, JSON export, mobile, print, partial/zero/error states.');
} finally {if(browser)await browser.close();server.kill('SIGTERM');console.log('SERVER',serverLog.slice(-2000));}
