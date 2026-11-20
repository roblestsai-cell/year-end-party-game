import { createApi, createClock, phaseOf, playerUrl } from './api.js';

const $ = (s) => document.querySelector(s);

let api, clock;
let room = null;
let starting = false;
let lastRoster = '';

async function refresh() {
  try { room = await api.getRoom(); render(); } catch { /* 輪詢會再試 */ }
}

async function loadPlayers() {
  try {
    const list = await api.listPlayers();
    const key = list.map((p) => p.id).join(',');
    if (key === lastRoster) return;
    lastRoster = key;
    $('#count').textContent = String(list.length);
    const ol = $('#players');
    ol.replaceChildren(...list.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.name;
      return li;
    }));
  } catch { /* 下次再試 */ }
}

function render() {
  if (!room) return;
  const now = clock.now();
  const phase = phaseOf(room, now);
  const btn = $('#start');
  let big = '', status = '';

  if (phase === 'idle') {
    big = '準備開始';
    status = '按下「開始倒數」，5 秒後開放玩家搶答';
  } else if (phase === 'countdown') {
    big = String(Math.ceil((room.opensAt - now) / 1000));
    status = '倒數中…';
  } else if (phase === 'open') {
    big = '搶答開放！';
    status = '等待最快的玩家…';
  } else {
    big = room.winnerName;
    status = '🏆 最快搶答';
  }

  $('#round').textContent = room.round ? `第 ${room.round} 輪` : '';
  $('#big').textContent = big;
  $('#status').textContent = status;
  btn.textContent = room.round ? '下一輪：開始倒數' : '開始倒數';
  btn.disabled = starting || phase === 'countdown';
  document.body.dataset.phase = phase;
}

function renderQr() {
  const url = playerUrl();
  const link = $('#player-link');
  link.href = url;
  link.textContent = url;
  if (typeof window.qrcode !== 'function') return;
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const img = document.createElement('img');
  img.src = qr.createDataURL(8, 8);
  img.alt = '玩家加入 QR Code';
  $('#qr').replaceChildren(img);
}

async function enter() {
  $('#login').hidden = true;
  $('#console').hidden = false;
  renderQr();
  await clock.sync();
  api.subscribe((r) => { room = r; render(); }, loadPlayers);
  await Promise.all([refresh(), loadPlayers()]);
  setInterval(refresh, 2000);
  setInterval(loadPlayers, 3000);
  setInterval(() => clock.sync(), 30000);
  setInterval(render, 100);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { clock.sync(); refresh(); loadPlayers(); }
  });
}

async function init() {
  try {
    api = await createApi();
  } catch {
    $('#loading').innerHTML = '<p class="error">無法連線，請重新整理頁面</p>';
    return;
  }
  clock = createClock(api);
  if (api.mock) $('#mock-banner').hidden = false;
  $('#loading').hidden = true;

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    try {
      await api.signIn($('#email').value.trim(), $('#password').value);
      $('#password').value = '';
      enter();
    } catch {
      err.textContent = '登入失敗：帳號或密碼錯誤';
      err.hidden = false;
    }
  });

  $('#start').addEventListener('click', async () => {
    starting = true;
    render();
    try { await api.startRound(); } catch { alert('開始失敗，請檢查網路後再按一次'); }
    starting = false;
    await refresh();
  });

  $('#clear').addEventListener('click', async () => {
    if (!confirm('確定清空所有玩家？玩家需要重新輸入姓名，輪次也會歸零。')) return;
    try { await api.clearPlayers(); } catch { alert('清空失敗，請再試一次'); }
    lastRoster = '';
    await Promise.all([refresh(), loadPlayers()]);
  });

  $('#logout').addEventListener('click', async () => {
    await api.signOut();
    location.reload();
  });

  if (await api.getSession()) enter();
  else $('#login').hidden = false;
}

init();
