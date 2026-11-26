/* 관리자 전용 — index.html이 #admin에서만 불러옴 */
export function init(C){
const {S,LOCK,hooks,$,el,str,enc,dec,b64,unb64,rnd,newId,toast,render,applyFilter,openView,closeView,wireDialog,
  normalize,buttonsOf,catOf,isRepoFile,imgURL,sniff,keyFrom,encBytes,encJson,decJson,LOCK_ITER}=C;
const ITER=310000;
Object.assign(S,{meta:null,editing:null,file:null,dirty:false});

/* ---------- 화면 붙이기 ---------- */
const style=document.createElement('style');style.textContent=ACSS;document.head.append(style);
$('header.top').insertAdjacentHTML('beforeend',ABAR);
$('#view .vb').insertAdjacentHTML('beforeend',VADM);
$('#toast').insertAdjacentHTML('beforebegin',AHTML);
hooks.render=()=>{$('#abar').hidden=!S.admin||!!S.work;$('#sortbar').hidden=!S.work};
hooks.view=()=>{$('#vAdm').hidden=!S.admin};
hooks.route=()=>{$('#gate').hidden=true};
wireDialog($('#ed'),()=>requestClose($('#ed')));
wireDialog($('#set'));

/* ================= 순서 바꾸기 (관리자) ================= */
/* 드래그 라이브러리는 관리자가 처음 누를 때만 불러옴 — 방문자는 안 받음 */
let sortLib=null,sorter=null;
function loadSortable(){
  return sortLib||=new Promise((ok,fail)=>{
    const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js';
    sc.onload=()=>ok(window.Sortable);sc.onerror=()=>{sortLib=null;fail()};document.head.append(sc);
  });
}
/* 탭으로 일부만 보일 때: 보이는 카드끼리만 자리를 바꾸고, 안 보이는 카드는 제자리 */
function syncWork(){
  const g=$('#grid'),nodes=new Map([...g.children].filter(c=>c.dataset.id).map(c=>[c.dataset.id,c]));
  const vis=[...nodes.values()].filter(c=>!c.hidden).map(c=>c.dataset.id);
  const byId=new Map(S.work.map(x=>[x.id,x])),shown=it=>!S.cat||catOf(it)===S.cat;
  const next=S.work.slice();let k=0;
  S.work.forEach((it,i)=>{if(shown(it))next[i]=byId.get(vis[k++])});
  S.work=next;g.append(...S.work.map(it=>nodes.get(it.id)));
}
$('#sortBtn').onclick=async e=>{
  const b=e.currentTarget;b.disabled=true;let Sortable;
  try{Sortable=await loadSortable()}catch(_){toast('드래그 기능을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');b.disabled=false;return}
  b.disabled=false;S.work=S.site.items.slice();render();
  sorter=Sortable.create($('#grid'),{animation:180,draggable:'.card:not([hidden])',forceFallback:true,fallbackOnBody:true,fallbackTolerance:4,
    delay:160,delayOnTouchOnly:true,ghostClass:'sortable-ghost',onEnd:syncWork});
};
function endSort(){sorter?.destroy();sorter=null;S.work=null;render()}
$('#sortCancel').onclick=endSort;
$('#sortSave').onclick=async e=>{
  const b=e.currentTarget,order=new Map(S.work.map((it,i)=>[it.id,i]));
  const same=S.work.every((it,i)=>S.site.items[i]?.id===it.id);
  if(same){endSort();return}
  b.disabled=true;b.textContent='저장 중…';
  try{
    await commit({message:'Reorder',mutate:d=>{d.items.sort((x,y)=>(order.get(x.id)??1e9)-(order.get(y.id)??1e9));return d}});
    endSort();toast('순서를 저장했어요 · 사이트 반영까지 1~2분');
  }catch(err){toast(ghErr(err))}
  b.disabled=false;b.textContent='순서 저장';
};

/* 올리기 창은 고친 내용이 있으면 확인 후 닫기 */
function requestClose(d){if(d.id==='ed'&&S.dirty&&!confirm('저장하지 않은 내용이 있어요. 닫을까요?'))return;d.close()}
$('#ed').addEventListener('cancel',e=>{if(S.dirty&&!confirm('저장하지 않은 내용이 있어요. 닫을까요?'))e.preventDefault()});
$('#ed').addEventListener('input',()=>{S.dirty=true});

async function seal(token,code){
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await keyFrom(code,salt,ITER),enc.encode(token)));
  return{salt:b64(salt),iv:b64(iv),data:b64(ct),iter:ITER};
}
async function unseal(m,code){
  const k=await keyFrom(code,unb64(m.salt),Number(m.iter)||ITER);
  return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(m.iv)},k,unb64(m.data)));
}

