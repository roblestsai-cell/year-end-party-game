// Isolated invite/recovery landing flow. No room access and no persistent storage.
export const PASSWORD_PROJECT='https://qujufxbnciniiauvhfun.supabase.co';
export const PASSWORD_CALLBACK='https://roblestsai-cell.github.io/year-end-party-game/set-password.html';
export const PASSWORD_LOGIN='https://roblestsai-cell.github.io/year-end-party-game/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=code=>{const e=new Error(code);e.code=code;throw e;};

export function parsePasswordLanding({hash='',search='',pageUrl,framed=false},now=Date.now()){
  if(framed || pageUrl!==PASSWORD_CALLBACK)fail('wrong_page');
  // This page starts no PKCE flow and has no legitimate stored code_verifier.
  // Never guess it or exchange a caller-supplied query code/token_hash.
  if(search)fail('unsupported_link');
  if(typeof hash!=='string'||hash.length>40000||!hash.startsWith('#'))fail('invalid_link');
  const params=new URLSearchParams(hash.slice(1));
  const allowed=new Set(['access_token','refresh_token','token_type','type','expires_in','expires_at','sb']);
  for(const k of params.keys())if(!allowed.has(k)||params.getAll(k).length!==1)fail('invalid_link');
  // Official Supabase Auth redirects include an empty sb identifier.
  if(params.has('sb')&&params.get('sb')!=='')fail('invalid_link');
  if(!['invite','recovery'].includes(params.get('type'))||params.get('token_type')!=='bearer')fail('invalid_link');
  const access_token=params.get('access_token'),refresh_token=params.get('refresh_token');
  if(typeof access_token!=='string'||access_token.length>16384||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access_token)||typeof refresh_token!=='string'||!refresh_token||refresh_token.length>16384||!/^[!-~]+$/.test(refresh_token))fail('invalid_link');
  let claims;
  try{claims=JSON.parse(atob(access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{fail('invalid_link');}
  // Only a structural precheck. Official same-project getUser verifies this JWT.
  // Supabase's implicit email verification issues OTP AMR for invite/recovery.
  if(claims.iss!==PASSWORD_PROJECT+'/auth/v1'||claims.aud!=='authenticated'||claims.role!=='authenticated'||claims.is_anonymous!==false||!UUID.test(claims.sub)||!UUID.test(claims.session_id)||!Number.isInteger(claims.exp)||!Number.isInteger(claims.iat)||claims.iat*1000>now+10000||!Array.isArray(claims.amr)||!claims.amr.some(x=>['otp','invite','recovery'].includes(x?.method)))fail('invalid_link');
  // Do not revive expired/near-expiry links using refresh tokens. No refresh route exists.
  if(claims.exp*1000<=now+120000)fail('expired_link');
  return {access_token,refresh_token,uid:claims.sub,expiresAt:claims.exp*1000-90000,type:params.get('type')};
}

export function createPasswordSetup({config,createClient,fetchImpl,now=Date.now,onState=()=>{}}){
  if(config?.projectUrl!==PASSWORD_PROJECT||config?.callbackUrl!==PASSWORD_CALLBACK||config?.loginUrl!==PASSWORD_LOGIN||!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(config?.publishableKey)||typeof createClient!=='function'||typeof fetchImpl!=='function')fail('configuration_required');
  let client=null,active=true,generation=0,uid=null,expiresAt=0,phase='idle',initializing=null,saving=null;
  const storage=new Map(),controllers=new Set();
  const memory={getItem:k=>active?(storage.get(k)??null):null,setItem:(k,v)=>{if(active)storage.set(k,v);},removeItem:k=>storage.delete(k)};
  const set=(p,error=null)=>{phase=p;onState({phase:p,error});};
  const assert=g=>{if(!active||g!==generation)fail('cancelled');};
  const guardedFetch=async(input,init={})=>{
    if(!active)fail('cancelled');
    const u=new URL(typeof input==='string'?input:input.url),method=(init.method||'GET').toUpperCase();
    const allowed=(u.pathname==='/auth/v1/user'&&!u.search&&['GET','PUT'].includes(method))||(u.pathname==='/auth/v1/logout'&&u.search==='?scope=local'&&method==='POST');
    if(u.origin!==PASSWORD_PROJECT||!allowed||u.hash||u.username||u.password)fail('destination_blocked');
    // Only explicit submit may write. Initialization/user verification cannot update passwords.
    if(method==='PUT'&&phase!=='saving')fail('action_not_allowed');
    const controller=new AbortController();controllers.add(controller);
    try{
      const signals=[controller.signal,AbortSignal.timeout(6000)];if(init.signal)signals.push(init.signal);
      const response=await fetchImpl(input,{...init,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any(signals)});
      if(response.redirected)fail('destination_blocked');
      return response;
    }finally{controllers.delete(controller);}
  };
  async function clearSession(){
    const old=client,g=generation;let confirmed=false;
    if(old){old.auth.stopAutoRefresh();try{const result=await old.auth.signOut({scope:'local'});confirmed=!result.error;}catch{}}
    // An external pagehide/cancel must stay closed even when logout returns late.
    // Check before this cleanup's own generation increment.
    assert(g);
    active=false;generation++;uid=null;expiresAt=0;controllers.forEach(c=>c.abort());controllers.clear();storage.clear();client=null;
    return confirmed;
  }
  async function begin(landing){
    if(initializing)return initializing;if(phase!=='idle')fail('action_not_allowed');
    const g=generation;set('verifying');
    initializing=(async()=>{
      let parsed;
      try{
        parsed=parsePasswordLanding(landing,now());
        client=createClient(PASSWORD_PROJECT,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,flowType:'implicit',storage:memory,storageKey:'party-password-'+crypto.randomUUID(),debug:false},global:{fetch:guardedFetch}});
        const session=await client.auth.setSession({access_token:parsed.access_token,refresh_token:parsed.refresh_token});assert(g);
        if(session.error||session.data?.session?.user?.id!==parsed.uid||session.data.session.user.is_anonymous!==false)fail('invalid_link');
        const verified=await client.auth.getUser();assert(g);
        if(verified.error||verified.data?.user?.id!==parsed.uid||verified.data.user.is_anonymous!==false)fail('invalid_link');
        uid=parsed.uid;expiresAt=parsed.expiresAt;set('ready');return {phase:'ready'};
      }catch(e){if(active&&g===generation){await clearSession();set('invalid',e.code==='expired_link'?'expired_link':e.code==='unsupported_link'?'unsupported_link':'invalid_link');}throw Object.assign(new Error('invalid_link'),{code:e.code||'invalid_link'});}
      finally{if(parsed){parsed.access_token='';parsed.refresh_token='';}landing.hash='';landing.search='';}
    })();return initializing;
  }
  async function submit({password,confirmation,consent=false}={}){
    if(saving)return saving;
    if(!active||phase!=='ready'||!uid)fail('action_not_allowed');
    if(now()>=expiresAt){await clearSession();set('invalid','expired_link');fail('expired_link');}
    if(consent!==true)fail('consent_required');
    if(typeof password!=='string'||[...password].length<12||new TextEncoder().encode(password).length>72)fail('password_requirements');
    if(password!==confirmation)fail('password_mismatch');
    const g=generation;set('saving');
    saving=(async()=>{
      try{
        // Verify identity again immediately before the explicit user-requested update.
        const verified=await client.auth.getUser();assert(g);
        if(verified.error||verified.data?.user?.id!==uid||verified.data.user.is_anonymous!==false)fail('invalid_link');
        const result=await client.auth.updateUser({password});password='';confirmation='';assert(g);
        if(result.error){
          const status=result.error.status;
          if(Number.isFinite(status)&&status>=400&&status<500&&![408,429].includes(status))fail('password_rejected');
          fail('update_unknown');
        }
        if(result.data?.user?.id!==uid||result.data.user.is_anonymous!==false)fail('update_unknown');
        const logoutConfirmed=await clearSession();set('complete');return {phase:'complete',logoutConfirmed,loginUrl:PASSWORD_LOGIN};
      }catch(e){
        password='';confirmation='';
        if(!active||g!==generation)throw Object.assign(new Error('cancelled'),{code:'cancelled'});
        // No automatic repeat. An uncertain response may already have changed the password.
        if(e.code==='password_rejected'){set('ready','password_rejected');throw e;}
        await clearSession();set('invalid',e.code==='invalid_link'?'invalid_link':'update_unknown');
        throw Object.assign(new Error(e.code||'update_unknown'),{code:e.code||'update_unknown'});
      }finally{saving=null;}
    })();return saving;
  }
  function dispose(){active=false;generation++;phase='closed';uid=null;expiresAt=0;controllers.forEach(c=>c.abort());controllers.clear();client?.auth.stopAutoRefresh();storage.clear();client=null;}
  return Object.freeze({begin,submit,dispose,state:()=>({phase}),loginUrl:PASSWORD_LOGIN});
}
