import {TIERS,splitPrize,planPrize} from './host-contract.js';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function keyed(node,key,render){if(node.dataset.key!==key){node.dataset.key=key;node.replaceChildren();render(node);}}
export function mountHostConsole({adapter,run}){
 let latest=null,editId=null,tieHistoryKey='',draftBase=null;
 const displayName=p=>{if(!p)return '';const id=p.id??p.playerId;const peers=(latest?.roster||[]).filter(x=>x.name===p.name);if(!peers.some(x=>x.id!==id))return p.name;const short=id.slice(-6),collision=peers.some(x=>x.id!==id&&x.id.slice(-6)===short);return p.name+' · '+(collision?id:short);};
 const tier=$('prizeTier');for(const name of TIERS)tier.append(new Option(name,name));
 const input=()=>({id:editId,tier:tier.value,content:$('prizeContent').value,quantity:Number($('prizeQuantity').value),rankFrom:Number($('prizeFrom').value),expectedPrizes:draftBase??JSON.stringify(adapter.getState().snapshot?.prizes)});
 function suggest(){const s=adapter.getState().snapshot;if(!s||s.role!=='host')return;const found=s.prizes.find(p=>splitPrize(p.name).tier===tier.value);editId=found?.id??null;if(found){const p=splitPrize(found.name);$('prizeContent').value=p.content;$('prizeQuantity').value=String(found.quantity);$('prizeFrom').value=String(found.rankFrom);}else{const prior=s.prizes.filter(p=>{const i=TIERS.indexOf(splitPrize(p.name).tier);return i>=0&&i<TIERS.indexOf(tier.value);});$('prizeFrom').value=String(prior.length?Math.max(...prior.map(p=>p.rankTo))+1:1);$('prizeContent').value='';$('prizeQuantity').value='1';}sync();}
 tier.onchange=()=>{draftBase=JSON.stringify(adapter.getState().snapshot?.prizes);suggest();};
 for(const id of ['prizeContent','prizeQuantity','prizeFrom'])$(id).oninput=()=>{draftBase??=JSON.stringify(adapter.getState().snapshot?.prizes);sync();};
 $('reloadPrizeDraft').onclick=()=>{draftBase=null;$('prizeFeedback').textContent='已載入最新設定，先前草稿已捨棄。';suggest();};
 $('cancelPrizeEdit').onclick=()=>{draftBase=null;editId=null;$('prizeContent').value='';$('prizeQuantity').value='1';sync();};
 $('prizeForm').onsubmit=e=>{e.preventDefault();const data=input();run(async()=>{const result=await adapter.hostAction('prizeSave',data);if(result?.status==='committed'){draftBase=null;editId=null;$('prizeContent').value='';$('prizeQuantity').value='1';$('prizeFeedback').textContent='已儲存伺服器確認的排名獎項。';sync();}});};
 $('tieDraw').onclick=()=>run(()=>adapter.hostAction('tieDraw'));
 $('prizeDraw').onclick=()=>run(()=>adapter.hostAction('prizeDraw'));
 function render(v){
  const s=v.snapshot;latest=s?.role==='host'?s:null;$('hostConsole').hidden=!latest;
  if(!latest){for(const id of ['roster','ranking','remainingRanks','prizeList','draws','tieCandidates']){$(id).replaceChildren();delete $(id).dataset.key;}$('revealResult').textContent='';$('tieResult').textContent='';$('settlementStatus').textContent='';$('prizeContent').value='';$('remainingBox').open=false;$('prizeTier').value='頭獎';$('prizeQuantity').value='1';$('prizeFrom').value='1';$('prizeFeedback').textContent='';$('prizeConflict').hidden=true;editId=null;draftBase=null;tieHistoryKey='';const canvas=$('tieWheel');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);return;}
  $('rosterCount').textContent=s.roster.length+' 位已加入';
  keyed($('roster'),JSON.stringify(s.roster),box=>{if(!s.roster.length)box.append(el('p','尚無同仁加入。','empty'));for(const p of s.roster){const row=el('li');row.dataset.playerId=p.id;row.append(el('span',displayName(p)),el('span',{joined:'已加入',revoked:'登入已撤銷',expired:'登入已過期'}[p.status],'badge '+p.status));box.append(row);}});
  $('revealPanel').hidden=!s.reveal;$('revealResult').textContent=s.reveal?'正確選項：'+s.reveal.answerText+(s.reveal.explanation?'。'+s.reveal.explanation:''):'';
  $('rankingTitle').textContent=s.rankingFinal?'最終排名 · 前 26 名':'目前排名 · 前 26 名';
  const nameKey=JSON.stringify(s.roster.map(p=>[p.id,p.name]));
  const rankRow=p=>{const row=el('li');row.dataset.playerId=p.id;row.append(el('span','第 '+p.rank+' 名','rank-number'),el('span',displayName(p),'rank-name'),el('strong',p.score+' 分'));return row;};
  keyed($('ranking'),JSON.stringify([s.ranking.slice(0,6),nameKey]),box=>{if(!s.ranking.length)box.append(el('li','尚無排名。','empty'));s.ranking.slice(0,6).forEach(p=>box.append(rankRow(p)));});
  keyed($('remainingRanks'),JSON.stringify([s.ranking.slice(6),nameKey]),box=>s.ranking.slice(6).forEach(p=>box.append(rankRow(p))));
  $('remainingBox').hidden=s.ranking.length<=6;$('remainingSummary').textContent='其餘 '+Math.max(0,s.ranking.length-6)+' 位排名';
  $('rankingNote').textContent=s.ties.pending?'同分名次尚未確定，跨第 26 名的同分者也會列入轉盤。':s.rankingFinal?'同分順序已由伺服器確認。':'只計入已結算題目；最終同分名次尚未處理。';
  const group=s.ties.group;$('tiesPanel').hidden=!['tiebreak','finished'].includes(s.phase);
  $('tieHeading').textContent=group?'同分轉盤 · 決定第 '+group.nextRank+' 名':'同分處理完成';
  $('tieRule').textContent='同分且競逐同一名次時使用。猜拳勝者只負責按下啟動；伺服器轉中者排前，其餘依後續轉盤順延。';
  keyed($('tieCandidates'),JSON.stringify([group?.candidates||[],nameKey]),box=>{for(const p of group?.candidates||[])box.append(el('li',displayName(p)));});
  const last=s.ties.history.at(-1);$('tieResult').textContent=last?'伺服器已確認第 '+last.rank+' 名：'+displayName(last.candidates.find(p=>p.id===last.winnerId)):'';
  keyed($('prizeList'),JSON.stringify([s.prizes,s.draws.length]),box=>{
   if(!s.prizes.length)box.append(el('p','尚未設定獎項。請從下拉選單選擇獎等，填寫人數與內容；不會自動加入預設獎項。','empty'));
   for(const p of [...s.prizes].sort((a,b)=>a.rankFrom-b.rankFrom)){
    const row=el('article',undefined,'prize-row'),parsed=splitPrize(p.name),body=el('div');body.append(el('strong',p.name),el('p','第 '+p.rankFrom+'–'+p.rankTo+' 名 · '+p.quantity+' 人 · 尚餘 '+p.remaining+' 份'));row.append(body);
    if(parsed.tier){const b=el('button','編輯');b.type='button';b.dataset.action='prizeSave';b.onclick=()=>{draftBase=JSON.stringify(adapter.getState().snapshot.prizes);editId=p.id;tier.value=parsed.tier;$('prizeContent').value=parsed.content;$('prizeQuantity').value=String(p.quantity);$('prizeFrom').value=String(p.rankFrom);sync();$('prizeContent').focus();};row.append(b);}
    const remove=el('button','移除此獎項','secondary');remove.type='button';remove.dataset.action='prizeDelete';remove.dataset.id=p.id;remove.onclick=()=>run(async()=>{await adapter.hostAction('prizeDelete',{id:p.id});if(editId===p.id){editId=null;$('prizeContent').value='';}sync();});row.append(remove);box.append(row);
   }
  });
  keyed($('draws'),JSON.stringify([s.draws,nameKey]),box=>{if(!s.draws.length)box.append(el('li','尚未發獎。','empty'));for(const d of s.draws){const row=el('li','第 '+d.rank+' 名 '+displayName(d)+' · '+d.prize);row.dataset.playerId=d.playerId;box.append(row);}});
  const missing=s.ranking.filter(p=>!s.prizes.some(q=>p.rank>=q.rankFrom&&p.rank<=q.rankTo)).map(p=>p.rank);
  $('awardCoverage').textContent=!['tiebreak','finished'].includes(s.phase)?'題目尚未完成，可先設定獎項，結算排名後再檢查涵蓋範圍。':!s.ranking.length?'尚無可發獎的排名，尚未完成發獎。':!s.prizes.length?'尚未設定任何獎項，請先完成排名獎項設定。':missing.length?'尚未設定獎項的名次：'+missing.join('、')+'。補齊目前前 26 名範圍後，才可依名次發放。':'目前名次的獎項範圍已覆蓋。';
  const done=s.phase==='finished'&&s.rankingFinal&&s.ranking.length>0&&s.ranking.every(p=>s.draws.some(d=>d.rank===p.rank));
  $('settlementStatus').textContent=done?'本場結算完成，排名獎項已全數發放。':s.phase==='tiebreak'?'題目已完成，請繼續完成同分排序及排名發獎。':s.phase==='finished'?(s.ranking.length?'排名已確認，請依序發放獎項。':'本場沒有可結算的玩家。'):'完成所有題目後，繼續同分排序及排名發獎。';
  $('settlementStatus').classList.toggle('complete',done);
  $('awardLock').textContent=s.draws.length?'已開始發獎，暫停更改與刪除獎項，以避免重複或重新分配。':'設定可修改或移除；儲存不會立即發獎。';sync();
 }
 function sync(){
  if(!latest)return;const s=adapter.getState().snapshot;if(!s||s.role!=='host')return;
  $('tieDraw').disabled=!adapter.canHostAction('tieDraw');$('prizeDraw').disabled=!adapter.canHostAction('prizeDraw');
  const next=s.ranking.find(p=>!s.draws.some(d=>d.rank===p.rank));$('prizeDraw').textContent=s.phase!=='finished'||!s.rankingFinal?'等待排名結算後發獎':!s.ranking.length?'尚無可發放的排名':next?'依排名發放第 '+next.rank+' 名獎項':'獎項已發放完成';
  $('participationNotice').hidden=tier.value!=='參加獎';
  let valid=false;try{const p=planPrize(s,input());$('prizeRange').textContent='此設定涵蓋第 '+p.rankFrom+'–'+p.rankTo+' 名，共 '+p.quantity+' 人。';valid=true;}catch(e){$('prizeRange').textContent=e.message==='prize_range_conflict'?'此獎等或名次範圍與其他獎項重疊，請調整。':'請填入獎項內容、人數及 1–26 內的起始名次。';}
  const conflict=draftBase!==null&&draftBase!==JSON.stringify(s.prizes);$('prizeConflict').hidden=!conflict;
  $('savePrize').textContent=editId?'儲存變更':'儲存獎項';$('savePrize').disabled=conflict||!valid||!adapter.canHostAction('prizeSave');$('cancelPrizeEdit').hidden=!editId;
  for(const b of $('prizeList').querySelectorAll('button'))b.disabled=!adapter.canHostAction(b.dataset.action,b.dataset.id);
  const editable=adapter.canHostAction('prizeSave');for(const id of ['prizeTier','prizeContent','prizeQuantity','prizeFrom'])$(id).disabled=!editable;
  $('tieCountdown').textContent=s.ties.pending&&adapter.serverNow()<s.ties.readyAt?'轉盤結果展示中，'+Math.ceil((s.ties.readyAt-adapter.serverNow())/1000)+' 秒後可繼續。':'';
  drawWheel(s);
 }
 function drawWheel(s){
  const canvas=$('tieWheel'),ctx=canvas.getContext('2d'),last=s.ties.history.at(-1),animating=last&&adapter.serverNow()<s.ties.readyAt;
  const candidates=animating?last.candidates:s.ties.group?.candidates||last?.candidates||[];
  const key=JSON.stringify([candidates,last?.winnerId,animating,s.roster.map(p=>[p.id,p.name])]);if(key===tieHistoryKey&&!animating)return;tieHistoryKey=key;
  const size=canvas.width,c=size/2,r=c-18;ctx.clearRect(0,0,size,size);if(!candidates.length){ctx.fillStyle='#b5c2d7';ctx.font='18px system-ui';ctx.textAlign='center';ctx.fillText('無待處理同分',c,c);return;}
  const n=candidates.length,step=Math.PI*2/n,winner=last?candidates.findIndex(p=>p.id===last.winnerId):-1;
  const duration=Math.max(1,s.ties.readyAt-(last?.startedAt||0)),progress=animating?Math.min(1,Math.max(0,(adapter.serverNow()-last.startedAt)/duration)):1;
  const turn=last&&winner>=0?(Math.PI*8-Math.PI/2-(winner+.5)*step)*(1-Math.pow(1-progress,3)):0;
  for(let i=0;i<n;i++){const a=i*step+turn;ctx.beginPath();ctx.moveTo(c,c);ctx.arc(c,c,r,a,a+step);ctx.closePath();ctx.fillStyle=['#fbbf24','#14b8a6','#7c87d9','#ec8b6c'][i%4];ctx.fill();ctx.strokeStyle='#111827';ctx.stroke();ctx.save();ctx.translate(c,c);ctx.rotate(a+step/2);ctx.fillStyle='#102033';ctx.font=(n>12?'11':'14')+'px system-ui';ctx.textAlign='right';ctx.fillText(displayName(candidates[i]),r-12,5,r*.65);ctx.restore();}
  ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(c-12,2);ctx.lineTo(c+12,2);ctx.lineTo(c,24);ctx.fill();
 }
 return {render,sync};
}
