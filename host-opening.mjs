// Local, user-approved opening audio only. Never changes game state or sends RPCs.
export function mountHostOpening({getState,doc=document,win=window}) {
  const $=id=>doc.getElementById(id), panel=$('hostOpening'), audio=$('openingAudio');
  const play=$('openingPlay'), pause=$('openingPause'), restart=$('openingRestart');
  const status=$('openingStatus'), volume=$('openingVolume');
  const source='./media/party-opening-20261113.mp3';
  let generation=0, loading=false, state='idle', disposed=false, loaded=false, wantsPlay=false;
  const allowed=()=>{const v=getState();return !disposed&&!doc.hidden&&v?.role==='host'&&v?.status==='connected'&&v?.snapshot?.role==='host';};
  const labels={idle:'開場音訊已就緒，按下播放才會出聲。',loading:'正在載入開場音訊…',playing:'開場播放中。',paused:'開場已暫停，按播放可接續。',ended:'開場播放完畢，可按從頭重播。',error:'開場未能播放，請確認裝置音量與連線，再按播放重試。'};
  function render(){
    const ok=allowed();panel.hidden=!ok;play.disabled=!ok||loading||state==='playing';
    pause.disabled=!ok||(!loading&&state!=='playing');restart.disabled=!ok||loading;
    volume.disabled=!ok;status.textContent=labels[state]||labels.idle;
  }
  function halt({unload=false,reset=false}={}){
    generation++;loading=false;wantsPlay=false;audio.pause();
    if(reset){try{audio.currentTime=0;}catch{}}
    state=reset?'idle':state==='ended'?'ended':'paused';
    if(unload&&loaded){audio.removeAttribute('src');audio.load();loaded=false;state='idle';}
    render();
  }
  async function begin(fromStart=false){
    if(!allowed()||loading)return;
    if(fromStart){audio.pause();try{audio.currentTime=0;}catch{}}
    const retry=state==='error',g=++generation;loading=true;wantsPlay=true;state='loading';render();
    if(!loaded){audio.src=source;loaded=true;}else if(retry)audio.load();
    try{
      await audio.play();
      if(g!==generation)return; // A later pause/logout owns media and state.
      if(!allowed()){halt({unload:true,reset:true});return;}
      loading=false;state='playing';render();
    }catch{
      if(g!==generation)return;
      loading=false;wantsPlay=false;state='error';audio.pause();render();
    }
  }
  const onPlaying=()=>{if(!wantsPlay){audio.pause();return;}if(!allowed()){halt({unload:true,reset:true});return;}if(!loading){state='playing';render();}};
  const onPause=()=>{if(!loading&&state==='playing'){state='paused';render();}};
  const onEnded=()=>{generation++;loading=false;wantsPlay=false;state='ended';render();};
  const onError=()=>{if(!loaded)return;generation++;loading=false;wantsPlay=false;state='error';audio.pause();render();};
  const hide=()=>{if(doc.hidden)halt();};
  const leave=()=>halt({unload:true,reset:true});
  const onPlay=()=>begin(),onRestart=()=>begin(true),onPauseClick=()=>halt();
  const onVolume=()=>{const v=Number(volume.value);if(Number.isFinite(v)&&v>=0&&v<=1)audio.volume=v;};
  audio.preload='none';audio.volume=.8;volume.value='.8';
  play.addEventListener('click',onPlay);restart.addEventListener('click',onRestart);pause.addEventListener('click',onPauseClick);volume.addEventListener('input',onVolume);
  for(const [event,handler] of [['playing',onPlaying],['pause',onPause],['ended',onEnded],['error',onError]])audio.addEventListener(event,handler);
  doc.addEventListener('visibilitychange',hide);win.addEventListener('pagehide',leave);
  function sync(){if(!allowed()&&(loaded||loading))halt({unload:true,reset:true});else render();}
  function dispose(){if(disposed)return;leave();disposed=true;play.removeEventListener('click',onPlay);restart.removeEventListener('click',onRestart);pause.removeEventListener('click',onPauseClick);volume.removeEventListener('input',onVolume);for(const [event,handler] of [['playing',onPlaying],['pause',onPause],['ended',onEnded],['error',onError]])audio.removeEventListener(event,handler);doc.removeEventListener('visibilitychange',hide);win.removeEventListener('pagehide',leave);render();}
  sync();return Object.freeze({sync,stop:leave,dispose});
}