/* ================= GitHub (한 번의 작업 = 커밋 1개) ================= */
async function api(path,{method='GET',body,raw=false}={}){
  const a=S.admin;
  const r=await fetch(`https://api.github.com/repos/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.repo)}/${path}`,{
    method,cache:'no-store',
    headers:{Authorization:'Bearer '+a.token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json'},
    body:body?JSON.stringify(body):undefined});
  if(!r.ok){const e=new Error('GitHub '+r.status);e.status=r.status;throw e}
  return raw==='bin'?r.arrayBuffer():raw?r.text():r.status===204?null:r.json();
}
const refPath=()=>'git/ref/heads/'+S.admin.branch.split('/').map(encodeURIComponent).join('/');
const headSha=async()=>(await api(refPath())).object.sha;
async function readAt(path,ref){try{return await api(`contents/${path}?ref=${encodeURIComponent(ref)}`,{raw:true})}catch(e){if(e.status===404)return null;throw e}}
async function exists(path,ref){try{await api(`contents/${path}?ref=${encodeURIComponent(ref)}`);return true}catch(e){if(e.status===404)return false;throw e}}
async function readSite(ref){
  if(LOCK.on){const t=await readAt('prompts.enc.json',ref);if(t!=null)return normalize(await decJson(t))}
  const t=await readAt('prompts.json',ref);   // 잠금 전 형식
  return normalize(t!=null?JSON.parse(t):structuredClone(S.site));
}
/*
  files:  {경로: Blob|문자열}  올릴 파일
  remove: [경로]              지울 파일 (없으면 건너뜀)
  mutate: prompts.json 고치는 함수 (최신 내용을 받아서 고친 걸 돌려줌)
  → 모두 커밋 하나로. 다른 곳에서 먼저 커밋했으면 최신 내용으로 다시 시도.
*/
async function commit({files={},remove=[],mutate,message}){
  const blobs=[];
  for(const[path,v]of Object.entries(files)){
    const content=v instanceof Blob?b64(new Uint8Array(await v.arrayBuffer())):b64(enc.encode(v));
    const {sha}=await api('git/blobs',{method:'POST',body:{content,encoding:'base64'}});
    blobs.push({path,mode:'100644',type:'blob',sha});
  }
  for(let attempt=0;;attempt++){
    const head=await headSha(),base=(await api('git/commits/'+head)).tree.sha;
    const tree=blobs.slice();let next=null;
    const rm=mutate&&LOCK.on?[...remove,'prompts.json']:remove;   // 잠금 사이트엔 평문 목록을 남기지 않음
    for(const p of rm)if(await exists(p,head))tree.push({path:p,mode:'100644',type:'blob',sha:null});
    if(mutate){
      next=mutate(await readSite(head));
      tree.push(LOCK.on?{path:'prompts.enc.json',mode:'100644',type:'blob',content:await encJson(next)}
                       :{path:'prompts.json',mode:'100644',type:'blob',content:JSON.stringify(next,null,2)+'\n'});
    }
    if(!tree.length)return;
    const t=await api('git/trees',{method:'POST',body:{base_tree:base,tree}});
    const c=await api('git/commits',{method:'POST',body:{message,tree:t.sha,parents:[head]}});
    try{await api(refPath().replace('git/ref/','git/refs/'),{method:'PATCH',body:{sha:c.sha}})}
    catch(e){if(e.status===422&&attempt<3)continue;throw e}
    if(next){S.site=next;render()}
    return;
  }
}
const ghErr=e=>!e||!e.status?'저장하지 못했어요. 인터넷 연결을 확인해 주세요.'
  :e.status===401?'토큰이 만료됐거나 잘못됐어요. README의 “토큰이 만료됐을 때”를 따라 해 주세요.'
  :e.status===403?'토큰에 이 저장소 쓰기 권한이 없어요.'
  :e.status===404?'저장소나 브랜치를 찾을 수 없어요. 이름과 권한을 확인해 주세요.'
  :e.status===409?'저장소가 비어 있어요. 파일을 먼저 올려 주세요.'
  :'GitHub에 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.';

/* ================= 숨겨진 로그인 ================= */
async function showGate(){
  closeView();$('#gate').hidden=false;$('#login').hidden=true;$('#setup').hidden=true;
  try{const r=await fetch('admin.json?v='+Date.now(),{cache:'no-store'});S.meta=r.ok?await r.json():null}catch(_){S.meta=null}
  if(S.meta?.data){$('#login').hidden=false;$('#code').value='';$('#gMsg').textContent='';$('#code').focus();return}
  $('#setup').hidden=false;
  const h=location.hostname;
  if(h.endsWith('.github.io')){
    const o=h.split('.')[0],seg=location.pathname.split('/').filter(Boolean)[0];
    $('#uOwner').value||=o;$('#uRepo').value||=(seg&&!seg.includes('.')?seg:`${o}.github.io`);
  }
  $('#uOwner').value?$('#uToken').focus():$('#uOwner').focus();
}
async function enterAdmin(a){
  S.admin=a;$('#gate').hidden=true;history.replaceState(null,'',location.pathname);
  try{S.site=await readSite(a.branch);S.loadError=false}catch(_){}   // 사이트 반영 전 최신 목록
  render();toast('관리자 모드');
  if(LOCK.on)migrate().catch(err=>toast('기존 데이터 암호화 실패: '+ghErr(err)));
}
/* 잠금 전에 올린 평문 목록·이미지가 있으면 암호화해서 바꿔치기 (커밋 1개) */
async function migrate(){
  const head=await headSha(),site=await readSite(head),plainList=await exists('prompts.json',head);
  const paths=[...new Set(site.items.flatMap(it=>[it.image,it.thumb]).filter(p=>isRepoFile(p)&&!/\.bin$/.test(p)))];
  if(!plainList&&!paths.length)return;
  toast('기존 데이터를 암호화하는 중…');
  const files={},remove=[],map={};
  for(const p of paths){
    try{
      const u=new Uint8Array(await api(`contents/${p}?ref=${head}`,{raw:'bin'}));
      const np=p.replace(/\.[^./]+$/,'')+'.bin';files[np]=new Blob([await encBytes(u)]);remove.push(p);map[p]=np;
      S.local[np]=URL.createObjectURL(new Blob([u],{type:sniff(u)}));
    }catch(e){if(e.status!==404)throw e;map[p]=''}
  }
  await commit({files,remove,message:'Encrypt existing data',mutate:d=>{for(const it of d.items)for(const f of['image','thumb'])if(map[it[f]]!==undefined)it[f]=map[it[f]];return d}});
  toast('기존 데이터를 암호화했어요');
}
$('#login').addEventListener('submit',async e=>{
  e.preventDefault();const code=$('#code').value,b=$('#loginBtn'),m=$('#gMsg');
  if(!code)return;b.disabled=true;m.textContent='확인 중…';
  try{const token=await unseal(S.meta,code);await enterAdmin({token,owner:S.meta.owner,repo:S.meta.repo,branch:S.meta.branch||'main'})}
  catch(_){m.textContent='코드가 맞지 않아요.';$('#code').select()}
  b.disabled=false;
});
const adminJson=(a,sealed)=>JSON.stringify({v:1,owner:a.owner,repo:a.repo,branch:a.branch,...sealed},null,2)+'\n';
$('#setup').addEventListener('submit',async e=>{
  e.preventDefault();const m=$('#uMsg'),b=$('#setupBtn');
  const a={owner:$('#uOwner').value.trim(),repo:$('#uRepo').value.trim(),branch:$('#uBranch').value.trim()||'main',token:$('#uToken').value.trim()};
  const c=$('#uCode').value;
  if(!a.owner||!a.repo||!a.token){m.textContent='사용자명, 저장소, 토큰을 모두 입력해 주세요.';return}
  if(c.length<8){m.textContent='코드는 8자 이상으로 정해 주세요.';return}
  if(c!==$('#uCode2').value){m.textContent='코드 확인이 일치하지 않아요.';return}
  b.disabled=true;m.textContent='저장소에 연결하는 중…';
  try{
    S.admin=a;
    const json=adminJson(a,await seal(a.token,c));
    await commit({files:{'admin.json':json},message:'Set up admin'});
    S.meta=JSON.parse(json);await enterAdmin(a);
    for(const id of['uToken','uCode','uCode2'])$('#'+id).value='';
  }catch(err){S.admin=null;m.textContent=ghErr(err)}
  b.disabled=false;
});
$('#outBtn').onclick=()=>{S.admin=null;closeView();render();toast('로그아웃했어요')};

/* ================= 이미지 ================= */
/* 한 번만 디코딩해서 원본(긴 변 1216px)과 정사각형 썸네일(480px)을 만듦 */
const canvasBlob=(w,h,draw,q)=>{const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'));return toBlob(c,q)};
/* 썸네일 자르기 값: cx·cy = 정사각형 가운데(그림 폭·높이 대비 0~1), s = 확대 배율(1 = 짧은 변에 꽉 차게) */
const defaultCrop=(w,h)=>{const side=Math.min(w,h);return{cx:.5,cy:((h-side)*.25+side/2)/h,s:1}};
function thumbBlob(bmp,crop){
  const W=bmp.width,H=bmp.height,c=crop||defaultCrop(W,H),side=Math.min(W,H)/c.s;
  const sx=Math.min(W-side,Math.max(0,c.cx*W-side/2)),sy=Math.min(H-side,Math.max(0,c.cy*H-side/2)),o=480;
  return canvasBlob(o,o,g=>{g.imageSmoothingQuality='high';g.drawImage(bmp,sx,sy,side,side,0,0,o,o)},.84);
}
/* 한 번만 디코딩해서 원본(긴 변 1216px)과 정사각형 썸네일(480px)을 만듦 */
async function prepareImage(file,crop){
  const bmp=await createImageBitmap(file);
  try{
    const s=Math.min(1,1216/Math.max(bmp.width,bmp.height)),fw=Math.round(bmp.width*s),fh=Math.round(bmp.height*s);
    const [full,thumb]=await Promise.all([canvasBlob(fw,fh,g=>g.drawImage(bmp,0,0,fw,fh),.88),thumbBlob(bmp,crop)]);
    return{full,thumb,ratio:+(bmp.width/bmp.height).toFixed(4)};
  }finally{bmp.close?.()}
}
async function toBlob(c,q){
  let b=await new Promise(r=>c.toBlob(r,'image/webp',q));
  if(!b||b.type!=='image/webp')b=await new Promise(r=>c.toBlob(r,'image/jpeg',q));
  return b;
}
/* NAI PNG 메타데이터(tEXt/iTXt) 읽기 */
async function naiMeta(file){
  try{
    if(file.type&&file.type!=='image/png')return null;
    const u=new Uint8Array(await file.arrayBuffer());if(u[0]!==137||u[1]!==80||u[2]!==78)return null;
    const dv=new DataView(u.buffer);let p=8;const out={};
    while(p+12<=u.length){
      const len=dv.getUint32(p),type=String.fromCharCode(...u.subarray(p+4,p+8)),d=u.subarray(p+8,p+8+len);
      if(type==='IDAT'||type==='IEND')break;   // 텍스트는 보통 이미지 데이터 앞에 있음
      if(type==='tEXt'||type==='iTXt'){
        const z=d.indexOf(0);
        if(z>0){let v=d.subarray(z+1);
          if(type==='iTXt'){if(v[0]===0){v=v.subarray(2);for(let n=0;n<2;n++)v=v.subarray(v.indexOf(0)+1)}else v=null}
          if(v)out[dec.decode(d.subarray(0,z))]=dec.decode(v);}
      }
      p+=12+len;
    }
    let c={};try{c=JSON.parse(out.Comment||'{}')}catch(_){}
    const chars=(c.v4_prompt?.caption?.char_captions||[]).map(x=>str(x?.char_caption)).filter(Boolean);
    const prompt=str(c.prompt)||str(out.Description),uc=str(c.uc);
    return prompt||uc||chars.length?{prompt,uc,chars}:null;
  }catch(_){return null}
}

/* ================= 썸네일 위치·확대 ================= */
const CROP={w:0,h:0,cx:.5,cy:.5,s:1,src:'',ready:false,changed:false};
const ZMAX=4,clampS=v=>Math.min(ZMAX,Math.max(1,v));
function clampCrop(){
  const side=Math.min(CROP.w,CROP.h)/CROP.s,hx=side/2/CROP.w,hy=side/2/CROP.h;
  CROP.cx=Math.min(1-hx,Math.max(hx,CROP.cx));CROP.cy=Math.min(1-hy,Math.max(hy,CROP.cy));
}
function drawCrop(){
  const box=$('#crop'),B=box.clientWidth,im=$('#cropImg');if(!CROP.ready||!B)return;
  clampCrop();const k=B/(Math.min(CROP.w,CROP.h)/CROP.s);
  im.style.width=CROP.w*k+'px';im.style.height=CROP.h*k+'px';
  im.style.transform=`translate(${B/2-CROP.cx*CROP.w*k}px,${B/2-CROP.cy*CROP.h*k}px)`;
  $('#cropZoom').value=CROP.s;$('#cropPct').textContent=Math.round(CROP.s*100)+'%';
}
function setCropSource(url,crop){
  CROP.ready=false;CROP.changed=false;CROP.src=url;
  $('#thumbSet').hidden=!url;if(!url)return;
  const im=$('#cropImg');
  im.onload=()=>{if(CROP.src!==url)return;CROP.w=im.naturalWidth;CROP.h=im.naturalHeight;
    const c=crop&&crop.s>=1?crop:defaultCrop(CROP.w,CROP.h);Object.assign(CROP,{cx:+c.cx||.5,cy:+c.cy||.5,s:clampS(+c.s||1)});
    CROP.ready=true;drawCrop()};
  im.src=url;
}
const cropMoved=()=>{CROP.changed=true;S.dirty=true;drawCrop()};
{
  const box=$('#crop'),pts=new Map();let pinch=null;
  const dist=()=>{const[a,b]=[...pts.values()];return Math.hypot(a.x-b.x,a.y-b.y)};
  box.addEventListener('pointerdown',e=>{if(!CROP.ready)return;box.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===2)pinch={d:dist(),s:CROP.s};box.classList.add('grab')});
  box.addEventListener('pointermove',e=>{
    const p=pts.get(e.pointerId);if(!p)return;
    if(pts.size===1){const k=box.clientWidth/(Math.min(CROP.w,CROP.h)/CROP.s);CROP.cx-=(e.clientX-p.x)/(CROP.w*k);CROP.cy-=(e.clientY-p.y)/(CROP.h*k)}
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===2&&pinch)CROP.s=clampS(pinch.s*dist()/pinch.d);
    cropMoved();
  });
  const up=e=>{pts.delete(e.pointerId);pinch=null;if(!pts.size)box.classList.remove('grab')};
  box.addEventListener('pointerup',up);box.addEventListener('pointercancel',up);
  box.addEventListener('wheel',e=>{if(!CROP.ready)return;e.preventDefault();CROP.s=clampS(CROP.s*Math.exp(-e.deltaY*.0015));cropMoved()},{passive:false});
  box.addEventListener('keydown',e=>{
    const d={ArrowLeft:[-.02,0],ArrowRight:[.02,0],ArrowUp:[0,-.02],ArrowDown:[0,.02]}[e.key];
    if(d){e.preventDefault();CROP.cx+=d[0];CROP.cy+=d[1];cropMoved()}
    else if(e.key==='+'||e.key==='='){CROP.s=clampS(CROP.s*1.1);cropMoved()}
    else if(e.key==='-'){CROP.s=clampS(CROP.s/1.1);cropMoved()}
  });
  $('#cropZoom').addEventListener('input',e=>{CROP.s=clampS(+e.target.value);cropMoved()});
  $('#cropReset').onclick=()=>{if(!CROP.ready)return;Object.assign(CROP,defaultCrop(CROP.w,CROP.h));cropMoved()};
  addEventListener('resize',()=>{if($('#ed').open)drawCrop()});
}
const cropValue=()=>CROP.ready?{cx:+CROP.cx.toFixed(4),cy:+CROP.cy.toFixed(4),s:+CROP.s.toFixed(3)}:null;

