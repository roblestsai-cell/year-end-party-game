# 尾牙搶答鈴

只有一個功能：主持人按「開始倒數」，5 秒後開放，玩家手機上最快按下搶答鈴的人顯示在主持人頁面。

| 頁面 | 網址（發布後） | 誰用 |
|---|---|---|
| 玩家頁 | `https://roblestsai-cell.github.io/year-end-party-game/buzzer/` | 玩家掃 QR 或開網址，輸入姓名即可 |
| 主持頁 | `https://roblestsai-cell.github.io/year-end-party-game/buzzer/host.html` | 主持人用 Email＋密碼登入 |

## 規則（由資料庫伺服器判定，不看手機時間）
- 按下「開始倒數」→ 進入新的一輪，伺服器時間 +5 秒後開放。
- 倒數中按鈴無效；開放後第一個有效按鈴者得主，該輪立刻鎖定，之後按的人都是「慢了一步」。
- 倒數中重複按「開始倒數」不會重來（防連點）；同一顆按鈕就是「下一輪」。
- 「清空名單」會刪除所有玩家並把輪次歸零，玩家需重新輸入姓名。

## 一次性設定（約 10 分鐘）
1. 到 <https://supabase.com> 建立一個**新的**專案（免費方案即可，區域選 Tokyo 或 Singapore）。不要用舊的 `year-end-party-sync-test-2027`。
2. 左側 **SQL Editor** → 新查詢 → 貼上 [`supabase/schema.sql`](supabase/schema.sql) 全部內容 → Run。
3. **Authentication → Sign In / Providers**：關閉「Allow new users to sign up」（只讓你手動建立的帳號能當主持人）。
4. **Authentication → Users → Add user**：建立主持人帳號（Email＋密碼，勾選 Auto Confirm）。
5. **Project Settings → API Keys**：複製 Project URL 和 publishable key，填進 [`js/config.js`](js/config.js)。
6. 發布到 GitHub Pages（推到 `main` 後，Pages 會自動部署）。

## 本機測試（不需要 Supabase）
`config.js` 留空或網址加 `?mock=1` 就會進入「模擬模式」：資料只存在這台電腦的瀏覽器，用不同分頁扮演主持人和玩家。

```
python -m http.server 8765
```
主持：<http://localhost:8765/buzzer/host.html?mock=1>（任何帳號密碼皆可）
玩家：<http://localhost:8765/buzzer/?mock=1>

## 檔案
- `index.html` / `js/player.js`：玩家頁
- `host.html` / `js/host.js`：主持頁（含 QR Code、名單）
- `js/api.js`：共用（選擇後端、伺服器時鐘校正）
- `js/supabase-api.js`：真實後端；`js/mock-api.js`：模擬後端
- `supabase/schema.sql`：資料表、權限、搶答函式
