// Host-local MP3 playback. No file bytes, names, URLs, or media state enter an RPC.
// A selection is held only in this tab and must be selected again after reload.
const MAX_BYTES=64*1024*1024;
export const MAX_PLAYBACK_MS=30000;
export function mountHostAudio({adapter,onChange=()=>{},monotonic=()=>performance.now()}){
 const $=id=>document.getElementById(id);
 let key='',audio=null,url=null,serial=0,ready=false,played=false,finished=false,pending=false;
 let consumed=0,startedAt=null,cutoffTimer=null,message='請選擇本題 MP3。';
 const state=()=>adapter.getState();
 const hostQuestion=()=>{const v=state();return v.role==='host'&&v.snapshot?.host?v.snapshot:null;};
 const fresh=()=>{const v=state();return v.status==='connected'&&!v.busy&&!v.pending&&adapter.isFresh()&&!document.hidden;};
 const canSelect=()=>!!hostQuestion()&&['ready','listen'].includes(hostQuestion().phase)&&fresh();
 const canPlay=()=>!!audio&&ready&&hostQuestion()?.phase==='listen'&&fresh();
 const duration=()=>Number.isFinite(audio?.duration)?audio.duration:0;
 const clock=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
 const elapsed=()=>Math.min(MAX_PLAYBACK_MS,consumed+(startedAt===null?0:Math.max(0,monotonic()-startedAt)));
 function account(){consumed=elapsed();startedAt=null;clearTimeout(cutoffTimer);cutoffTimer=null;}
 function notify(){sync();onChange();}
 function stop(reset=false){serial++;pending=false;account();if(audio){audio.pause();if(reset&&audio.readyState>0)audio.currentTime=0;}}
 function finish(text){stop();finished=played&&ready;message=text;}
 function clear(){stop();if(audio){audio.removeAttribute('src');audio.load();audio.remove();audio=null;}if(url)URL.revokeObjectURL(url);url=null;ready=false;played=false;finished=false;pending=false;consumed=0;$('mp3File').value='';$('mp3FileName').textContent='尚未選擇 MP3';message='請選擇本題 MP3。';}
 function checkLimit(){if(audio&&startedAt!==null&&elapsed()>=MAX_PLAYBACK_MS){finish('已播放 30 秒，歌曲已自動停止。請主持人手動開始 15 秒作答。');return true;}return false;}
 function sync(){
  const s=hostQuestion(),next=s?JSON.stringify([s.epoch,s.host.questionId,s.host.source]):'';
  if(next!==key){clear();key=next;}
  if(!next&&audio)clear();
  checkLimit();
  if(audio&&!canPlay()&&(!audio.paused||pending)){stop();message=s?.phase==='listen'?'播放已暫停，連線恢復後請手動播放。':'歌曲已停止。';}
  $('mp3File').disabled=!canSelect();$('audioPlay').disabled=!canPlay()||pending||finished||!audio.paused;
  $('audioPause').disabled=!audio||audio.paused&&!pending;$('audioStop').disabled=!audio||!ready;
  $('audioReplay').disabled=!canPlay()||pending;$('audioSeek').disabled=!canPlay();
  $('audioSeek').max=String(duration());$('audioSeek').value=String(audio?.currentTime||0);
  $('audioTime').textContent=clock(audio?.currentTime||0)+' / '+clock(duration());
  $('audioRemaining').textContent='本次播放剩餘 '+Math.max(0,Math.ceil((MAX_PLAYBACK_MS-elapsed())/1000))+' 秒（上限 30 秒）';
  $('audioStatus').textContent=message;
 }
 function beginPlayback(a){
  if(audio!==a||!canPlay()||a.paused)return false;
  played=true;pending=false;finished=false;
  if(startedAt===null){startedAt=monotonic();cutoffTimer=setTimeout(()=>{if(audio===a&&checkLimit())notify();},Math.max(0,MAX_PLAYBACK_MS-consumed));}
  message='歌曲播放中，最多 30 秒。結束後請手動開始 15 秒作答。';return true;
 }
 function selected(){
  const file=$('mp3File').files?.[0];if(!file)return;
  if(!canSelect()){clear();message='目前無法選擇 MP3，請先確認連線與題目。';notify();return;}
  clear();
  if(!/\.mp3$/i.test(file.name)||file.type&&!['audio/mpeg','audio/mp3','audio/x-mp3','audio/x-mpeg','application/octet-stream'].includes(file.type)||!file.size||file.size>MAX_BYTES){message='請選擇有效的 MP3 檔案，大小上限 64 MB。';notify();return;}
  $('mp3FileName').textContent=file.name;message='正在讀取 MP3…';
  const a=document.createElement('audio');audio=a;a.preload='metadata';a.setAttribute('playsinline','');a.setAttribute('aria-label','主持人本題 MP3');
  // Player sessions never create an audio element; only a local blob URL is allowed by CSP.
  $('audioMount').append(a);url=URL.createObjectURL(file);a.src=url;
  a.addEventListener('loadedmetadata',()=>{if(audio!==a)return;ready=Number.isFinite(a.duration)&&a.duration>0;message=ready?'MP3 已準備。每次播放最多 30 秒，結束後由主持人手動開放作答。':'無法讀取 MP3 長度，請重新選擇。';notify();});
  a.addEventListener('playing',()=>{if(!beginPlayback(a)){a.pause();return;}notify();});
  a.addEventListener('play',()=>{if(audio!==a||!canPlay())a.pause();});
  a.addEventListener('pause',()=>{if(audio!==a||!a.paused)return;account();pending=false;notify();});
  a.addEventListener('ended',()=>{if(audio!==a||!a.ended)return;finish('歌曲播放完畢，請主持人手動開始 15 秒作答，或重新播放。');notify();});
  a.addEventListener('error',()=>{if(audio!==a)return;stop();ready=false;played=false;finished=false;message='無法播放這個 MP3。請檢查檔案是否完整，或選擇其他 MP3。';notify();});
  a.addEventListener('timeupdate',sync);a.load();notify();
 }
 async function play(restart=false){
  if(!canPlay()||pending||finished&&!restart)return;const a=audio;
  if(restart){stop();consumed=0;played=false;finished=false;a.currentTime=0;}
  const ticket=++serial;pending=true;message='正在開始播放…';notify();
  try{await a.play();if(audio!==a||!canPlay()){a.pause();return;}if(ticket!==serial)return;pending=false;beginPlayback(a);notify();}
  catch(e){if(ticket!==serial||audio!==a)return;pending=false;account();message=e.name==='NotAllowedError'?'瀏覽器阻擋播放，請再按一次「播放歌曲」。':'播放未成功，請確認 MP3 檔案或重新按播放。';notify();}
 }
 $('mp3File').addEventListener('change',selected);
 $('audioPlay').onclick=()=>play();$('audioReplay').onclick=()=>play(true);
 $('audioPause').onclick=()=>{stop();message='歌曲已暫停，繼續播放會沿用本次剩餘秒數。';notify();};
 $('audioStop').onclick=()=>{finish('歌曲已手動停止，可開始 15 秒作答或重新播放。');if(audio?.readyState>0)audio.currentTime=0;notify();};
 $('audioSeek').oninput=()=>{if(canPlay()){audio.currentTime=Math.min(duration(),Math.max(0,Number($('audioSeek').value)||0));sync();}};
 const pauseHidden=()=>{if(document.hidden&&audio){stop();message='切換分頁後已暫停。回到本頁後請手動播放，剩餘秒數不重設。';notify();}};
 document.addEventListener('visibilitychange',pauseHidden);window.addEventListener('pagehide',()=>{clear();key='';});
 return {sync,clear:()=>{clear();key='';sync();},canOpen:()=>canPlay()&&played&&finished&&audio.paused&&!pending,
  prepareAnswer:()=>{if(!canPlay()||!played||!finished||!audio.paused||pending)return false;stop();message='歌曲已停止，正在開放 15 秒作答。';sync();return audio.paused;}};
}