/* ================= 올리기 / 수정 ================= */
const rows=()=>[...$('#fBtns').children];
const DEFAULT_LABEL={prompt:'프롬프트',neg:'네거티브',custom:''};
function refreshRows(){rows().forEach((r,i)=>{r.querySelector('[data-up]').disabled=i===0})}
function btnRow(kind,label,text=''){
  if(label==null)label=kind==='char'?`캐릭터 ${rows().filter(r=>r.dataset.kind==='char').length+1}`:DEFAULT_LABEL[kind]??'';
  const r=el('div','brow');r.dataset.kind=kind;
  const h=el('div','bh'),li=el('input');
  Object.assign(li,{type:'text',maxLength:30,value:label,placeholder:'버튼 이름 (예: 배경 태그)'});li.setAttribute('aria-label','버튼 이름');
  const up=el('button',null,'↑');Object.assign(up,{type:'button',title:'위로'});up.dataset.up='';
  up.onclick=()=>{r.previousElementSibling?.before(r);refreshRows();S.dirty=true};
  const x=el('button',null,'×');Object.assign(x,{type:'button',title:'빼기'});
  x.onclick=()=>{r.remove();refreshRows();S.dirty=true};
  h.append(li,up,x);
  const t=el('textarea');Object.assign(t,{rows:3,value:text,placeholder:'복사될 내용'});t.setAttribute('aria-label','버튼 내용');
  r.append(h,t);$('#fBtns').append(r);refreshRows();return r;
}
document.querySelectorAll('.adds [data-kind]').forEach(b=>b.onclick=()=>{const k=b.dataset.kind;btnRow(k).querySelector(k==='custom'?'input':'textarea').focus();S.dirty=true});

