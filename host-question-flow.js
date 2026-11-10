// External-v1 requires reveal before next; suppress that intermediate answer.
export function createHostQuestionFlow({adapter,onChange=()=>{}}){
  let active=false,generation=0,suppressed=null,observed=null;
  const identity=s=>s&&Number.isSafeInteger(s.epoch)&&s.host?.questionId?JSON.stringify([s.epoch,s.host.questionId,s.index??null]):null;
  const current=()=>{const v=adapter.getState();return v.role==='host'?identity(v.snapshot):null;};
  function sync(){const id=current();if(id!==observed){observed=id;generation++;suppressed=null;}}
  const allowed=()=>{const v=adapter.getState();return v.role==='host'&&v.status==='connected'&&!v.busy&&!v.pending&&adapter.isFresh();};
  const error=code=>Object.assign(new Error(code),{code});
  const canNext=()=>!active&&allowed()&&(adapter.canCommand('next')||adapter.canCommand('reveal'));
  const canReveal=()=>!active&&allowed()&&(adapter.canCommand('reveal')||(adapter.getState().snapshot?.phase==='revealed'&&suppressed===current()));
  function assertFence(id,token){sync();if(generation!==token||current()!==id)throw error('question_changed');if(!allowed())throw error('action_not_allowed');}
  async function next(){
    sync();if(!canNext())throw error('action_not_allowed');
    const id=current(),token=generation;if(!id)throw error('action_not_allowed');
    active=true;
    // Set before command(): adapter emits revealed snapshots synchronously.
    if(adapter.getState().snapshot.phase!=='revealed')suppressed=id;
    onChange();
    try{
      if(adapter.getState().snapshot.phase!=='revealed'){
        const receipt=await adapter.command('reveal');
        if(receipt?.status!=='committed')throw error('receipt_mismatch');
      }
      assertFence(id,token);
      if(!adapter.canCommand('next'))throw error('action_not_allowed');
      // No asynchronous gap before the adapter's own revision fence.
      return await adapter.command('next');
    }finally{active=false;sync();onChange();}
  }
  async function reveal(){
    sync();if(!canReveal())throw error('action_not_allowed');
    if(adapter.getState().snapshot.phase==='revealed'){suppressed=null;onChange();return {status:'already_revealed'};}
    active=true;suppressed=null;onChange();
    try{return await adapter.command('reveal');}finally{active=false;sync();onChange();}
  }
  function isRevealSuppressed(snapshot=adapter.getState().snapshot){sync();return suppressed!==null&&identity(snapshot)===suppressed;}
  sync();return Object.freeze({sync,canNext,next,canReveal,reveal,isRevealSuppressed,get busy(){return active;}});
}
