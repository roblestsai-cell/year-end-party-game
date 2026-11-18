// New isolated e8-only adaptation of CC's player-page view. No new backend RPCs.
export const PLAYER_PHASES = Object.freeze({lobby:'等待主持人開始活動',ready:'等待主持人準備歌曲',listen:'請聆聽主持人播放歌曲',answering:'請在時限內作答',closed:'本題作答已截止',revealed:'本題已結束，等待下一題',tiebreak:'答題已完成，請等候主持人',finished:'答題已完成，請等候主持人'});
const MESSAGES={join_input_required:'請填寫有效姓名與邀請碼。',join_rejected:'無法加入，請向主持人確認邀請碼。',authentication_failed:'加入未成功，請稍後再試。',session_expired:'登入已失效，請重新輸入邀請碼加入。',saved_session_exists:'本分頁已有登入，請先恢復，不要重複加入。',network_unknown:'結果尚未確認，請查詢原操作，不要重送。',pending_storage_invalid:'本分頁登入記錄無法辨識，已停止加入。請聯絡主持人。',session_storage_unavailable:'本分頁無法保存登入，已停止加入。',action_not_allowed:'現在無法作答，請等待主持人開放。',contract_mismatch:'伺服器資料格式不符，已停止操作。',host_session:'此分頁已有主持人登入。請保留主持頁，改用手機或另一分頁加入。'};
export function playerView(v,{fresh=false,now=Infinity,hidden=false}={}) {
  const signed=v.role==='player',s=signed?v.snapshot:null;
  const show=!!s&&v.status==='connected'&&fresh&&!hidden&&s.phase==='answering'&&!!s.question&&Number.isFinite(s.deadline)&&now<s.deadline;
  return {signed,phaseText:s?PLAYER_PHASES[s.phase]||'':'',showChoices:show,options:show?s.question.options.slice():[],
    questionKey:show?JSON.stringify([s.epoch,s.question.id,s.question.options]):'',answered:!!s?.self?.answered,
    seconds:show?Math.max(0,Math.ceil((s.deadline-now)/1000)):0};
}
export function mountPlayerPage({doc,adapter,inviteCode=null,getSavedRole=()=>null,setTimer=setTimeout,clearTimer=clearTimeout}) {
  const $=id=>doc.getElementById(id);
  let key='',pollTimer=null,uiTimer=null,stopped=false,blocked=false;
  if(inviteCode) $('invite').value=inviteCode;
  const showError=e=>{$('error').textContent=e?(MESSAGES[e.code]||'操作未完成，請重新確認連線。'):'';};
  const run=async fn=>{if(stopped||blocked)return null;showError(null);try{return await fn();}catch(e){showError(e);return null;}finally{if(!stopped)render();}};
  const viewNow=()=>playerView(adapter.getState(),{fresh:adapter.isFresh(),now:adapter.serverNow(),hidden:!!doc.hidden});
  function clearChoices(){key='';$('choices').replaceChildren();$('choices').hidden=true;$('timer').textContent='';$('answerStatus').textContent='';}
  function render(){
    if(stopped){clearChoices();return;}
    const v=adapter.getState(),view=viewNow(); let saved=false;
    try{const role=getSavedRole();saved=!!role;if(role==='host'){blocked=true;showError({code:'host_session'});}}catch(e){blocked=true;showError(e);}
    $('join').hidden=view.signed||blocked;$('session').hidden=!view.signed||blocked;
    $('joinSubmit').disabled=blocked||v.busy||saved;
    $('name').disabled=blocked||v.busy||saved;$('invite').disabled=blocked||v.busy||saved;
    $('inviteStatus').textContent=saved&&!view.signed?'本分頁有登入，請先恢復連線。':'使用邀請碼加入；登入只保留於本分頁。';
    $('restore').hidden=blocked||!saved||view.signed;$('restore').disabled=!!v.busy;
    $('phase').textContent=view.phaseText;
    $('connection').textContent=v.status==='connected'&&adapter.isFresh()?'已連線':view.signed?'連線待確認，選項已隱藏。':'';
    $('ticketPending').hidden=view.showChoices;$('ticketPending').textContent='抽獎號碼尚待後端票券功能提供，本頁不產生或顯示臨時號碼。';
    if(blocked){clearChoices();return;}
    $('choices').hidden=!view.showChoices;
    if(view.questionKey!==key){key=view.questionKey;$('choices').replaceChildren();
      view.options.forEach((label,i)=>{const b=doc.createElement('button');b.type='button';b.textContent=label;const at=key;
        b.onclick=()=>{if(!stopped&&!blocked&&viewNow().questionKey===at&&adapter.canAnswer())return run(()=>adapter.answer(i));};$('choices').append(b);});}
    for(const b of $('choices').querySelectorAll('button'))b.disabled=!adapter.canAnswer()||!view.showChoices;
    $('timer').textContent=view.showChoices?'剩餘 '+view.seconds+' 秒':'';
    $('answerStatus').textContent=view.showChoices&&view.answered?'已收到作答，不可更改。':'';
    $('pending').hidden=!v.pending;$('reconcile').disabled=!!v.busy;
    $('refresh').disabled=!!v.busy;$('leave').disabled=false;
    if(v.error)showError({code:v.error});
    if(view.signed)$('invite').value='';
  }
  $('joinForm').onsubmit=e=>{e?.preventDefault?.();if(stopped||blocked||$('joinSubmit').disabled)return null;
    const name=$('name').value.normalize('NFC').trim(),code=$('invite').value.trim();
    if(!name||[...name].length>24||/[\u0000-\u001f\u007f]/.test(name)||!code||code.length>256||/[\u0000-\u001f\u007f]/.test(code)){showError({code:'join_input_required'});return null;}
    return run(()=>adapter.joinPlayer({name,code,remember:true}));};
  const recover=()=>run(()=>adapter.hasSavedSession()&&!adapter.getState().role?adapter.resume():adapter.refresh());
  $('restore').onclick=recover;$('refresh').onclick=recover;
  $('reconcile').onclick=()=>run(async()=>{const result=await adapter.reconcile();if(result==='unknown')$('error').textContent='原操作結果仍未知，保留待查，不自動重送。';return result;});
  $('leave').onclick=()=>run(async()=>{await adapter.logout();clearChoices();});
  async function start(){
    try{const role=getSavedRole();if(role==='host'){blocked=true;showError({code:'host_session'});render();return;}if(role==='player')await run(()=>adapter.resume());}
    catch(e){blocked=true;showError(e);render();return;}
    if(stopped)return;render();
    const poll=async()=>{if(stopped||blocked)return;if(!doc.hidden)await adapter.poll();if(!stopped&&!blocked)pollTimer=setTimer(poll,500);};
    const ui=()=>{if(stopped)return;render();uiTimer=setTimer(ui,250);};
    void poll();uiTimer=setTimer(ui,250);
  }
  function visibilityChanged(){render();if(!stopped&&!blocked&&!doc.hidden)void adapter.poll();}
  function stop(){if(stopped)return;stopped=true;clearTimer(pollTimer);clearTimer(uiTimer);pollTimer=uiTimer=null;clearChoices();$('joinSubmit').disabled=true;adapter.dispose();}
  return Object.freeze({render,start,stop,visibilityChanged});
}