let previewURL=null;
function setPreview(src){
  const d=$('#drop');d.querySelectorAll('img,.chg').forEach(n=>n.remove());
  if(previewURL&&src!==previewURL){URL.revokeObjectURL(previewURL);previewURL=null}
  if(src){const im=el('img');im.alt='';im.src=src;d.append(im,el('span','chg','바꾸기'))}
}
function openEd(it){
  S.editing=it||null;S.file=null;
  $('#edH').textContent=it?'수정':'올리기';
  $('#fName').value=str(it?.name);
  const sel=$('#fCat'),cur=str(it?.category),opts=S.site.categories.slice();
  if(cur&&!opts.includes(cur))opts.push(cur);
  sel.replaceChildren(...opts.map(c=>{const o=el('option',null,c);o.value=c;return o}),Object.assign(el('option',null,'없음 (기타)'),{value:''}));
  sel.value=it?cur:(S.cat&&opts.includes(S.cat)?S.cat:opts[0]||'');
  $('#fDesc').value=str(it?.memo);
  $('#fBtns').replaceChildren();
  const bs=it?buttonsOf(it):[];bs.length?bs.forEach(b=>btnRow(b.kind,b.label,b.text)):btnRow('prompt');
  setPreview('');setCropSource('');
  if(it&&(it.image||it.thumb))imgURL(str(it.image)||str(it.thumb)).then(u=>{if(S.editing===it&&!S.file){setPreview(u);setCropSource(u,it.crop)}},()=>{});
  $('#edMsg').textContent='';$('#file').value='';$('#edSave').disabled=false;
  S.dirty=false;closeView();$('#ed').showModal();drawCrop();
}
async function pick(f){
  if(!f||!f.type.startsWith('image/')){if(f)$('#edMsg').textContent='이미지 파일만 올릴 수 있어요.';return}
  S.file=f;S.dirty=true;previewURL=URL.createObjectURL(f);setPreview(previewURL);setCropSource(previewURL);
  if(!$('#fName').value.trim()&&f.name&&!/^image\.\w+$/.test(f.name))$('#fName').value=f.name.replace(/\.[^.]+$/,'');
  const m=await naiMeta(f);
  if(!m){$('#edMsg').textContent='';return}
  const fill=(kind,text)=>{const r=rows().find(r=>r.dataset.kind===kind&&!r.querySelector('textarea').value.trim());(r||btnRow(kind)).querySelector('textarea').value=text};
  if(m.prompt)fill('prompt',m.prompt);
  m.chars.forEach(c=>fill('char',c));
  if(m.uc)fill('neg',m.uc);
  $('#edMsg').textContent='이미지에서 프롬프트를 불러왔어요.';
}
const drop=$('#drop');
drop.onclick=()=>$('#file').click();
drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#file').click()}};
$('#file').onchange=e=>pick(e.target.files[0]);
drop.ondragover=e=>{e.preventDefault();drop.classList.add('over')};
drop.ondragleave=()=>drop.classList.remove('over');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');pick(e.dataTransfer.files[0])};
/* 올리기 창에서 Ctrl+V로 이미지 붙여넣기 (글자 칸에 붙여넣는 건 그대로) */
$('#ed').addEventListener('paste',e=>{
  const f=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));
  if(f){e.preventDefault();pick(f)}
});
$('#addBtn').onclick=()=>openEd(null);
$('#vEdit').onclick=()=>openEd(S.viewing);

