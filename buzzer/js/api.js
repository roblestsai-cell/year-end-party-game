import { config } from './config.js';

// 依設定選擇真實 Supabase 或模擬後端。網址加上 ?mock=1 會強制使用模擬模式。
export async function createApi() {
  const forceMock = new URLSearchParams(location.search).has('mock');
  const useMock = forceMock || !config.supabaseUrl || !config.supabaseAnonKey;
  const mod = useMock ? await import('./mock-api.js') : await import('./supabase-api.js');
  const api = mod.create(config);
  api.mock = useMock;
  return api;
}

// 以伺服器時間為準的時鐘：只用來顯示倒數，真正的判定在伺服器。
export function createClock(api) {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    async sync() {
      try {
        const t0 = Date.now();
        const server = await api.serverNow();
        const t1 = Date.now();
        offset = server - (t0 + t1) / 2;
      } catch { /* 保留上次的校正值 */ }
    },
  };
}

// 根據房間狀態算出目前階段：idle / countdown / open / done
export function phaseOf(room, now) {
  if (!room || !room.round || room.opensAt == null) return 'idle';
  if (room.winnerPlayer) return 'done';
  if (now < room.opensAt) return 'countdown';
  return 'open';
}

export function playerUrl() {
  const url = new URL('./', location.href);
  if (new URLSearchParams(location.search).has('mock')) url.search = '?mock=1';
  return url.href;
}
