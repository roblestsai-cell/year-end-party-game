import {safeSourceUrl} from './host-contract.js';

// An external tab cannot be observed or stopped by this page. These controls record
// only a host's local, current-question attestation, never verified media playback.
// No media, source metadata, or local confirmation state enters a network request.
export function mountHostExternalPlayback({adapter,onChange=()=>{}}){
 const $=id=>document.getElementById(id);
 let key='',confirmed=null,message='請先按「準備本題歌曲」，再開啟外部歌曲頁面。';
 const current=()=>{const v=adapter.getState(),s=v.snapshot;return v.role==='host'&&s?.host&&safeSourceUrl(s.host.source?.url)?s:null;};
 const identity=s=>s?JSON.stringify([s.epoch,s.revision,s.host.questionId,s.index,s.host.source.url]):'';
 const fresh=()=>{const v=adapter.getState();return v.status==='connected'&&!v.busy&&!v.pending&&adapter.isFresh()&&!document.hidden;};
 const enabled=()=>current()?.phase==='listen'&&fresh();
 function reset(){confirmed=null;message='外部頁面可能洩題；請自行確認播放，並在外部頁面手動停止歌曲。';}
 function sync(){
  const s=current(),next=identity(s);
  if(next!==key){key=next;reset();}
  if(!s||s.phase!=='listen'||!fresh())confirmed=null;
  const link=$('externalSource'),allowed=enabled();
  // Only the URL goes into href. Never place prompt/title/performer/version in DOM,
  // title, aria labels, link text, dataset, status, or error messages.
  link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';
  link.textContent='開啟本題外部歌曲頁面';link.setAttribute('aria-label','開啟本題外部歌曲頁面（新分頁）');
  link.setAttribute('aria-disabled',String(!allowed));link.tabIndex=allowed?0:-1;
  if(allowed)link.href=s.host.source.url;else link.removeAttribute('href');
  $('externalStopped').disabled=!allowed;
  $('externalStopped').setAttribute('aria-pressed',String(confirmed===key&&!!key));
  $('externalStatus').textContent=!s?'目前沒有可播放的題目。':s.phase==='ready'?'請先按「準備本題歌曲」，再開啟外部歌曲頁面。':s.phase!=='listen'?'外部歌曲由主持人自行控制；本頁不會停止外部播放。':message;
 }
 function notify(){sync();onChange();}
 const useSource=event=>{
  sync();if(!enabled()){event.preventDefault();return;}
  confirmed=null;message='正在要求開啟外部頁面；本頁無法確認是否開啟或播放成功。請自行播放及手動停止，再回本頁確認。';notify();
  // Native anchor navigation keeps user activation. No popup or playback promise.
 };
 $('externalSource').onclick=useSource;
 $('externalSource').addEventListener('auxclick',useSource);
 // Opening in a background tab may not trigger visibilitychange. Right-click
 // menus can open or copy the source, so invalidate the attestation there too.
 const invalidateSource=event=>{
  sync();if(!enabled()){event.preventDefault();return;}
  reset();notify();
 };
 $('externalSource').addEventListener('contextmenu',invalidateSource);
 $('externalSource').addEventListener('dragstart',invalidateSource);
 $('externalStopped').onclick=()=>{
  sync();if(!enabled())return;
  confirmed=key;message='你已確認本題歌曲已播放並手動停止。本頁無法驗證外部播放；請再按「開始 15 秒作答」。';notify();
 };
 const clear=()=>{key='';reset();sync();};
 const restore=()=>{reset();notify();};
 document.addEventListener('visibilitychange',restore);
 window.addEventListener('pagehide',()=>{clear();onChange();});
 window.addEventListener('pageshow',restore);
 const canOpen=()=>{sync();return enabled()&&!!key&&confirmed===key;};
 const prepareAnswer=()=>{
  if(!canOpen())return false;
  // Consume before the adapter's synchronous epoch/revision/question fence. A
  // rejected or uncertain command never leaves a reusable local confirmation.
  confirmed=null;message='已記錄你的手動停止確認，正在要求伺服器開始 15 秒作答。';sync();return true;
 };
 sync();return Object.freeze({sync,clear,canOpen,prepareAnswer});
}