$('#edf').addEventListener('submit',async e=>{
  e.preventDefault();
  const m=$('#edMsg'),b=$('#edSave'),old=S.editing;
  const buttons=rows().map(r=>({kind:r.dataset.kind,label:r.querySelector('input').value.trim()||'내용',text:r.querySelector('textarea').value.trim()})).filter(x=>x.text);
  if(!buttons.length){m.textContent='내용이 있는 복사 버튼을 하나 이상 넣어 주세요.';return}
  if(!old&&!S.file){m.textContent='썸네일 이미지를 넣어 주세요.';drop.focus();return}
  b.disabled=true;
  const id=old?.id||newId(),now=Date.now();
  const item={id,name:$('#fName').value.trim(),category:$('#fCat').value,memo:$('#fDesc').value.trim(),buttons,
    image:old?.image||'',thumb:old?.thumb||'',ratio:old?.ratio,crop:cropValue()||old?.crop,createdAt:old?.createdAt||now,updatedAt:now};
  const files={},remove=[];
  const pack=async b=>LOCK.on?new Blob([await encBytes(new Uint8Array(await b.arrayBuffer()))]):b;
  try{
    if(!S.file&&old&&CROP.changed&&CROP.ready){
      /* 그림은 그대로, 썸네일만 새 위치·확대로 다시 만듦 */
      m.textContent='썸네일을 만드는 중…';
      const bmp=await createImageBitmap(await (await fetch(CROP.src)).blob());
      let th;try{th=await thumbBlob(bmp,item.crop)}finally{bmp.close?.()}
      const ext=LOCK.on?'bin':th.type==='image/webp'?'webp':'jpg';
      item.thumb=`thumbs/${id}-${now.toString(36)}.${ext}`;
      files[item.thumb]=await pack(th);S.local[item.thumb]=URL.createObjectURL(th);
      if(isRepoFile(old.thumb))remove.push(old.thumb);
    }
    if(S.file){
      m.textContent='이미지를 줄이는 중…';
      const img=await prepareImage(S.file,item.crop);
      const ext=LOCK.on?'bin':img.full.type==='image/webp'?'webp':'jpg',stamp=now.toString(36);
      item.image=`images/${id}-${stamp}.${ext}`;item.thumb=`thumbs/${id}-${stamp}.${ext}`;item.ratio=img.ratio;
      files[item.image]=await pack(img.full);files[item.thumb]=await pack(img.thumb);
      if(old)remove.push(...[old.image,old.thumb].filter(isRepoFile));
      S.local[item.image]=URL.createObjectURL(img.full);S.local[item.thumb]=URL.createObjectURL(img.thumb);
    }
    m.textContent='저장하는 중…';
    await commit({files,remove,message:(old?'Update: ':'Add: ')+(item.name||id),mutate:d=>{
      const i=d.items.findIndex(x=>x.id===id);
      if(i>=0)d.items[i]=item;else d.items.push(item);   // 새 항목은 맨 뒤
      if(item.category&&!d.categories.includes(item.category))d.categories.push(item.category);
      return d;
    }});
    S.dirty=false;$('#ed').close();
    toast((old?'수정했어요':'올렸어요')+' · 사이트 반영까지 1~2분');
  }catch(err){m.textContent=ghErr(err)}
  b.disabled=false;
});

