/* eslint-disable @typescript-eslint/no-explicit-any -- Provider SDK has no bundled type declarations. */
declare global { interface Window { kakao: any } }
const SDK_ID = "kakao-map-sdk";
let pending: Promise<void> | undefined;

export function loadKakaoSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("지도를 표시할 브라우저가 필요합니다."));
  if (window.kakao?.maps?.Map) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    let script = document.getElementById(SDK_ID) as HTMLScriptElement | null;
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!script && !key && !window.kakao?.maps) { reject(new Error("지도 연결이 설정되지 않았습니다. 주소 검색은 계속 사용할 수 있습니다.")); return; }
    const timeout = setTimeout(() => fail(), 12_000);
    const cleanup = () => { clearTimeout(timeout); script?.removeEventListener("load", ready); script?.removeEventListener("error", fail); };
    const fail = () => { cleanup(); script?.remove(); reject(new Error("지도에 연결하지 못했습니다. 주소로 검색하거나 다시 시도하세요.")); };
    const ready = () => {
      if (!window.kakao?.maps?.load) { fail(); return; }
      window.kakao.maps.load(() => { if (!window.kakao.maps.Map) { fail(); return; } cleanup(); resolve(); });
    };
    if (window.kakao?.maps?.load) { ready(); return; }
    if (!script) {
      script = document.createElement("script"); script.id = SDK_ID;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key!)}&autoload=false`;
      script.async = true;
      script.addEventListener("load", ready); script.addEventListener("error", fail);
      document.head.appendChild(script);
    } else { script.addEventListener("load", ready); script.addEventListener("error", fail); }
  }).catch(error => { pending = undefined; throw error; });
  return pending;
}
