import {config} from './config.js';
import {createExternalAdapter,validateConfig} from './adapter.js';
import {mountHostConsole} from './host-console.js';
import {mountHostExternalPlayback} from './host-external.js';
import {createHostQuestionFlow} from './host-question-flow.js';
const $=id=>document.getElementById(id);
const rawInvite=new URLSearchParams(location.hash.slice(1)).get('join');
const inviteCode=typeof rawInvite==='string'&&rawInvite.trim()&&rawInvite.length<=256&&!/[\u0000-\u001f\u007f]/.test(rawInvite)?rawInvite:null;
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
$('invitationStatus').textContent=inviteCode?'活動邀請已載入，輸入姓名即可加入。':'請使用主持人提供的活動邀請連結，再輸入姓名加入。';
const messages={auth_refreshed_no_retry:'登入已更新，原操作未重送。請確認最新狀態後再操作。',saved_session_exists:'本分頁已有登入，請先恢復或清除，避免建立重複玩家。',configuration_required:'尚未設定經核實的 Supabase 公開設定，已停止連線。',sdk_unavailable:'無法載入官方 SDK，已停止連線。',authentication_failed:'登入未成功，請確認帳號資料或稍後再試。',join_input_required:'請填寫顯示名稱與加入碼。',join_rejected:'無法加入房間，請向主持人確認加入碼及活動狀態。',contract_mismatch:'後端回傳格式不符，已停止操作。',access_denied:'這個帳號沒有房間存取權。',backend_unavailable:'遊戲後端尚未可用，已停止操作。',session_expired:'登入已失效，請重新登入。',identity_changed:'登入身分已改變，請重新登入。',network_unknown:'連線結果尚未確定，請查詢原事件。',request_rejected:'伺服器拒絕此操作，請重新確認狀態。',stale_response:'回覆過慢，已暫停操作並等待最新狀態。',stale_auth_response:'登入狀態已更新，正在重新確認題目。',pending_storage_failed:'無法保存操作識別碼，已停止送出。',pending_storage_invalid:'操作記錄無法辨識，請聯絡主持人，勿重複送出。',receipt_mismatch:'事件回執不符，已保留待查狀態。',action_not_allowed:'目前無法執行此操作，請等待最新狀態。'};
const showError=e=>{if(e?.code!=='stale_session')$('error').textContent=messages[e?.code]||'操作未完成，請重新確認狀態。';};
messages.question_changed='題目已更新，已停止原本的下一題操作，請確認目前題目。';
messages.prize_input_required='請確認獎等、獎項內容、人數與名次範圍。';messages.prize_range_conflict='此獎等或名次範圍與其他獎項重疊。';messages.prize_draft_conflict='獎項已由其他操作更新。請載入最新設定後再編輯，草稿尚未送出。';
messages.host_login_unavailable='管理者登入服務尚未啟用或暫時無法使用，已停止登入。';messages.login_rate_limited='登入嘗試過於頻繁，請稍後再試。';messages.join_input_required='請使用有效的活動邀請連結，並填寫姓名。';

// The only external script is the pinned official npm UMD, checked by browser SRI.
// No invitation, credentials, or caller-supplied URLs enter this request.
function loadPinnedSdk(){
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;clearTimeout(timer);
      window.removeEventListener('pagehide',cancel);
      script.onload=script.onerror=null;
      if(error){script.remove();reject(Object.assign(new Error('sdk_unavailable'),{code:'sdk_unavailable'}));}
      else resolve();
    };
    const cancel=()=>finish(true),timer=setTimeout(()=>finish(true),10000);
    window.addEventListener('pagehide',cancel,{once:true});
    script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
    script.integrity='sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
    script.crossOrigin='anonymous';script.referrerPolicy='no-referrer';
    script.onload=()=>finish(typeof globalThis.supabase?.createClient!=='function');
    script.onerror=()=>finish(true);document.head.appendChild(script);
  });
}
messages.sdk_unavailable='安全連線元件無法載入或已逾時，已停止登入。請稍後重新開啟原本的活動邀請連結；請勿在其他頁面輸入密碼。';

