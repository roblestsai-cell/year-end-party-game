import {passwordConfig} from './set-password-config.js';
import {createPasswordSetup,PASSWORD_LOGIN} from './set-password.js';
const status=document.getElementById('status'),form=document.getElementById('passwordForm'),password=document.getElementById('newPassword'),confirm=document.getElementById('confirmPassword'),consent=document.getElementById('consent'),submit=document.getElementById('savePassword'),back=document.getElementById('backToLogin');
const messages={invalid_link:'這個邀請或重設密碼連結無效，請重新開啟最新的電子郵件連結。',expired_link:'連結已到期或即將到期，請聯絡活動管理者取得新的連結。',unsupported_link:'此連結不是支援的邀請格式，請聯絡活動管理者重新寄送。',password_requirements:'請使用至少 12 個字元，且不要超過 72 個 UTF-8 位元組。',password_mismatch:'兩次輸入的密碼不相同。',consent_required:'請先確認密碼的傳送用途。',password_rejected:'密碼未被接受，請換一組較強的密碼。若仍無法設定，請聯絡活動管理者。',update_unknown:'目前無法確認密碼是否已更新。請勿重複送出，請關閉此頁並聯絡活動管理者確認。',configuration_required:'設定密碼頁尚未設定完成，請聯絡活動管理者。'};
let setup=null,pageGeneration=0,pageActive=true;
function clearFields(){password.value='';confirm.value='';consent.checked=false;}
function render({phase,error}){
  form.hidden=!['ready','saving'].includes(phase);submit.disabled=phase!=='ready';password.disabled=confirm.disabled=consent.disabled=phase!=='ready';
  status.textContent=error?(messages[error]||messages.invalid_link):({verifying:'正在驗證邀請連結…',ready:'連結已驗證。請自行設定帳號密碼。',saving:'正在更新密碼，請勿重複送出…',complete:'密碼已設定，可關閉此頁；主持入口完成後會另行通知。'}[phase]||messages.invalid_link);
}
function close(){pageGeneration++;pageActive=false;clearFields();setup?.dispose();}
window.addEventListener('pagehide',close);
window.addEventListener('pageshow',event=>{if(event.persisted){close();render({phase:'invalid',error:'invalid_link'});}});
back.href=PASSWORD_LOGIN;back.addEventListener('click',close);
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!setup||submit.disabled||!pageActive)return;
  const generation=pageGeneration;
  const values={password:password.value,confirmation:confirm.value,consent:consent.checked};clearFields();
  try{
    const result=await setup.submit(values);values.password='';values.confirmation='';
    if(!pageActive||generation!==pageGeneration)return;
    if(result.phase==='complete'){
      if(!result.logoutConfirmed)status.textContent='密碼已設定，暫時登入已從此頁清除；伺服器登出未確認，請關閉此頁。主持入口完成後會另行通知。';
    }
  }catch(e){values.password='';values.confirmation='';if(pageActive&&generation===pageGeneration&&e.code!=='cancelled')status.textContent=messages[e.code]||messages.invalid_link;}
});
let landing;
try{
  landing=window.__partyPasswordLanding?.take();delete window.__partyPasswordLanding;
  if(!landing||landing.failed)throw Error('invalid_link');
  setup=createPasswordSetup({config:passwordConfig,createClient:window.supabase?.createClient,fetchImpl:window.fetch.bind(window),onState:state=>{if(pageActive)render(state);}});
  await setup.begin(landing);
}catch(e){clearFields();if(pageActive)render({phase:'invalid',error:e.code||'invalid_link'});}
finally{if(landing){landing.hash='';landing.search='';}landing=null;}
