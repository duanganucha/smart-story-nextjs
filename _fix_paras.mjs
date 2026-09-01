import { getPool } from './lib/db.js';
const APPLY = process.argv.includes('--apply');
const pool = getPool();

function atoms(text){ return text.split(/\n+/).map(s=>s.trim()).filter(Boolean); }
// split a string into two near-middle at a space boundary
function splitAtMidSpace(s){
  const idxs=[]; for(let i=0;i<s.length;i++) if(/\s/.test(s[i])) idxs.push(i);
  if(!idxs.length) return null;
  const mid=s.length/2; let best=idxs[0];
  for(const i of idxs) if(Math.abs(i-mid)<Math.abs(best-mid)) best=i;
  return [s.slice(0,best).trim(), s.slice(best+1).trim()].filter(Boolean);
}
function toNParagraphs(text, N){
  let parts=atoms(text);
  if(parts.length===N) return {ok:true, parts};
  // SPLIT: break longest at mid-space until N (or stuck)
  while(parts.length<N){
    // pick longest splittable
    let li=-1,ll=-1;
    parts.forEach((p,i)=>{ if(/\s/.test(p) && p.length>ll){ll=p.length;li=i;}});
    if(li<0) break; // nothing splittable
    const two=splitAtMidSpace(parts[li]);
    if(!two||two.length<2) { // mark unsplittable by removing its space temporarily — just break
      break;
    }
    parts.splice(li,1,...two);
  }
  // MERGE: combine adjacent smallest until N
  while(parts.length>N){
    let bi=0,bl=Infinity;
    for(let i=0;i<parts.length-1;i++){ const c=parts[i].length+parts[i+1].length; if(c<bl){bl=c;bi=i;} }
    parts.splice(bi,2,(parts[bi]+' '+parts[bi+1]).trim());
  }
  return {ok:parts.length===N, parts};
}

const [rows]=await pool.query("SELECT id,story,scenes FROM stories WHERE status='done' ORDER BY id");
const changed=[],skipped=[];
for(const r of rows){
  let scenes=r.scenes; if(typeof scenes==='string'){try{scenes=JSON.parse(scenes)}catch{scenes=[]}}
  scenes=scenes||[];
  const N=scenes.filter(s=>s&&s.path).length;
  if(N===0){ skipped.push(`${r.id} (0 ภาพ)`); continue; }
  const cur=atoms(r.story||'');
  if(cur.length===N) continue; // already matches
  const {ok,parts}=toNParagraphs(r.story||'', N);
  if(!ok){ skipped.push(`${r.id} (ข้อความสั้นเกิน ${cur.length}->${parts.length}/${N})`); continue; }
  const newText=parts.join('\n\n');
  changed.push({id:r.id, before:cur.length, after:parts.length, N});
  if(APPLY){
    await pool.query('UPDATE stories SET story=?, paragraph_count=? WHERE id=?',[newText, N, r.id]);
  }
}
console.log(APPLY?'=== APPLIED ===':'=== DRY RUN ===');
console.log('id\tbefore->after (target N)');
for(const c of changed) console.log(`${c.id}\t${c.before} -> ${c.after}\t(N=${c.N})`);
console.log(`\nchanged: ${changed.length}, skipped: ${skipped.length}`);
console.log('skipped:', skipped.join(', '));
process.exit(0);
