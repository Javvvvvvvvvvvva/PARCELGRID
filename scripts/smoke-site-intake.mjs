// Browser contract tests with synthetic parcel responses and an explicit Kakao SDK test double.
// This does not validate provider credentials, cadastral coverage, or real map tiles.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'package.json'));
const output=path.join(root,'test-results/site-intake');
const password=randomBytes(24).toString('base64url');
const launch={headless:true,args:['--no-sandbox','--disable-dev-shm-usage']};
if(process.env.PARCELGRID_CHROMIUM_PATH) launch.executablePath=process.env.PARCELGRID_CHROMIUM_PATH;
if(process.env.PARCELGRID_CHROMIUM_MODULE) {const {default:binary}=await import(process.env.PARCELGRID_CHROMIUM_MODULE);launch.args=binary.args;}
const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3100'],{cwd:root,env:{...process.env,SITE_ACCESS_PASSWORD:password,VWORLD_ENABLED:'false',KAKAO_REST_API_KEY:'',VWORLD_API_KEY:'',MOLIT_SERVICE_KEY:'',OPENAI_API_KEY:'',DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);
let browser;
try {
  for(let i=0;i<100;i++){try{await fetch('http://127.0.0.1:3100/access',{signal:AbortSignal.timeout(3000)});break;}catch{if(i===99)throw new Error(logs);await new Promise(r=>setTimeout(r,300));}}
  browser=await chromium.launch(launch);
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  assert.equal((await context.request.post('http://127.0.0.1:3100/api/access/login',{data:{password}})).status(),200);
  const projectId='1132010500102810023';
  const seedPage=await context.newPage();
  const seedResponse=await seedPage.goto(`http://127.0.0.1:3100/api/projects/${projectId}`);
  const seed=await seedResponse.json();await seedPage.close();
  assert.ok(seed.parcel?.lotArea,'seed fixture unavailable: '+JSON.stringify(seed));
  await context.addInitScript(() => {
    const listeners=new WeakMap();
    class LatLng {constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
    class Bounds {constructor(){this.points=[];}extend(p){this.points.push(p);}}
    class MapDouble {
      constructor(el,options){this.el=el;this.center=options.center;this.level=options.level;window.__map=this;window.__mapCount=(window.__mapCount||0)+1;
        el.innerHTML='<div data-map-double="true" style="position:absolute;inset:0;background-color:#e4ebdf;background-image:linear-gradient(32deg,transparent 46%,#fafaf4 46%,#fafaf4 50%,transparent 50%),linear-gradient(104deg,transparent 47%,#f8f9f2 47%,#f8f9f2 51%,transparent 51%),repeating-linear-gradient(90deg,#b7c9b033 0px,#b7c9b033 1px,transparent 1px,transparent 80px)"><span style="position:absolute;bottom:8px;left:10px;font:11px sans-serif;color:#506446">합성 지도 · 브라우저 동작 검증용</span></div>';
        this.surface=el.firstElementChild;
        el.addEventListener('pointerdown',e=>{this.start=[e.clientX,e.clientY];this.dragged=false;});
        el.addEventListener('pointerup',e=>{if(this.start&&Math.hypot(e.clientX-this.start[0],e.clientY-this.start[1])>8){this.dragged=true;this.center=new LatLng(this.center.lat+.001,this.center.lng+.001);}});
        el.addEventListener('wheel',e=>{e.preventDefault();this.level=Math.max(1,Math.min(14,this.level+(e.deltaY>0?1:-1)));},{passive:false});
        el.addEventListener('click',()=>{if(this.dragged)return;for(const fn of listeners.get(this)?.click??[])fn({latLng:new LatLng(37.650511,127.025749)});});
      }
      getCenter(){return this.center;}setCenter(p){this.center=p;}getLevel(){return this.level;}setLevel(v){this.level=v;}setMapTypeId(v){this.type=v;}relayout(){}
      setBounds(bounds){if(bounds.points.length)this.center=bounds.points[0];this.level=2;}
    }
    class Marker {setPosition(p){this.position=p;}setMap(m){this.map=m;}}
    class Polygon {
      constructor(options){this.options=options;this.setMap(options.map);}
      setMap(map){this.el?.remove();if(!map)return;this.el=document.createElement('div');this.el.setAttribute('data-test-boundary','true');this.el.style.cssText='position:absolute;left:43%;top:37%;width:120px;height:145px;border:3px solid #205b50;background:#4f9c7f38;transform:rotate(12deg);pointer-events:none';map.el.appendChild(this.el);}
    }
    class Overlay {constructor(options){this.options=options;}setMap(){}open(){}close(){}}
    window.kakao={maps:{Map:MapDouble,LatLng,LatLngBounds:Bounds,Marker,Polygon,Polyline:Overlay,CustomOverlay:Overlay,InfoWindow:Overlay,MapTypeId:{ROADMAP:1,HYBRID:3},load:fn=>fn(),event:{addListener:(obj,name,fn)=>{const all=listeners.get(obj)??{};(all[name]??=[]).push(fn);listeners.set(obj,all);},removeListener:(obj,name,fn)=>{const all=listeners.get(obj);if(all)all[name]=(all[name]??[]).filter(x=>x!==fn);}}}};
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let selections=0,details=0,financial=0,market=0,wrongDemo=0,lastLocation=null,lastFinancial=null,lookupMode='normal';
  const lookup={...seed.parcel,mode:'vworld',pnu:projectId,address:'서울 도봉구 쌍문동 281-23',addressRoad:null,bCode:'1132010500',lawdCd:'11320',sido:'서울',sigungu:'도봉구',dong:'쌍문동',jibun:'281-23',mainAddressNo:'281',subAddressNo:'23',mountainYn:'N',jimok:'대',jimokCode:'08',jimokCategory:'buildable',landPriceYear:'2026',existingUnitArea:null,
    lat:37.650511,lng:127.025749,inputProvenance:{mode:'vworld',parcelFacts:'vworld-cadastral',geometry:'vworld-cadastral',zoning:'vworld-land-use',recordedAt:'2026-09-28T00:00:00Z'},currentBuilding:null};
  lookup.boundary=lookup.boundary?.length?lookup.boundary:[[127.0256,37.6504],[127.0259,37.6504],[127.0259,37.6507],[127.0256,37.6507]];
  await page.route('**/api/parcels/address-suggest?*',route=>route.fulfill({json:{suggestions:[]}}));
  await page.route('**/api/parcels/lookup',async route=>{
    const input=route.request().postDataJSON();
    if(input.phase==='details')details++;else selections++;
    if(input.location)lastLocation=input.location;
    if(input.address==='느린 이전 주소') {await new Promise(r=>setTimeout(r,700));await route.fulfill({json:{...lookup,address:'이전 응답',currentBuilding:null}}).catch(()=>{});return;}
    if(input.address==='쌍문동') {await route.fulfill({json:{mode:'area',address:'서울 도봉구 쌍문동',lat:37.65,lng:127.03}});return;}
    if(lookupMode==='mismatch'){await route.fulfill({status:409,json:{code:'PARCEL_IDENTITY_MISMATCH',error:'클릭 위치와 필지 경계가 일치하지 않습니다.',nextAction:'필지 안쪽을 다시 선택하세요.'}});return;}
    if(lookupMode==='manual'){await route.fulfill({json:{...lookup,mode:'manual-required',reason:{code:'VWORLD_DISABLED',message:'토지 데이터 연결을 확인하지 못했습니다.'}}});return;}
    await route.fulfill({json:{...lookup,address:input.address||lookup.address,currentBuilding:input.phase==='details'?seed.parcel.currentBuilding:null}});
  });
  await page.route('**/api/parcels/estimate-price',route=>{market++;return route.fulfill({json:{transactions:[{priceManwon:120000,areaSqm:120,date:'2026-08-01',address:'합성 거래 참고'}]}});});
  await page.route('**/api/projects/dynamic',async route=>{
    financial++;lastFinancial=route.request().postDataJSON();
    await route.fulfill({json:{...seed,parcel:{...seed.parcel,...lastFinancial.parcel},meta:{...seed.meta,intakeRevision:lastFinancial.intakeRevision}}});
  });
  await page.route(`**/api/projects/${projectId}`,route=>{wrongDemo++;return route.fulfill({json:seed});});
  await page.route('**/api/parcels/nearby-stations?*',route=>route.fulfill({json:{stations:[]}}));
  await page.route('**/api/parcels/nearby-context*',route=>route.fulfill({json:{buildings:[],parcels:[]}}));
  await page.route('**/api/parcels/cadastral-context*',route=>route.fulfill({json:{parcels:[]}}));
  await page.goto('http://127.0.0.1:3100/',{waitUntil:'domcontentloaded'});
  const search=page.getByRole('combobox',{name:'주소 검색'});
  await search.waitFor();await page.getByRole('button',{name:'지도 확대',exact:true}).waitFor();
  assert.equal(await page.getByText('현재 알고 있는 부동산 총 취득대금').count(),0);
  const canvas=page.locator('.picker-map-canvas');
  const box=await canvas.boundingBox();
  await page.mouse.move(box.x+100,box.y+250);await page.mouse.down();await page.mouse.move(box.x+210,box.y+280,{steps:8});await page.mouse.up();
  assert.equal(selections,0,'panning must not fetch a parcel');
  await page.mouse.wheel(0,-200);assert.ok(await page.evaluate(()=>window.__map.getLevel())<7);
  await search.fill('쌍문동');await search.press('Enter');await page.getByText('검색한 지역에는 여러 필지가 있어요.',{exact:false}).waitFor();
  await canvas.click({position:{x:160,y:230}}); // zoom to parcel scale first
  await canvas.click({position:{x:160,y:230}});
  await page.getByRole('button',{name:'이 부지 살펴보기',exact:true}).waitFor();
  assert.deepEqual(lastLocation,{lat:37.650511,lng:127.025749});assert.equal(details,0);
  assert.equal(await page.evaluate(()=>window.__mapCount),1,'selecting a parcel must not reconstruct the map');
  await page.getByRole('button',{name:'위성 지도',exact:true}).click();assert.equal(await page.evaluate(()=>window.__map.type),3);
  await fs.mkdir(output,{recursive:true});await page.screenshot({path:path.join(output,'selection-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'이 부지 살펴보기',exact:true}).click();
  await page.getByRole('region',{name:'부지 현황 요약'}).waitFor();
  assert.equal(details,1);assert.equal(financial,0);assert.equal(market,0);assert.equal(wrongDemo,0,'an entered site sharing the demo PNU must retain its own input');
  let stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('parcelgrid:draft-parcel')));
  assert.equal(stored.acquiredPrice,null);assert.equal(stored.id,projectId);
  assert.equal(await page.getByRole('region',{name:'건축물대장 조회 근거'}).count(),0,'details are progressively disclosed');
  await page.screenshot({path:path.join(output,'status-summary.png'),fullPage:true});
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'부지 현황 요약'}).waitFor();assert.equal(financial,0);
  await page.getByRole('button',{name:'상세 현황과 근거 보기 +',exact:false}).click();
  await page.getByRole('region',{name:'건축물대장 조회 근거'}).waitFor();
  await page.getByRole('link',{name:'계획 검토하기 →',exact:true}).click();
  await page.getByLabel('토지와 기존 건물을 포함한 총 취득대금',{exact:true}).waitFor();assert.equal(financial,0);
  assert.equal(market,0);
  await page.getByRole('button',{name:'주변 거래 참고하기 +',exact:true}).click();
  await page.getByText('1건 수신',{exact:false}).waitFor();assert.equal(market,1);
  assert.equal(await page.getByLabel('토지와 기존 건물을 포함한 총 취득대금',{exact:true}).inputValue(),'','market references must not prefill acquisition');
  await page.getByLabel('토지와 기존 건물을 포함한 총 취득대금',{exact:true}).fill('12.3');
  const computation=page.waitForResponse(r=>r.url().endsWith('/api/projects/dynamic'));
  await page.getByRole('button',{name:'입력한 가격으로 계속'}).click();
  await computation;
  await page.getByRole('heading',{name:'계획안을 만들고 검증합니다',exact:true}).waitFor();
  assert.equal(lastFinancial.parcel.acquiredPrice,123000);assert.notEqual(lastFinancial.intakeRevision,stored.intakeRevision);assert.equal(wrongDemo,0);
  await page.goto('http://127.0.0.1:3100/projects/new',{waitUntil:'domcontentloaded'});
  lookup.lotArea=130;
  await search.fill('서울 도봉구 쌍문동 281-23');await search.press('Enter');
  await page.getByRole('button',{name:'이 부지 살펴보기',exact:true}).click();
  await page.getByRole('region',{name:'부지 현황 요약'}).waitFor();
  stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('parcelgrid:draft-parcel')));
  assert.equal(stored.acquiredPrice,null);assert.equal(financial,1);
  await page.getByRole('link',{name:'계획 검토하기 →',exact:true}).click();
  await page.getByLabel('토지와 기존 건물을 포함한 총 취득대금',{exact:true}).fill('13');
  const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/projects/dynamic'));
  await page.getByRole('button',{name:'입력한 가격으로 계속'}).click();await refreshed;
  assert.equal(financial,2);assert.equal(lastFinancial.parcel.lotArea,130);assert.equal(lastFinancial.parcel.acquiredPrice,130000);
  await page.goto('http://127.0.0.1:3100/projects/new',{waitUntil:'domcontentloaded'});
  await search.fill('느린 이전 주소');await search.press('Enter');
  await search.fill('서울 도봉구 쌍문동 281-24');await search.press('Enter');
  await page.getByRole('heading',{name:'서울 도봉구 쌍문동 281-24',exact:true}).waitFor();
  await page.waitForTimeout(850);assert.equal(await page.getByRole('heading',{name:'이전 응답',exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile viewport overflow');
  await page.screenshot({path:path.join(output,'selection-mobile.png'),fullPage:true});
  lookupMode='mismatch';await search.fill('경계 오류 검사');await search.press('Enter');await page.getByRole('alert').filter({hasText:'필지 경계'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'이 부지 살펴보기',exact:true}).count(),0);
  lookupMode='manual';await search.fill('수동 토지 검사');await search.press('Enter');await page.getByRole('button',{name:'토지 정보 직접 입력'}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'manual fallback overflow');
  await page.screenshot({path:path.join(output,'manual-mobile.png'),fullPage:true});
  lookupMode='normal';await search.fill('느린 이전 주소');await search.press('Enter');await page.getByRole('button',{name:'취소',exact:true}).click();await page.waitForTimeout(850);
  assert.equal(await page.getByRole('button',{name:'이 부지 살펴보기',exact:true}).count(),0);
  await page.goto('http://127.0.0.1:3100/projects/new',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='parcelgrid:draft-parcel')throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.call(this,k,v);};});
  await search.fill('저장 오류 검사');await search.press('Enter');await page.getByRole('button',{name:'이 부지 살펴보기',exact:true}).click();await page.getByRole('alert').filter({hasText:'저장하지 못했습니다'}).waitFor();
  assert.match(page.url(),/\/projects\/new$/);
  const fallback=await browser.newContext({viewport:{width:1440,height:1000},storageState:await context.storageState()});
  const fallbackPage=await fallback.newPage();await fallbackPage.route('https://dapi.kakao.com/**',route=>route.abort());
  await fallbackPage.goto('http://127.0.0.1:3100/projects/new');await fallbackPage.getByText('주소 검색으로 시작할 수 있어요',{exact:true}).waitFor({timeout:16000});
  assert.ok(await fallbackPage.getByRole('combobox',{name:'주소 검색'}).isEnabled());await fallbackPage.screenshot({path:path.join(output,'map-unavailable.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,selections,details,financial,market,wrongDemo,pageErrors:errors,scope:'Synthetic provider/SDK tests; live Kakao/VWorld credentials still require validation'}));
} catch(error){console.error(error);if(browser){for(const c of browser.contexts())for(const p of c.pages()){await fs.mkdir(output,{recursive:true});await p.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}}console.error(logs.slice(-1800));process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');}
