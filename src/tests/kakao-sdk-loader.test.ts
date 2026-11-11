import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();vi.resetModules();});
it('waits for constructors when the SDK namespace exists but is not initialized',async()=>{
 let complete:()=>void=()=>{};
 const maps:{load:(cb:()=>void)=>void;LatLng?:()=>void;Map?:()=>void}={load:vi.fn(cb=>{complete=cb;})};
 vi.stubGlobal('window',{kakao:{maps}});
 const {loadKakaoSdk}=await import('@/components/ui/KakaoMap');
 let settled=false;const first=loadKakaoSdk();void first.then(()=>{settled=true;});
 const second=loadKakaoSdk();expect(second).toBe(first);await Promise.resolve();expect(settled).toBe(false);
 maps.LatLng=()=>{};maps.Map=()=>{};complete();await first;expect(settled).toBe(true);expect(maps.load).toHaveBeenCalledTimes(1);
});
it('finishes with a safe error if initialization never completes',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',{kakao:{maps:{load:()=>{}}}});
 const {loadKakaoSdk}=await import('@/components/ui/KakaoMap');
 const pending=expect(loadKakaoSdk()).rejects.toThrow('초기화 시간 초과');
 await vi.advanceTimersByTimeAsync(15000);await pending;
});
it('accepts an already initialized SDK without adding another script',async()=>{
 const load=vi.fn();vi.stubGlobal('window',{kakao:{maps:{load,LatLng:()=>{},Map:()=>{}}}});
 const {loadKakaoSdk}=await import('@/components/ui/KakaoMap');await loadKakaoSdk();expect(load).not.toHaveBeenCalled();
});
