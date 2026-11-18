// Public host notice and video previews only. No requests, auth, or draw logic.
export function mountOfficialLotteryReadiness({document: doc, adapter}) {
  let section = null;
  function stop() {
    if (!section) return;
    section.querySelectorAll('video').forEach(video => video.pause());
    section.remove();
    section = null;
  }
  function sync(state = adapter.getState()) {
    if (state?.role !== 'host' || state.status !== 'connected') { stop(); return; }
    if (section) return;
    const parent = doc.getElementById('session');
    if (!parent) return;
    section = doc.createElement('section');
    section.id = 'officialLotteryReadiness';
    section.setAttribute('aria-labelledby', 'officialLotteryReadinessTitle');
    const title = doc.createElement('h2');
    title.id = 'officialLotteryReadinessTitle';
    title.textContent = '隨機抽獎影片預覽';
    const notice = doc.createElement('p');
    notice.setAttribute('role', 'status');
    notice.textContent = '目前僅提供影片預覽。隨機抽獎尚未開放，播放不會選出得主或更動獎品。舊排名發獎不是隨機抽獎。';
    const disabled = doc.createElement('button');
    disabled.type = 'button';
    disabled.textContent = '隨機抽獎尚未開放';
    disabled.disabled = true;
    section.append(title, notice, disabled);
    for (const [label, path] of [['紙飛機','./media/paper-plane.mp4'],['扭蛋','./media/capsule.mp4']]) {
      const figure = doc.createElement('figure');
      const caption = doc.createElement('figcaption');
      caption.textContent = label + '（僅預覽）';
      const video = doc.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'none';
      video.width = 320;
      video.setAttribute('aria-label', caption.textContent);
      video.src = path;
      figure.append(caption, video);
      section.append(figure);
    }
    parent.append(section);
  }
  return Object.freeze({ sync, stop, dispose: stop });
}
