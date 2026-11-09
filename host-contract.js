export const HOST_CONTRACT='external-host-v2';
export const TIERS=Object.freeze(['頭獎','一獎','二獎','三獎','四獎','五獎','六獎','參加獎']);
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const record=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const integer=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
// Stored display strings can contain legacy whitespace/control characters. They are never HTML.
// PostgreSQL char_length counts Unicode code points, not JavaScript UTF-16 code units.
const text=(x,max=500)=>typeof x==='string'&&[...x].length<=max;
const array=(x,max=10000)=>Array.isArray(x)&&x.length<=max;
const unique=(x,key)=>new Set(x.map(p=>p[key])).size===x.length;
const person=x=>record(x,['id','name'])&&uuid(x.id)&&text(x.name,200)&&x.name.trim();
const people=x=>array(x)&&x.every(person)&&unique(x,'id');
export function safeSourceUrl(value){
 if(typeof value!=='string'||!value||value.length>2048||/[^!-~]|\\/.test(value)||!value.startsWith('https://'))return false;
 if(/[^A-Za-z0-9:/?#@!$&'()*+,;=._~%\[\]-]/.test(value)||value.replace(/%[0-9A-Fa-f]{2}/g,'').includes('%')||/%(0[0-9a-f]|1[0-9a-f]|20|7f|5c)/i.test(value))return false;
 const authority=value.slice(8).split(/[/?#]/)[0];if(!authority||/[@%\[\]]/.test(authority))return false;
 let hostname=authority;if(authority.includes(':')){if(!/^[^:]+:[1-9][0-9]{0,4}$/.test(authority))return false;const parts=authority.split(':');hostname=parts[0];if(Number(parts[1])>65535)return false;}
 const labels=hostname.split('.');if(hostname.length>253||!labels.every(label=>/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))||!/^[A-Za-z]/.test(labels.at(-1)))return false;
 try{const u=new URL(value);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}
}
export function validateHostFields(s){
 const bad=()=>{throw Error('contract_mismatch');};
 if(s.contract!==HOST_CONTRACT||s.role!=='host'||s.self!==null||s.awardMode!=='rank_assignment'||s.postAwardEditing!=='pending_confirmation_disabled'||typeof s.rankingFinal!=='boolean')bad();
 if(!array(s.roster)||!unique(s.roster,'id')||!s.roster.every(p=>record(p,['id','name','joinedSeq','status'])&&uuid(p.id)&&text(p.name,200)&&integer(p.joinedSeq)&&['joined','revoked','expired'].includes(p.status)))bad();
 if(s.reveal!==null&&!(record(s.reveal,['questionId','answerIndex','answerText','explanation'])&&uuid(s.reveal.questionId)&&integer(s.reveal.answerIndex,0,3)&&text(s.reveal.answerText,300)&&text(s.reveal.explanation,4000)&&s.phase==='revealed'&&s.question?.id===s.reveal.questionId&&s.question.options[s.reveal.answerIndex]===s.reveal.answerText))bad();
 if(!array(s.ranking,26)||!unique(s.ranking,'id')||!s.ranking.every((p,i)=>record(p,['id','name','score','rank'])&&uuid(p.id)&&text(p.name,200)&&Number.isFinite(p.score)&&integer(p.rank,1,26)&&(i===0||s.ranking[i-1].rank<=p.rank)))bad();
 if(!record(s.ties,['pending','group','groups','history','readyAt'])||typeof s.ties.pending!=='boolean'||!Number.isFinite(s.ties.readyAt)||!array(s.ties.groups)||!array(s.ties.history))bad();
 if(s.ties.group!==null&&!(record(s.ties.group,['score','nextRank','candidates'])&&Number.isFinite(s.ties.group.score)&&integer(s.ties.group.nextRank,1)&&people(s.ties.group.candidates)&&s.ties.group.candidates.length>=2))bad();
 if(s.ties.pending!==(s.ties.group!==null)||s.rankingFinal&&s.ties.pending)bad();
 if(!s.ties.groups.every(g=>record(g,['score','rankFrom','rankTo','resolved','requiresDraw','candidates'])&&Number.isFinite(g.score)&&integer(g.rankFrom,1)&&integer(g.rankTo,g.rankFrom)&&typeof g.resolved==='boolean'&&typeof g.requiresDraw==='boolean'&&people(g.candidates)))bad();
 if(!s.ties.history.every(h=>record(h,['rank','score','candidates','winnerId','startedAt'])&&integer(h.rank,1)&&Number.isFinite(h.score)&&people(h.candidates)&&h.candidates.some(p=>p.id===h.winnerId)&&Number.isFinite(h.startedAt)))bad();
 if(!array(s.prizes,26)||!unique(s.prizes,'id')||!s.prizes.every(p=>record(p,['id','name','quantity','remaining','rankFrom','rankTo'])&&uuid(p.id)&&text(p.name,100)&&p.name.trim()&&integer(p.quantity,1,26)&&integer(p.remaining,0,p.quantity)&&integer(p.rankFrom,1,26)&&integer(p.rankTo,p.rankFrom,26)&&p.quantity===p.rankTo-p.rankFrom+1))bad();
 if(!array(s.draws,26)||!unique(s.draws,'rank')||!s.draws.every(d=>record(d,['playerId','name','prize','prizeId','rank'])&&uuid(d.playerId)&&text(d.name,200)&&text(d.prize,100)&&uuid(d.prizeId)&&integer(d.rank,1,26)))bad();
 const occupied=new Set();for(const p of s.prizes)for(let n=p.rankFrom;n<=p.rankTo;n++){if(occupied.has(n))bad();occupied.add(n);}
 return s;
}
export function splitPrize(name){const [tier,...parts]=name.split('｜');return TIERS.includes(tier)&&parts.length?{tier,content:parts.join('｜')}:{tier:null,content:name};}
// Ranking ranges are explicit. Editing a count never silently shifts other saved awards.
export function planPrize(s,{id=null,tier,content,quantity,rankFrom}){
 if(!TIERS.includes(tier)||typeof content!=='string'||!content.trim()||/[\u0000-\u001f\u007f]/.test(content)||!integer(quantity,1,26)||!integer(rankFrom,1,26))throw Error('prize_input_required');
 const name=tier+'｜'+content.trim(),rankTo=rankFrom+quantity-1;if([...name].length>50||rankTo>26||s.draws.length)throw Error('prize_input_required');
 if(id!==null&&!s.prizes.some(p=>p.id===id))throw Error('prize_input_required');
 if(s.prizes.some(p=>p.id!==id&&(splitPrize(p.name).tier===tier||rankFrom<=p.rankTo&&rankTo>=p.rankFrom)))throw Error('prize_range_conflict');
 return {id,name,quantity,rankFrom,rankTo};
}
