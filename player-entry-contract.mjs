// Derived from the CC invite-link design; only exact e8 session metadata is read.
// No token reads, ticket generation, remote calls or storage writes.
export const validInvite = code => typeof code === 'string' && !!code.trim() && code.length <= 256 && !/[\u0000-\u001f\u007f]/.test(code);
export function readInviteFromHash(hash) {
  if (typeof hash !== 'string') return null;
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  if (p.getAll('join').length !== 1) return null;
  const code = p.get('join'); return validInvite(code) ? code : null;
}
export function readSavedRole(storage, config) {
  let raw; try { raw = storage.getItem('party-external-resume:' + config.projectUrl + ':' + config.roomId); }
  catch { throw Object.assign(Error('session_storage_unavailable'), {code:'session_storage_unavailable'}); }
  if (raw === null) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || Array.isArray(p) || Object.keys(p).length !== 2 || !Object.hasOwn(p,'namespace') || !Object.hasOwn(p,'role') ||
        !/^party-external-auth:[0-9a-f-]{36}$/i.test(p.namespace) || !['host','player'].includes(p.role)) throw Error();
    return p.role;
  } catch { throw Object.assign(Error('pending_storage_invalid'), {code:'pending_storage_invalid'}); }
}
export function legacyPlayerTarget(hash, savedRole, pageHref) {
  // Host takes precedence even if somebody pastes an invite into the host tab.
  if (savedRole === 'host') return null;
  const code = readInviteFromHash(hash);
  if (!code && savedRole !== 'player') return null;
  const u = new URL('player.html', pageHref);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname))) return null;
  u.search = ''; u.hash = code ? 'join=' + encodeURIComponent(code) : '';
  return u.href;
}