$('#vTop').onclick=async e=>{
  const it=S.viewing,b=e.currentTarget;if(!it)return;b.disabled=true;
  try{await commit({message:'Move to front: '+(it.name||it.id),mutate:d=>{const i=d.items.findIndex(x=>x.id===it.id);if(i>0)d.items.unshift(...d.items.splice(i,1));return d}});toast('맨 앞으로 옮겼어요')}
  catch(err){toast(ghErr(err))}
  b.disabled=false;
};
$('#vDel').onclick=async e=>{
  const it=S.viewing,b=e.currentTarget;
  if(!it||!confirm(`“${str(it.name)||'이름 없음'}”을(를) 삭제할까요?`))return;
  b.disabled=true;
  try{
    await commit({remove:[it.image,it.thumb].filter(isRepoFile),message:'Remove: '+(it.name||it.id),mutate:d=>{d.items=d.items.filter(x=>x.id!==it.id);return d}});
    closeView();toast('삭제했어요');
  }catch(err){toast(ghErr(err))}
  b.disabled=false;
};

/* ================= 설정 ================= */
$('#setBtn').onclick=()=>{
  $('#sTitle').value=S.site.title;$('#sDesc').value=S.site.description;$('#sCats').value=S.site.categories.join('\n');
  $('#sMsg').textContent='';$('#cNew').value='';$('#cNew2').value='';
  $('#lockSet').hidden=!LOCK.on;
  if(LOCK.on){$('#pNew').value='';$('#pNew2').value='';$('#pHint').value=str(LOCK.meta.hint);$('#pNotice').value=str(LOCK.meta.notice)}
  $('#set').showModal();
};
$('#sSave').onclick=async e=>{
  const b=e.currentTarget,m=$('#sMsg');b.disabled=true;m.textContent='저장하는 중…';
  const title=$('#sTitle').value.trim(),desc=$('#sDesc').value.trim(),cats=[...new Set($('#sCats').value.split('\n').map(x=>x.trim()).filter(Boolean))];
  try{await commit({message:'Update site info',mutate:d=>Object.assign(d,{title,description:desc,categories:cats})});m.textContent='저장했어요.'}
  catch(err){m.textContent=ghErr(err)}
  b.disabled=false;
};
$('#pSave').onclick=async e=>{
  const pw=$('#pNew').value,m=$('#sMsg'),b=e.currentTarget;
  if(pw&&pw!==$('#pNew2').value){m.textContent='비밀번호 확인이 일치하지 않아요.';return}
  b.disabled=true;m.textContent='저장하는 중…';
  try{
    const meta={...LOCK.meta,hint:$('#pHint').value.trim(),notice:$('#pNotice').value.trim()};
    if(pw)meta.wrap=await wrapKey(pw,LOCK.raw);   // 내용 키는 그대로, 감싸는 비밀번호만 바뀜
    await commit({files:{'lock.json':JSON.stringify(meta,null,2)+'\n'},message:pw?'Change site password':'Update lock text'});
    LOCK.meta=meta;$('#pNew').value='';$('#pNew2').value='';
    m.textContent=pw?'비밀번호를 바꿨어요. 1~2분 뒤부터 새 비밀번호로 열려요.':'저장했어요.';
  }catch(err){m.textContent=ghErr(err)}
  b.disabled=false;
};
$('#cSave').onclick=async e=>{
  const c=$('#cNew').value,m=$('#sMsg'),b=e.currentTarget;
  if(c.length<8){m.textContent='코드는 8자 이상으로 정해 주세요.';return}
  if(c!==$('#cNew2').value){m.textContent='코드 확인이 일치하지 않아요.';return}
  b.disabled=true;m.textContent='바꾸는 중…';
  try{
    const json=adminJson(S.admin,await seal(S.admin.token,c));
    await commit({files:{'admin.json':json},message:'Change admin code'});
    S.meta=JSON.parse(json);m.textContent='코드를 바꿨어요. 다음 로그인부터 새 코드를 쓰세요.';
    $('#cNew').value='';$('#cNew2').value='';
  }catch(err){m.textContent=ghErr(err)}
  b.disabled=false;
};

async function wrapKey(pw,raw){const salt=rnd(16),iv=rnd(12),kek=await keyFrom(pw,salt,LOCK_ITER);return{salt:b64(salt),iter:LOCK_ITER,iv:b64(iv),data:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},kek,raw)))}}
document.querySelectorAll('[data-leave]').forEach(b=>b.onclick=()=>{history.replaceState(null,'',location.pathname);$('#gate').hidden=true});


return{enter:showGate};
}