let adapter,hostConsole,hostExternal,hostFlow,mode='player',questionKey='',pageGeneration=0;
function clearSecrets(){for(const id of ['password'])$(id).value='';}
function selectMode(next){if(adapter?.getState().busy)return;hostExternal?.clear();hostFlow?.resetReveal();mode=next;$('hostFields').hidden=mode!=='host';$('playerFields').hidden=mode!=='player';$('hostMode').setAttribute('aria-pressed',String(mode==='host'));$('playerMode').setAttribute('aria-pressed',String(mode==='player'));$('submitLogin').textContent=mode==='host'?'主持人登入':'加入活動';$('submitLogin').disabled=adapter?.getState().busy||adapter?.hasSavedSession()||mode==='player'&&!inviteCode;clearSecrets();}
$('hostMode').onclick=()=>selectMode('host');$('playerMode').onclick=()=>selectMode('player');
const phases={lobby:'等待活動開始',ready:'等待主持人準備本題歌曲',listen:'請聆聽主持人播放歌曲',answering:'請在 15 秒內作答',closed:'本題作答已截止',revealed:'本題已結算',tiebreak:'同分名次待決定',finished:'排名已確認，進入發獎'};
function render(v){
  const signed=!!v.role,s=v.snapshot;document.body.classList.toggle("player-session",v.role==="player");$("playerHelp").hidden=v.role!=="player";$('login').hidden=signed;$('session').hidden=!signed;
  const saved=adapter?.hasSavedSession();$('restore').hidden=signed||!saved;$('discardSaved').hidden=signed||!saved;$('restore').disabled=v.busy;$('discardSaved').disabled=v.busy;
  $('submitLogin').disabled=v.busy||saved||v.status==='verifying'||mode==='player'&&!inviteCode;$('playerMode').disabled=v.busy;$('hostMode').disabled=v.busy;$('cancelLogin').hidden=!['authenticating','verifying'].includes(v.status);
  if(v.error)showError({code:v.error});
  hostFlow?.sync();const hideReveal=!hostFlow||hostFlow.isRevealSuppressed(s);hostConsole?.render(hideReveal?{...v,snapshot:{...s,reveal:null}}:v);hostExternal?.sync();$('personalTotal').hidden=!(v.role==='player'&&s?.self?.score!==null&&s?.self?.score!==undefined);$('personalTotal').textContent=$('personalTotal').hidden?'':'你的最終總分：'+s.self.score+' 分';
  if(!s){$('choices').replaceChildren();$('sourcePanel').hidden=true;questionKey='';return;}
  $('connection').textContent=v.status==='connected'?'已取得伺服器最新狀態':'連線中斷，已暫停作答與主持操作';
  $('phase').textContent=phases[s.phase];$('progress').textContent=s.index?'第 '+s.index+' / '+s.roundCount+' 題':'';
  $('next').textContent=s.index===s.roundCount?'完成答題並結算':'下一題';
  $('actions').hidden=v.role!=='host';$('sourcePanel').hidden=v.role!=='host'||!s.host;
  const qk=v.role==='player'&&s.question?JSON.stringify([s.epoch,s.question.id,s.question.options]):'';
  if(qk!==questionKey){questionKey=qk;$('choices').replaceChildren();if(qk)for(const [i,label]of s.question.options.entries()){const b=document.createElement('button');b.type='button';b.textContent=label;const id=s.question.id,epoch=s.epoch;b.onclick=()=>{const current=adapter.getState().snapshot;if(current?.question?.id===id&&current.epoch===epoch)run(()=>adapter.answer(i));};$('choices').append(b);}}
  $('answerStatus').textContent=v.role==='player'&&s.phase==='tiebreak'?'答題已完成，正在確認同分名次。':v.role==='player'&&s.phase==='finished'?'答題與排名結算已完成。':s.self?.answered?'已收到本題作答，不可更改':v.role==='player'&&s.phase==='lobby'?'等待主持人開始活動。':v.role==='player'&&['ready','listen'].includes(s.phase)?'本題選項已同步，等待主持人開始 15 秒作答。':'';
  $('terminal').textContent=s.phase==='finished'?'排名已確認，請等候主持人發獎。':'題目已完成，請等候主持人完成排名與發獎。';
  $('pendingPanel').hidden=!v.pending;$('reconcile').disabled=v.busy;$('refresh').disabled=v.busy;$('terminal').hidden=v.role==='host'||!['finished','tiebreak'].includes(s.phase);sync();
}
function sync(){if(!adapter)return;const v=adapter.getState(),s=v.snapshot;for(const b of $('choices').querySelectorAll('button'))b.disabled=!adapter.canAnswer();for(const id of ['start','listen','open'])$(id).disabled=!adapter.canCommand(id,id==='open'&&hostExternal?.canOpen());$('reveal').disabled=!hostFlow?.canReveal();$('next').disabled=!hostFlow?.canNext();
  hostConsole?.sync();
  hostExternal?.sync();
  $('timer').textContent=s?.phase==='answering'?'剩餘 '+Math.max(0,Math.ceil((s.deadline-adapter.serverNow())/1000))+' 秒':'';
}
async function run(action){const g=pageGeneration;$('error').textContent='';try{return await action();}catch(e){if(g===pageGeneration)showError(e);}}
$('loginForm').onsubmit=e=>{e.preventDefault();if(!adapter||adapter.getState().busy)return;const credentials=mode==='host'?{username:$('username').value.trim(),password:$('password').value,remember:$('remember').checked}:{name:$('name').value,code:inviteCode,remember:$('remember').checked};clearSecrets();run(()=>mode==='host'?adapter.loginHost(credentials):adapter.joinPlayer(credentials));};
async function leave(){hostExternal?.clear();hostFlow?.resetReveal();pageGeneration++;clearSecrets();$('username').value='admin';$('name').value='';const g=pageGeneration;const result=await adapter.logout();if(g!==pageGeneration)return;$('notice').textContent=result.status==='server_unconfirmed'?'本頁已退出；伺服器登出結果未確認。':'本頁已退出。';}
$('restore').onclick=()=>run(()=>adapter.resume());$('discardSaved').onclick=leave;
$('logout').onclick=leave;$('cancelLogin').onclick=leave;
for(const id of ['start','listen','open','reveal','next'])$(id).onclick=()=>run(()=>{if(id==='next')return hostFlow.next();if(id==='reveal')return hostFlow.reveal();if(id==='open'){if(!adapter.canCommand('open',hostExternal?.canOpen())||!hostExternal.prepareAnswer())return;return adapter.command('open',true);}return adapter.command(id);});
$('reconcile').onclick=()=>run(async()=>{const outcome=await adapter.reconcile();if(outcome==='unknown')$('error').textContent='原事件仍未確認，繼續保留並阻擋新操作，不會重送。';});
$('refresh').onclick=()=>run(()=>adapter.refresh());
try{validateConfig(config);await loadPinnedSdk();adapter=createExternalAdapter({config,createClient:globalThis.supabase?.createClient,ledger:sessionStorage,consentStorage:sessionStorage,onChange:render});$('notice').textContent='主持人使用外部歌曲頁面播放並手動停止；玩家只會收到選項。';$('login').hidden=false;
  hostConsole=mountHostConsole({adapter,run});hostExternal=mountHostExternalPlayback({adapter,onChange:sync});hostFlow=createHostQuestionFlow({adapter,onChange:()=>render(adapter.getState())});selectMode('player');
  window.addEventListener('pagehide',()=>hostFlow.resetReveal());window.addEventListener('pageshow',()=>{hostFlow.resetReveal();render(adapter.getState());adapter.poll();});
  if(adapter.hasSavedSession())run(()=>adapter.resume());
  const poll=async()=>{if(!document.hidden)await adapter.poll();setTimeout(poll,500);};poll();setInterval(sync,100);document.addEventListener('visibilitychange',()=>{if(!document.hidden)adapter.poll();});
}catch(e){showError(e);$('notice').textContent='連線未啟用';$('login').hidden=true;}
