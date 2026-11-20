import { createApi, createClock, phaseOf } from './api.js';

const $ = (s) => document.querySelector(s);
const STORE = 'buzzer-player-v1';

function loadMe() { try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; } }
function saveMe(v) {
  try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch { /* 無痕模式 */ }
}

let api, clock;
let me = loadMe();      // { playerId, token, name }
let room = null;
let myPress = null;     // { round, status: 'pending' | 'won' | 'late' }

function show() {
  $('#loading').hidden = true;
  $('#join').hidden = !!me;
  $('#game').hidden = !me;
  if (me) $('#me').textContent = me.name;
  else setTimeout(() => $('#name').focus(), 0);
}

function note(text) {
  const el = $('#note');
  el.textContent = text;
  el.hidden = !text;
  if (text) setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 3000);
}

function forget() {
  me = null;
  myPress = null;
  saveMe(null);
  show();
}

async function recheck() {
  if (!me) return;
  try { if ((await api.whoami(me.token)) === null) forget(); } catch { /* 下次再查 */ }
}

function setRoom(r) {
  if (!r) return;
  // 主持人清空名單時輪次會歸零，確認自己是否還在名單中
  if (room && r.round < room.round) recheck();
  room = r;
  render();
}

async function refresh() {
  try { setRoom(await api.getRoom()); } catch { /* 輪詢會再試 */ }
}

function render() {
  if (!me || !room) return;
  const now = clock.now();
  const phase = phaseOf(room, now);
  const mine = myPress && myPress.round === room.round ? myPress.status : null;
  const btn = $('#buzz');
  let big = '', status = '', enabled = false, label = '搶答';

  if (phase === 'idle') {
    status = '等待主持人開始';
  } else if (phase === 'countdown') {
    big = String(Math.ceil((room.opensAt - now) / 1000));
    status = '準備…';
  } else if (phase === 'open') {
    if (mine === 'pending') { status = '送出中…'; label = '送出中…'; }
    else if (mine === 'late') { status = '慢了一步！'; }
    else { status = '開放搶答！'; enabled = true; label = '搶答！'; }
  } else if (room.winnerPlayer === me.playerId) {
    big = '🏆';
    status = '你搶到了！';
  } else {
    status = '慢了一步，本輪已有人搶到';
  }

  $('#big').textContent = big;
  $('#status').textContent = status;
  btn.textContent = label;
  btn.disabled = !enabled;
  btn.dataset.phase = phase;
  document.body.dataset.phase = phase;
}

async function press() {
  if (!me || !room || $('#buzz').disabled) return;
  const round = room.round;
  myPress = { round, status: 'pending' };
  render();
  try {
    const res = await api.buzz(me.token, round);
    if (res === 'invalid') { forget(); note('主持人已重設名單，請重新輸入姓名'); return; }
    if (res === 'won' || res === 'late') myPress = { round, status: res };
    else myPress = null; // too_early / not_open / stale：時鐘有誤差，讓玩家可以再按
    if (res === 'too_early') note('還沒開放，請稍等');
    refresh();
  } catch {
    myPress = null;
    note('網路不穩，請再按一次');
  }
  render();
}

async function onJoin(e) {
  e.preventDefault();
  const name = $('#name').value.trim();
  const err = $('#join-error');
  err.hidden = true;
  if (!name) return;
  const btn = e.submitter || $('#join-form button');
  btn.disabled = true;
  try {
    me = await api.join(name);
    saveMe(me);
    show();
    render();
  } catch {
    err.textContent = '加入失敗，請檢查網路後再試一次';
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  try {
    api = await createApi();
  } catch (e) {
    $('#loading').innerHTML = '<p class="error">無法連線，請重新整理頁面</p>';
    return;
  }
  clock = createClock(api);
  if (api.mock) $('#mock-banner').hidden = false;

  $('#join-form').addEventListener('submit', onJoin);
  const btn = $('#buzz');
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  btn.addEventListener('click', (e) => { if (e.detail === 0) press(); }); // 鍵盤

  await clock.sync();
  if (me) {
    try {
      const who = await api.whoami(me.token);
      if (who === null) { me = null; saveMe(null); } else { me.name = who.name; }
    } catch { /* 網路問題就先沿用本機資料 */ }
  }
  show();

  api.subscribe(setRoom);
  await refresh();
  setInterval(refresh, 2000);
  setInterval(() => clock.sync(), 30000);
  setInterval(render, 100);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { clock.sync(); refresh(); recheck(); }
  });
}

init();