const ACSS=`.abar{display:flex;gap:6px;flex-wrap:wrap}
.vadm{display:flex;gap:6px;padding-top:16px;flex-wrap:wrap}
/* 순서 바꾸기 모드 */
.grid.sorting .card{cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.grid.sorting{margin-bottom:64px}
.grid.sorting .ph{outline:1.5px dashed var(--ink);outline-offset:3px}
.grid.sorting .card:hover .ph img{transform:none}
.grid .sortable-ghost{opacity:.25}
.sortable-fallback{opacity:.9!important;cursor:grabbing}
.sortbar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:15;display:flex;align-items:center;gap:8px;background:var(--ink);color:var(--inv);border-radius:0;padding:6px 6px 6px 18px;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);max-width:94vw;font-size:14px;white-space:nowrap}
.sortbar .btn{border-color:color-mix(in srgb,var(--inv) 35%,transparent);color:var(--inv)}
.sortbar .btn.fill{background:var(--inv);color:var(--ink);border-color:var(--inv)}
@media(max-width:420px){.sortbar .hint2{display:none}.sortbar{padding-left:6px}}
/* 편집·설정 창 */
.panel{width:min(560px,94vw);max-height:92vh;overflow:auto;position:relative}
.panel form,.panel .pbody{padding:30px 26px;display:grid;gap:16px}
.panel h2{margin:0;font-size:19px;font-weight:700;padding-bottom:14px;border-bottom:1.5px dashed var(--line)}
.panel h3{margin:8px 0 0;font-size:15px;font-weight:700}
label{display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--mute)}
.sub{font-weight:400}
textarea{resize:vertical;min-height:90px;font:14px/1.6 var(--mono)}
textarea.plain{font:14.5px/1.6 var(--mono)}
.drop{border:1.5px dashed var(--ink);aspect-ratio:3/2;display:grid;place-items:center;cursor:pointer;position:relative;overflow:hidden;background:var(--soft);color:var(--mute);font-size:14px;text-align:center;padding:12px;line-height:1.6}
.drop img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:var(--soft)}
.drop .chg{position:absolute;right:8px;bottom:8px;z-index:1;background:var(--ink);color:var(--inv);font-size:12px;padding:4px 10px}
.drop.over{border-color:var(--ink);color:var(--ink)}
.thumbset{display:grid;gap:10px}
.thumbset>.t{font-size:13px;font-weight:600;color:var(--mute)}
.cropwrap{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap}
.crop{width:min(240px,100%);aspect-ratio:1/1;position:relative;overflow:hidden;background:var(--soft);outline:1px solid var(--ink);outline-offset:3px;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none}
.crop.grab{cursor:grabbing}
.crop:focus-visible{outline:2px solid var(--ink)}
.crop img{position:absolute;left:0;top:0;max-width:none;pointer-events:none;-webkit-user-drag:none}
.cropctl{flex:1 1 160px;display:grid;gap:12px;align-content:end}
.cropctl label{grid-template-columns:auto 1fr;align-items:center}
.cropctl label input{grid-column:1/-1}
input[type=range]{width:100%;accent-color:var(--ink);height:28px}
.bsec{display:grid;gap:10px}
.bsec>.t{font-size:13px;font-weight:600;color:var(--mute)}
.brow{border:1.5px solid var(--line);display:grid}
.brow .bh{display:flex;align-items:center;border-bottom:1.5px dashed var(--line)}
.brow .bh input{border:0;flex:1;font-weight:600;padding:10px 12px}
.brow .bh button{border:0;background:none;width:40px;height:40px;cursor:pointer;color:var(--mute);font-size:16px;flex:none}
.brow .bh button:hover:not(:disabled){color:var(--ink)}
.brow .bh button:disabled{opacity:.3;cursor:default}
.brow textarea{border:0;min-height:76px}
.adds{display:flex;flex-wrap:wrap;gap:6px}
.adds .btn{height:34px;font-size:13px;padding:0 12px}
.row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
hr{border:0;border-top:1.5px dashed var(--line);margin:4px 0}

/* 숨겨진 로그인 */
#gate{position:fixed;inset:0;background:var(--page);z-index:20;display:grid;place-items:center;padding:20px;overflow:auto}
.gbox{width:min(380px,100%);display:grid;gap:14px;background:var(--paper);padding:10px 0}
.gbox h2{margin:0 0 4px;font-size:18px;font-weight:700;padding-bottom:12px;border-bottom:1.5px dashed var(--line)}
.gbox .back{justify-self:center;background:none;border:0;color:var(--mute);cursor:pointer;font-size:14px;margin-top:6px}

`;
const ABAR=`  <div class="abar" id="abar" hidden>
    <button class="btn fill" id="addBtn">+ 올리기</button>
    <button class="btn line" id="sortBtn">순서 바꾸기</button>
    <button class="btn line" id="setBtn">설정</button>
    <button class="btn line" id="outBtn">로그아웃</button>
  </div>
`;
const VADM=`      <div class="vadm" id="vAdm" hidden>
        <button class="btn line" id="vEdit">수정</button>
        <button class="btn line" id="vTop">맨 앞으로</button>
        <button class="btn line" id="vDel">삭제</button>
      </div>
`;
const AHTML=`<!-- 올리기 / 수정 -->
<dialog id="ed" class="panel" aria-labelledby="edH">
  <button class="x" data-close aria-label="닫기">×</button>
  <form id="edf" novalidate>
    <h2 id="edH">올리기</h2>
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="썸네일 이미지 선택">썸네일 이미지를 끌어다 놓거나, 눌러서 선택하거나, Ctrl+V로 붙여넣기<br>NAI에서 받은 PNG면 복사 버튼이 자동으로 채워져요<input type="file" id="file" accept="image/*" hidden></div>
    <div class="thumbset" id="thumbSet" hidden>
      <div class="t">미리보기 썸네일 <span class="sub">· 갤러리에 보이는 부분이에요. 큰 그림은 그대로예요</span></div>
      <div class="cropwrap">
        <div class="crop" id="crop" tabindex="0" role="application" aria-label="썸네일 위치. 끌거나 화살표 키로 옮기고, 휠이나 +, - 키로 확대"><img id="cropImg" alt="" draggable="false"></div>
        <div class="cropctl">
          <p class="hint">끌어서 위치 조정<br>휠 · 두 손가락 · 슬라이더로 확대</p>
          <label>확대 <span class="sub" id="cropPct">100%</span><input type="range" id="cropZoom" min="1" max="4" step="0.01" value="1"></label>
          <button type="button" class="btn line" id="cropReset">처음대로</button>
        </div>
      </div>
    </div>
    <label>이름<input type="text" id="fName" maxlength="80"></label>
    <label>카테고리<select id="fCat"></select></label>
    <label>설명 <span class="sub">· 복사 창에 보이는 글이에요. 비워 두면 안 보여요</span><textarea id="fDesc" class="plain" rows="4" maxlength="2000" placeholder="사용 팁, 추천 설정, 주의할 점 등"></textarea></label>
    <div class="bsec">
      <div class="t">복사 버튼 <span class="sub">· 위에서부터 창에 보이는 순서</span></div>
      <div id="fBtns" class="bsec"></div>
      <div class="adds">
        <button type="button" class="btn line" data-kind="prompt">+ 프롬프트</button>
        <button type="button" class="btn line" data-kind="char">+ 캐릭터</button>
        <button type="button" class="btn line" data-kind="neg">+ 네거티브</button>
        <button type="button" class="btn line" data-kind="custom">+ 직접 입력</button>
      </div>
    </div>
    <p class="msg" id="edMsg" role="status"></p>
    <button type="submit" class="btn fill wide" id="edSave">저장</button>
  </form>
</dialog>

<!-- 설정 -->
<dialog id="set" class="panel" aria-labelledby="setH">
  <button class="x" data-close aria-label="닫기">×</button>
  <div class="pbody">
    <h2 id="setH">설정</h2>
    <label>사이트 이름<input type="text" id="sTitle" maxlength="60"></label>
    <label>소개 문구<textarea id="sDesc" class="plain" rows="2" maxlength="300"></textarea></label>
    <label>카테고리 순서 <span class="sub">· 한 줄에 하나씩, 위에서부터 탭에 보이는 순서예요</span><textarea id="sCats" class="plain" rows="5"></textarea></label>
    <div class="row"><button class="btn fill" id="sSave">저장</button></div>
    <hr>
    <div id="lockSet" class="bsec" style="gap:16px" hidden>
      <h3>사이트 비밀번호</h3>
      <label>새 비밀번호 <span class="sub">· 바꾸지 않으려면 비워 두세요</span><input type="password" id="pNew" autocomplete="new-password"></label>
      <label>새 비밀번호 확인<input type="password" id="pNew2" autocomplete="new-password"></label>
      <label>힌트 <span class="sub">· 잠금 화면에 보여요</span><input type="text" id="pHint" maxlength="100"></label>
      <label>안내 문구 <span class="sub">· 잠금 화면 아래에 작게 보여요</span><textarea id="pNotice" class="plain" rows="2" maxlength="300"></textarea></label>
      <div class="row"><button class="btn line" id="pSave">잠금 설정 저장</button></div>
      <hr>
    </div>
    <h3>관리자 코드 바꾸기</h3>
    <label>새 코드<input type="password" id="cNew" autocomplete="new-password"></label>
    <label>새 코드 확인<input type="password" id="cNew2" autocomplete="new-password"></label>
    <div class="row"><button class="btn line" id="cSave">코드 바꾸기</button></div>
    <p class="msg" id="sMsg" role="status"></p>
  </div>
</dialog>

<!-- 숨겨진 로그인 (#admin) -->
<section id="gate" hidden>
  <form class="gbox" id="login" novalidate>
    <h2>관리자</h2>
    <input type="password" id="code" placeholder="코드" autocomplete="current-password" aria-label="관리자 코드">
    <button class="btn fill wide" id="loginBtn">들어가기</button>
    <p class="msg" id="gMsg" role="status"></p>
    <button type="button" class="back" data-leave>사이트로 돌아가기</button>
  </form>
  <form class="gbox" id="setup" novalidate hidden>
    <h2>처음 설정</h2>
    <p class="hint">한 번만 하면 돼요. GitHub 토큰은 아래 코드로 암호화해서 저장소에 올라가요.</p>
    <label>GitHub 사용자명<input type="text" id="uOwner" autocapitalize="off" spellcheck="false"></label>
    <label>저장소 이름<input type="text" id="uRepo" autocapitalize="off" spellcheck="false"></label>
    <label>브랜치<input type="text" id="uBranch" value="main" autocapitalize="off" spellcheck="false"></label>
    <label>GitHub 토큰<input type="password" id="uToken" autocomplete="off"></label>
    <label>관리자 코드 <span class="sub">· 12자 이상 권장</span><input type="password" id="uCode" autocomplete="new-password"></label>
    <label>코드 확인<input type="password" id="uCode2" autocomplete="new-password"></label>
    <button class="btn fill wide" id="setupBtn">설정 완료</button>
    <p class="msg" id="uMsg" role="status"></p>
    <button type="button" class="back" data-leave>사이트로 돌아가기</button>
  </form>
</section>

<div class="sortbar" id="sortbar" hidden>
  <span class="hint2">끌어서 순서를 바꾸세요</span>
  <button class="btn" id="sortCancel">취소</button>
  <button class="btn fill" id="sortSave">순서 저장</button>
</div>

`;
