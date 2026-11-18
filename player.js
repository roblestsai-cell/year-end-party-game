import {config} from './config.js';
import {createExternalAdapter,validateConfig} from './adapter.js';
import {mountPlayerPage} from './player-page.mjs';
import {readInviteFromHash,readSavedRole} from './player-entry-contract.mjs';
const inviteCode=readInviteFromHash(location.hash);
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
function loadPinnedSdk() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); let settled = false;
    const finish = (error) => {
      if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener('pagehide', cancel);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(Object.assign(new Error('sdk_unavailable'), { code: 'sdk_unavailable' })); } else resolve();
    };
    const cancel = () => finish(true), timer = setTimeout(() => finish(true), 10000);
    window.addEventListener('pagehide', cancel, { once: true });
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
    script.integrity = 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
    script.crossOrigin = 'anonymous'; script.referrerPolicy = 'no-referrer';
    script.onload = () => finish(typeof globalThis.supabase?.createClient !== 'function');
    script.onerror = () => finish(true); document.head.appendChild(script);
  });
}

let page=null,adapter=null;
try {
 validateConfig(config);
 if(readSavedRole(sessionStorage,config)==='host')throw Object.assign(Error('host_session'),{code:'host_session'});
 await loadPinnedSdk();
 adapter=createExternalAdapter({config,createClient:globalThis.supabase.createClient,ledger:sessionStorage,consentStorage:sessionStorage,onChange:()=>page?.render()});
 page=mountPlayerPage({doc:document,adapter,inviteCode,getSavedRole:()=>readSavedRole(sessionStorage,config)});
 await page.start();
 document.addEventListener('visibilitychange',()=>page?.visibilityChanged());
 window.addEventListener('pagehide',()=>page?.stop());
 // Never resurrect an expired cached view or old option handlers.
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
} catch(e) {
 document.getElementById('error').textContent=e?.code==='host_session'?'本分頁已有主持人登入，請返回主持入口；改用另一分頁或手機加入。':e?.code==='sdk_unavailable'?'安全連線元件無法載入，已停止加入。':'設定或本分頁登入記錄無法確認，已停止連線。';
}
