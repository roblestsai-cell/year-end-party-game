// 模擬後端：資料存在這台電腦瀏覽器的 localStorage，用 BroadcastChannel 在分頁之間同步。
// 只供本機測試，規則與 schema.sql 的函式相同。
const KEY = 'buzzer-mock-v1';
const bc = new BroadcastChannel('buzzer-mock');
const listeners = new Set();

const fresh = () => ({ room: { round: 0, opensAt: null, winnerPlayer: null, winnerName: null }, players: [] });
function state() {
  try { return JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { return fresh(); }
}
function emit() { const s = state(); listeners.forEach((l) => l(s)); }
function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); bc.postMessage('changed'); emit(); }
bc.onmessage = emit;

const latency = () => new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
const isHost = () => sessionStorage.getItem('buzzer-mock-host') === '1';
function requireHost() { if (!isHost()) throw new Error('host_only'); }

export function create() {
  return {
    async serverNow() { return Date.now(); },
    async getRoom() { await latency(); return { ...state().room }; },
    async listPlayers() {
      await latency();
      return state().players.map(({ id, name, joinedAt }) => ({ id, name, joinedAt }));
    },
    async join(name) {
      await latency();
      const n = String(name ?? '').trim();
      if (!n || n.length > 20) throw new Error('name_invalid');
      const s = state();
      const p = { id: crypto.randomUUID(), token: crypto.randomUUID(), name: n, joinedAt: Date.now() };
      s.players.push(p);
      save(s);
      return { playerId: p.id, token: p.token, name: p.name };
    },
    async whoami(token) {
      const p = state().players.find((x) => x.token === token);
      return p ? { playerId: p.id, name: p.name } : null;
    },
    async buzz(token, round) {
      await latency();
      const s = state();
      const p = s.players.find((x) => x.token === token);
      if (!p) return 'invalid';
      const r = s.room;
      const now = Date.now();
      if (r.round !== round) return 'stale';
      if (r.opensAt == null) return 'not_open';
      if (r.opensAt > now) return 'too_early';
      if (!r.winnerPlayer) {
        r.winnerPlayer = p.id;
        r.winnerName = p.name;
        save(s);
        return 'won';
      }
      return r.winnerPlayer === p.id ? 'won' : 'late';
    },
    async startRound() {
      requireHost();
      await latency();
      const s = state();
      const now = Date.now();
      if (s.room.opensAt != null && s.room.opensAt > now) return;
      s.room = { round: s.room.round + 1, opensAt: now + 5000, winnerPlayer: null, winnerName: null };
      save(s);
    },
    async clearPlayers() { requireHost(); save(fresh()); },
    async signIn(email, password) {
      if (!email || !password) throw new Error('請輸入帳號和密碼');
      sessionStorage.setItem('buzzer-mock-host', '1');
    },
    async signOut() { sessionStorage.removeItem('buzzer-mock-host'); },
    async getSession() { return isHost() ? { mock: true } : null; },
    subscribe(onRoom, onPlayers) {
      const l = (s) => { onRoom({ ...s.room }); if (onPlayers) onPlayers(); };
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
