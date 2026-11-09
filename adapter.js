import {HOST_CONTRACT,validateHostFields,safeSourceUrl,planPrize} from './host-contract.js';
import {signInHost,HOST_LOGIN_PATH} from './host-auth.js';
export const CONTRACT = 'external-v1';
export const PLAYER_CONTRACT = 'external-player-v2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHASES = new Set(['lobby','ready','listen','answering','closed','revealed','tiebreak','finished']);
const RPC = Object.freeze({join:'party_join',snapshot:'party_external_player_snapshot',hostSnapshot:'party_external_host_snapshot',receipt:'party_event_result',command:'party_external_host_command',answer:'party_external_submit_answer',tieDraw:'party_tie_draw',prizeSave:'party_ranked_award_save',prizeDelete:'party_prize_delete',prizeDraw:'party_prize_draw'});
export class PartyError extends Error { constructor(code){super(code);this.name='PartyError';this.code=code;} }
const fail = code => {throw new PartyError(code);};
const exact = (o,keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k=>keys.includes(k));
export function validateConfig(c){
  if(!exact(c,['contract','projectUrl','publishableKey','roomId']) || c.contract!==CONTRACT) fail('configuration_required');
  let u;try{u=new URL(c.projectUrl);}catch{fail('configuration_required');}
  if(!/^https:\/\/[a-z0-9]{10,40}\.supabase\.co$/.test(c.projectUrl) || u.origin!==c.projectUrl || !/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(c.publishableKey) || !UUID.test(c.roomId)) fail('configuration_required');
  return Object.freeze({...c});
}
export function projectSnapshot(s, expectedRole){
  const hostKeys=['roster','reveal','ranking','rankingFinal','ties','prizes','draws','awardMode','postAwardEditing'];
  const keys=['contract','mode','role','phase','epoch','revision','serverNow','deadline','index','roundCount','question','self',...(expectedRole==='host'?['host',...hostKeys]:[])];
  if(!exact(s,keys)||Object.keys(s).length!==keys.length || s.contract!==(expectedRole==='host'?HOST_CONTRACT:PLAYER_CONTRACT) || s.mode!=='host-external' || s.role!==expectedRole || !PHASES.has(s.phase)) fail('contract_mismatch');
  if(expectedRole==='host')try{validateHostFields(s);}catch{fail('contract_mismatch');}
  if(![s.epoch,s.revision,s.roundCount].every(n=>Number.isSafeInteger(n)&&n>=0) || !Number.isFinite(s.serverNow) || !(s.index===null||Number.isSafeInteger(s.index)&&s.index>=1&&s.index<=s.roundCount)) fail('contract_mismatch');
  if(s.phase==='answering'&&s.deadline-s.serverNow>15000)fail('contract_mismatch');
  if(!(s.deadline===null||Number.isFinite(s.deadline)) || (['answering','closed'].includes(s.phase)&&s.deadline===null)) fail('contract_mismatch');
  if(s.question!==null){if(!exact(s.question,['id','options']) || !UUID.test(s.question.id) || !Array.isArray(s.question.options) || s.question.options.length!==4 || s.question.options.some(v=>typeof v!=='string'||!v.trim()||v.length>300) || new Set(s.question.options).size!==4) fail('contract_mismatch');}
  if(!(s.self===null||exact(s.self,['answered','score'])&&typeof s.self.answered==='boolean'&&(s.self.score===null||Number.isSafeInteger(s.self.score)&&s.self.score>=0))) fail('contract_mismatch');
  if(expectedRole==='player'){
    if(s.self===null||!Object.hasOwn(s.self,'score')||!['tiebreak','finished'].includes(s.phase)&&s.self.score!==null)fail('contract_mismatch');
    if(Object.hasOwn(s,'host') || (!['ready','listen','answering','closed','revealed'].includes(s.phase)&&s.question!==null) || (['ready','listen','answering','closed','revealed'].includes(s.phase)&&s.question===null)) fail('contract_mismatch');
  }else if(s.host!==undefined&&s.host!==null){
    if(!exact(s.host,['questionId','prompt','type','source']) || !UUID.test(s.host.questionId) || typeof s.host.prompt!=='string' || s.host.prompt.length>2000 || typeof s.host.type!=='string' || !exact(s.host.source,['url','title','performer','version'])) fail('contract_mismatch');
    let u;try{u=new URL(s.host.source.url);}catch{fail('contract_mismatch');}
    if(!safeSourceUrl(s.host.source.url)||s.question&&s.question.id!==s.host.questionId||['title','performer','version'].some(k=>typeof s.host.source[k]!=='string'||s.host.source[k].length>500)) fail('contract_mismatch');
  }
  return JSON.parse(JSON.stringify(s));
}
export function createExternalAdapter({config,createClient,fetchImpl=globalThis.fetch,monotonic=()=>performance.now(),uuid=()=>crypto.randomUUID(),ledger=null,consentStorage=null,onChange=()=>{}}){
  const c=validateConfig(config),tick=monotonic;
  if(typeof createClient!=='function'||typeof fetchImpl!=='function') fail('sdk_unavailable');
  const resumeKey='party-external-resume:'+c.projectUrl+':'+c.roomId;
  const saved=()=>{try{const raw=consentStorage?.getItem(resumeKey);if(!raw)return null;const p=JSON.parse(raw);if(!exact(p,['namespace','role'])||!/^party-external-auth:[0-9a-f-]{36}$/i.test(p.namespace)||!['host','player'].includes(p.role))fail('pending_storage_invalid');return p;}catch{fail('pending_storage_invalid');}};
  const eraseSaved=ctx=>{if(!ctx?.remember)return;ctx.storageActive=false;try{for(const k of [ctx.namespace,ctx.namespace+'-user',ctx.namespace+'-code-verifier'])consentStorage.removeItem(k);if(saved()?.namespace===ctx.namespace)consentStorage.removeItem(resumeKey);}catch{}};
  const commitSaved=ctx=>{if(ctx.remember){try{consentStorage.setItem(resumeKey,JSON.stringify({namespace:ctx.namespace,role:ctx.role}));}catch{fail('pending_storage_failed');}}};
  let generation=0,current=null,loginPromise=null,loginGeneration=0,pollPromise=null;
  let view={status:'signed_out',role:null,snapshot:null,pending:null,busy:false,error:null,lastUpdate:0};
  const emit=()=>onChange(getState());
  const set=patch=>{view={...view,...patch};emit();};
  const getState=()=>JSON.parse(JSON.stringify(view));
  const valid=ctx=>current===ctx&&ctx.generation===generation;
  const assert=ctx=>{if(!valid(ctx))fail('stale_session');};
  const key=ctx=>'party-external-pending:'+c.roomId+':'+ctx.uid;
  const pendingRead=ctx=>{try{const raw=ledger?.getItem(key(ctx));if(!raw)return null;const x=JSON.parse(raw);if(!exact(x,['eventId','kind'])||!UUID.test(x.eventId)||typeof x.kind!=='string')fail('pending_storage_invalid');return x;}catch{fail('pending_storage_invalid');}};
  const savePending=(ctx,p)=>{try{if(ledger){if(p)ledger.setItem(key(ctx),JSON.stringify(p));else ledger.removeItem(key(ctx));}}catch{fail('pending_storage_failed');}set({pending:p});};
  const clearLocal=(error,preserveSaved=false)=>{generation++;const old=current;current=null;pollPromise=null;loginPromise=null;view={status:'signed_out',role:null,snapshot:null,pending:null,busy:false,error,lastUpdate:0};if(old){if(!preserveSaved)eraseSaved(old);else {old.storageActive=false;old.shadow?.clear();}old.subscription?.unsubscribe();old.client.auth.stopAutoRefresh();old.controllers.forEach(x=>x.abort());}emit();return old;};
  const requestFetch=ctx=>async(input,init={})=>{
    const u=new URL(typeof input==='string'?input:input.url);
    if(!valid(ctx)&&u.pathname!=='/auth/v1/logout')fail('stale_session');
    const allowedRpc=u.pathname.startsWith('/rest/v1/rpc/')&&Object.values(RPC).includes(u.pathname.slice('/rest/v1/rpc/'.length));
    const allowedAuth=['/auth/v1/token','/auth/v1/signup','/auth/v1/user','/auth/v1/logout'].includes(u.pathname);
    if(u.origin!==c.projectUrl||(!allowedRpc&&!allowedAuth&&u.pathname!==HOST_LOGIN_PATH))fail('network_destination_blocked');
    const controller=new AbortController();ctx.controllers.add(controller);
    const signal=init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal;
    try{const response=await fetchImpl(input,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(6000)])});if(response.redirected)fail('network_destination_blocked');return response;}finally{ctx.controllers.delete(controller);}
  };
  function newContext(role,{remember=false,namespace=null}={}){
    if(remember&&!consentStorage)fail('pending_storage_failed');
    const ctx={generation:++generation,role,uid:null,authRevision:0,controllers:new Set(),client:null,subscription:null,remember,namespace:namespace||'party-external-auth:'+uuid(),storageActive:true,shadow:new Map(),expired:new Set(),clockFloor:-Infinity};current=ctx;
    const storage={getItem:k=>{if(!ctx.storageActive)return ctx.shadow.get(k)??null;const v=consentStorage.getItem(k);if(v!==null)ctx.shadow.set(k,v);return v;},setItem:(k,v)=>{if(ctx.storageActive){consentStorage.setItem(k,v);ctx.shadow.set(k,v);}},removeItem:k=>{ctx.shadow.delete(k);consentStorage.removeItem(k);}};
    ctx.client=createClient(c.projectUrl,c.publishableKey,{auth:{persistSession:remember,autoRefreshToken:true,detectSessionInUrl:false,storageKey:ctx.namespace,...(remember?{storage}:{}),debug:false},global:{fetch:requestFetch(ctx)},db:{schema:'public'}});
    ctx.subscription=ctx.client.auth.onAuthStateChange((event,session)=>{
      if(!valid(ctx))return;
      if(event==='SIGNED_OUT'&&ctx.uid){clearLocal('session_expired');return;}
      if(ctx.uid&&session?.user?.id!==ctx.uid&&event!=='INITIAL_SESSION'){clearLocal('identity_changed');return;}
      if(event==='TOKEN_REFRESHED'){ctx.authRevision++;set({lastUpdate:0});}
    }).data.subscription;
    return ctx;
  }
  async function rpc(ctx,name,args){
    assert(ctx);const revision=ctx.authRevision,sent=tick();let result;
    try{const query=ctx.client.rpc(name,args);if(typeof query.retry!=='function')fail('sdk_incompatible');result=await query.retry(false).abortSignal(AbortSignal.timeout(6000));}catch{assert(ctx);fail('network_unknown');}
    assert(ctx);if(ctx.authRevision!==revision)fail('stale_auth_response');
    if(result.error){const status=result.status;const e=new PartyError(status===401?'session_expired':status===403?'access_denied':status===404?'backend_unavailable':'request_rejected');e.definite=Number.isFinite(status)&&status>=400&&status<500&&status!==408&&status!==429;e.auth=status===401;throw e;}
    if(tick()-sent<0||tick()-sent>1500)fail('stale_response');
    return {data:result.data,sent,received:tick()};
  }
  function receive(ctx,response){
    assert(ctx);const s=projectSnapshot(response.data,ctx.role),old=view.snapshot;
    if(old&&(s.epoch<old.epoch||s.revision<old.revision||s.serverNow<old.serverNow))return false;
    if(old&&s.epoch===old.epoch&&s.revision===old.revision&&old.question?.id!==s.question?.id)fail('contract_mismatch');
    if(old&&s.epoch===old.epoch&&s.revision===old.revision){
      if(old.phase!==s.phase&&!(old.phase==='answering'&&s.phase==='closed'))return false;
      const frozen=['tiebreak','finished'].includes(old.phase);
      if(ctx.role==='host'&&['question','host','reveal',...(frozen?['ranking']:[]),'rankingFinal','ties','prizes','draws','awardMode','postAwardEditing'].some(k=>JSON.stringify(old[k])!==JSON.stringify(s[k])))fail('contract_mismatch');
    }
    if(old&&s.epoch===old.epoch){
      if(ctx.role==='host'&&(old.rankingFinal&&!s.rankingFinal||old.draws.some((d,i)=>JSON.stringify(d)!==JSON.stringify(s.draws[i]))||old.ties.history.some((d,i)=>JSON.stringify(d)!==JSON.stringify(s.ties.history[i]))))fail('contract_mismatch');
      if(ctx.role==='player'&&old.self?.score!==null&&old.self?.score!==undefined&&old.self.score!==s.self?.score)fail('contract_mismatch');
    }
    const sameQuestion=old&&old.epoch===s.epoch&&old.question?.id&&old.question.id===s.question?.id;
    if(sameQuestion){
      if(old.phase==='closed'&&s.phase==='answering')return false;
      if(old.phase==='revealed'&&['answering','closed'].includes(s.phase))return false;
      if(old.self?.answered&&s.self)s.self.answered=true;
    }
    ctx.serverAt=s.serverNow;ctx.receivedAt=response.received;ctx.rtt=response.received-response.sent;
    const restoredPending=view.role===null?pendingRead(ctx):view.pending;set({status:'connected',role:s.role,snapshot:s,lastUpdate:tick(),error:null,pending:restoredPending});return true;
  }
  async function refreshContext(ctx){
    assert(ctx);let result;try{result=await ctx.client.auth.refreshSession();}catch{assert(ctx);clearLocal('session_expired');fail('session_expired');}
    assert(ctx);if(result.error||result.data?.session?.user?.id!==ctx.uid){clearLocal('session_expired');fail('session_expired');}
    return true;
  }
  async function snapshot(ctx,allowRefresh=true){
    try{return receive(ctx,await rpc(ctx,ctx.role==='host'?RPC.hostSnapshot:RPC.snapshot,{p_room:c.roomId}));}
    catch(e){if(e.auth&&allowRefresh){await refreshContext(ctx);return snapshot(ctx,false);}throw e;}
  }
  async function login(role,credentials={}){
    if(loginPromise)return loginPromise;
    if(current?.uid)fail('already_signed_in');
    if(saved())fail('saved_session_exists');
    if(role==='host'&&(credentials.username!=='admin'||typeof credentials.password!=='string'||!credentials.password))fail('authentication_failed');
    if(role==='player'&&(!String(credentials.name||'').normalize('NFC').trim()||[...String(credentials.name||'').normalize('NFC').trim()].length>24||/[\u0000-\u001f\u007f]/.test(credentials.name)||typeof credentials.code!=='string'||!credentials.code.trim()))fail('join_input_required');
    const ctx=newContext(role,{remember:credentials.remember===true});loginGeneration=ctx.generation;set({status:'authenticating',busy:true,error:null,role:null,snapshot:null,pending:null,lastUpdate:0});
    loginPromise=(async()=>{
      try{
        let result;
        try{result=role==='host'?await signInHost({client:ctx.client,credentials,fetchImpl:requestFetch(ctx),projectUrl:c.projectUrl,publishableKey:c.publishableKey,roomId:c.roomId,assertCurrent:()=>assert(ctx)}):await ctx.client.auth.signInAnonymously();}catch(e){fail(e.code||'authentication_failed');}
        if(!valid(ctx)){if(result?.data?.session)void ctx.client.auth.signOut({scope:'local'}).catch(()=>{}).finally(()=>ctx.shadow.clear());fail('stale_session');}
        const session=result.data?.session;
        if(result.error||!session?.user?.id||session.user.is_anonymous!==(role==='player'))fail('authentication_failed');
        ctx.uid=session.user.id;
        if(role==='player'){
          const name=String(credentials.name||'').normalize('NFC').trim();
          if(!name||[...name].length>24||/[\u0000-\u001f\u007f]/.test(name)||typeof credentials.code!=='string'||!credentials.code.trim())fail('join_input_required');
          let joined;
          try{joined=(await rpc(ctx,RPC.join,{p_room:c.roomId,p_code:credentials.code.trim(),p_name:name})).data;}
          catch(e){if(e.definite)throw e;await snapshot(ctx);joined={status:'joined'};}
          if(joined?.status!=='joined')fail('join_rejected');
        }
        await snapshot(ctx);assert(ctx);commitSaved(ctx);set({pending:pendingRead(ctx),busy:false});return getState();
      }catch(e){if(valid(ctx)){
        const uncertain=ctx.uid&&(e.definite===false||['network_unknown','stale_response','stale_auth_response'].includes(e.code));
        if(uncertain){commitSaved(ctx);set({status:'verifying',busy:false,error:e.code||'network_unknown',lastUpdate:0});}
        else{clearLocal(e.code||'authentication_failed');void ctx.client.auth.signOut({scope:'local'}).catch(()=>{}).finally(()=>ctx.shadow.clear());}
      }throw new PartyError(e.code||'authentication_failed');}
      finally{if(loginGeneration===ctx.generation)loginPromise=null;}
    })();return loginPromise;
  }
  async function resume(){
    if(loginPromise)return loginPromise;if(current?.uid)fail('already_signed_in');const p=saved();if(!p)return false;
    const ctx=newContext(p.role,{remember:true,namespace:p.namespace});loginGeneration=ctx.generation;set({status:'authenticating',busy:true,error:null,role:null,snapshot:null,pending:null,lastUpdate:0});
    loginPromise=(async()=>{try{
      const result=await ctx.client.auth.getSession();assert(ctx);if(result.error||!result.data?.session)fail('session_expired');
      const checked=await ctx.client.auth.getUser();assert(ctx);if(checked.error){if(checked.error.status===401||checked.error.status===403)fail('session_expired');fail('network_unknown');}
      if(!checked.data?.user?.id||checked.data.user.is_anonymous!==(p.role==='player'))fail('session_expired');ctx.uid=checked.data.user.id;
      await snapshot(ctx);assert(ctx);set({pending:pendingRead(ctx),busy:false});return getState();
    }catch(e){if(valid(ctx))clearLocal(e.code||'network_unknown',!['session_expired','identity_changed'].includes(e.code));throw new PartyError(e.code||'network_unknown');}
    finally{if(loginGeneration===ctx.generation)loginPromise=null;}})();return loginPromise;
  }
  async function poll(){
    const ctx=current;if(!ctx?.uid||view.busy)return false;if(pollPromise)return pollPromise;
    pollPromise=(async()=>{try{return await snapshot(ctx);}catch(e){if(valid(ctx)){if(e.auth)clearLocal('session_expired');else set({status:view.role===null?'verifying':'disconnected',lastUpdate:0,error:e.code||'network_unknown'});}return false;}finally{if(valid(ctx))pollPromise=null;}})();return pollPromise;
  }
  const serverNow=()=>{if(current?.serverAt===undefined)return Infinity;const estimate=current.serverAt+Math.max(0,tick()-current.receivedAt)+(current.rtt||0);current.clockFloor=Math.max(current.clockFloor,estimate);return current.clockFloor;};
  const fresh=()=>view.status==='connected'&&!!view.lastUpdate&&tick()-view.lastUpdate>=0&&tick()-view.lastUpdate<1500;
  const expired=s=>{if(!s||s.deadline===null||!current)return false;const key=s.epoch+':'+(s.question?.id||s.host?.questionId);if(serverNow()>=s.deadline)current.expired.add(key);return current.expired.has(key);};
  function canAnswer(){const s=view.snapshot,ended=expired(s);return view.role==='player'&&fresh()&&!view.busy&&!view.pending&&s.phase==='answering'&&!!s.question&&!ended&&!s.self?.answered;}
  function canCommand(command,stopped=false){const s=view.snapshot;if(view.role!=='host'||!fresh()||view.busy||view.pending)return false;return {start:s.phase==='lobby',listen:s.phase==='ready',open:s.phase==='listen'&&stopped===true,reveal:s.phase==='closed'||s.phase==='answering'&&expired(s),next:s.phase==='revealed'}[command]===true;}
  function canHostAction(kind,id=null){
    const s=view.snapshot;if(view.role!=='host'||!fresh()||view.busy||view.pending||s.contract!==HOST_CONTRACT)return false;
    if(kind==='tieDraw')return s.phase==='tiebreak'&&s.ties.pending&&!!s.ties.group&&serverNow()>=s.ties.readyAt;
    if(kind==='prizeSave')return s.draws.length===0;
    if(kind==='prizeDelete')return s.draws.length===0&&s.prizes.some(p=>p.id===id&&p.remaining===p.quantity);
    if(kind==='prizeDraw')return s.phase==='finished'&&s.rankingFinal&&!s.ties.pending&&s.ranking.length>0&&s.ranking.every(p=>s.prizes.some(q=>p.rank>=q.rankFrom&&p.rank<=q.rankTo))&&s.ranking.some(p=>!s.draws.some(d=>d.rank===p.rank));
    return false;
  }
  async function hostAction(kind,input={}){
    const ctx=current,s=view.snapshot;if(!canHostAction(kind,input.id))fail('action_not_allowed');
    if(kind==='prizeSave'&&input.expectedPrizes!==undefined&&input.expectedPrizes!==JSON.stringify(s.prizes))fail('prize_draft_conflict');
    let fields={};
    if(kind==='prizeSave'){let p;try{p=planPrize(s,input);}catch(e){fail(e.message);}fields={p_id:p.id,p_name:p.name,p_quantity:p.quantity,p_from:p.rankFrom,p_to:p.rankTo};}
    else if(kind==='prizeDelete')fields={p_id:input.id};
    else if(kind==='tieDraw')fields={p_score:s.ties.group.score};
    const eventId=uuid();savePending(ctx,{eventId,kind});set({busy:true,error:null});
    try{
      const response=await rpc(ctx,RPC[kind],{p_room:c.roomId,p_revision:s.revision,p_event:eventId,...fields});
      if(response.data?.eventId!==eventId||response.data?.status!=='committed')fail('receipt_mismatch');
      savePending(ctx,null);await snapshot(ctx);return response.data;
    }catch(e){if(valid(ctx)){if(e.definite)savePending(ctx,null);set({lastUpdate:0,error:e.code||'network_unknown'});if(e.auth){try{await refreshContext(ctx);await snapshot(ctx);e=new PartyError('auth_refreshed_no_retry');}catch{e=new PartyError('session_expired');}}}throw new PartyError(e.code||'network_unknown');}
    finally{if(valid(ctx))set({busy:false});}
  }
  async function mutate(kind,extra={}){
    const ctx=current,s=view.snapshot;
    if(kind==='answer'?!canAnswer():!canCommand(kind,extra.stopped))fail('action_not_allowed');
    if(kind==='answer'&&(!Number.isInteger(extra.choice)||extra.choice<0||extra.choice>3))fail('action_not_allowed');
    const eventId=uuid(),p={eventId,kind};savePending(ctx,p);set({busy:true,error:null});
    const args={p_room:c.roomId,p_epoch:s.epoch,p_revision:s.revision,p_question:kind==='start'?null:kind==='answer'?s.question.id:s.host?.questionId,p_event:eventId};
    if(!args.p_question&&kind!=='start'){savePending(ctx,null);set({busy:false});fail('contract_mismatch');}
    try{
      const response=await rpc(ctx,kind==='answer'?RPC.answer:RPC.command,kind==='answer'?{...args,p_choice:extra.choice}:{...args,p_command:kind,p_stopped:kind==='open'&&extra.stopped===true});
      if(response.data?.eventId!==eventId||response.data?.status!=='committed')fail('receipt_mismatch');
      savePending(ctx,null);await snapshot(ctx);return response.data;
    }catch(e){if(valid(ctx)){if(e.definite)savePending(ctx,null);set({lastUpdate:0,error:e.code||'network_unknown'});if(e.auth){try{await refreshContext(ctx);await snapshot(ctx);e=new PartyError('auth_refreshed_no_retry');}catch{e=new PartyError('session_expired');}}}throw new PartyError(e.code||'network_unknown');}
    finally{if(valid(ctx))set({busy:false});}
  }
  async function reconcile(){
    const ctx=current,p=view.pending;if(!ctx?.uid||!p||view.busy)fail('action_not_allowed');set({busy:true});
    try{const response=await rpc(ctx,RPC.receipt,{p_room:c.roomId,p_event:p.eventId});if(response.data?.eventId!==p.eventId||!['unknown','committed'].includes(response.data.status))fail('receipt_mismatch');if(response.data.status==='committed'){savePending(ctx,null);await snapshot(ctx);}return response.data.status;}
    catch(e){if(valid(ctx))set({error:e.code||'network_unknown',lastUpdate:0});throw new PartyError(e.code||'network_unknown');}finally{if(valid(ctx))set({busy:false});}
  }
  async function logout(){const p=!current?saved():null;if(p){eraseSaved({remember:true,namespace:p.namespace});}const old=clearLocal(null);if(!old)return {status:'local_only'};try{const result=await old.client.auth.signOut({scope:'local'});return {status:result.error?'server_unconfirmed':'signed_out'};}catch{return {status:'server_unconfirmed'};}finally{old.shadow.clear();}}
  async function refresh(){const ctx=current;if(!ctx?.uid)fail('action_not_allowed');await refreshContext(ctx);await snapshot(ctx);return getState();}
  return Object.freeze({resume,hasSavedSession:()=>!!saved(),dispose:()=>{clearLocal(null,true);},loginHost:credentials=>login('host',credentials),joinPlayer:credentials=>login('player',credentials),poll,refresh,logout,command:(kind,stopped=false)=>mutate(kind,{stopped}),hostAction,canHostAction,answer:choice=>mutate('answer',{choice}),reconcile,getState,canAnswer,canCommand,serverNow,isFresh:fresh});
}
