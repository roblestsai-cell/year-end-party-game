// Candidate only. The surrounding adapter owns consent, context isolation and room authorization.
// This module never reads storage, logs credentials, retries passwords or creates users.
export const HOST_LOGIN_CONTRACT = 'party-host-login-v1';
export const HOST_LOGIN_PATH = '/functions/v1/party-host-login';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = code => { const e = new Error(code); e.code = code; throw e; };
const record = (x, keys) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x,k));
const token = x => typeof x === 'string' && x.length >= 16 && x.length <= 16384 && !/\s/.test(x);
// Refresh tokens are opaque; supported legacy values are only 12 characters long.
const refreshToken = x => typeof x === 'string' && x.length > 0 && x.length <= 16384 && /^[!-~]+$/.test(x);

export async function signInHost({client, credentials, fetchImpl, projectUrl, publishableKey, roomId, assertCurrent, now = Date.now, uuid = () => crypto.randomUUID()}) {
  // No default fetch: callers must supply their generation/abort/destination-guarded fetch.
  if (typeof fetchImpl !== 'function' || typeof assertCurrent !== 'function' || typeof client?.auth?.setSession !== 'function') failure('configuration_required');
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(projectUrl) || !/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(publishableKey) || !UUID.test(roomId)) failure('configuration_required');
  if (credentials?.username !== 'admin' || typeof credentials.password !== 'string' || !credentials.password || new TextEncoder().encode(credentials.password).length > 1024) failure('authentication_failed');
  assertCurrent();
  const requestId = uuid(), issuedAt = now();
  if (!UUID.test(requestId) || !Number.isSafeInteger(issuedAt)) failure('configuration_required');
  let response;
  try {
    response = await fetchImpl(projectUrl + HOST_LOGIN_PATH, {
      method:'POST', headers:{'content-type':'application/json', apikey:publishableKey},
      credentials:'omit', cache:'no-store', redirect:'error',
      body:JSON.stringify({username:'admin',password:credentials.password,roomId,requestId,issuedAt})
    });
  } catch { assertCurrent(); failure('network_unknown'); }
  assertCurrent();
  if (response.redirected) failure('network_destination_blocked');
  if (!response.ok) failure(response.status === 429 ? 'login_rate_limited' : response.status >= 500 ? 'host_login_unavailable' : 'authentication_failed');
  let data;
  try { data = await response.json(); } catch { failure('authentication_failed'); }
  assertCurrent();
  if (!record(data,['contract','requestId','issuedAt','expiresAt','access_token','refresh_token','userId','roomId']) || data.contract !== HOST_LOGIN_CONTRACT || data.requestId !== requestId || data.roomId !== roomId || !UUID.test(data.userId) || !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.expiresAt) || data.issuedAt < issuedAt - 10000 || data.issuedAt > now() + 10000 || data.expiresAt <= now() || data.expiresAt > data.issuedAt + 30000 || !token(data.access_token) || !refreshToken(data.refresh_token)) failure('authentication_failed');
  // These are real Supabase bearer tokens. Their JWT/user data can include the host email.
  // Do not represent the alias as hiding email from a successfully authenticated browser.
  const pair = {access_token:data.access_token, refresh_token:data.refresh_token};
  const expectedUid = data.userId;
  data = null;
  assertCurrent();
  let result;
  try { result = await client.auth.setSession(pair); }
  catch { assertCurrent(); failure('authentication_failed'); }
  finally { pair.access_token = ''; pair.refresh_token = ''; }
  // Owner adapter must destroy this context and stop refresh on cancellation. Never attach
  // its SDK client/storage namespace to a newer login, even if setSession finishes late.
  assertCurrent();
  if (result.error || result.data?.session?.user?.id !== expectedUid || result.data.session.user.is_anonymous !== false) failure('authentication_failed');
  return result;
}
