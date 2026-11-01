// Biblioteca: livros e PGNs (arquivos em ~/Biblioteca Bertonática, via Rust)

const {invoke}=window.__TAURI__.core;
import {pickPaths,askChoice} from './util.js';
import {enhance} from './dropdown.js';
export const libCount=()=>items.length;
const $=id=>document.getElementById(id);
const TYPES={pdf:'PDF',epub:'EPUB',pgn:'PGN'};
const GLYPH={pdf:'♚',epub:'♛',pgn:'♞'};
const STATUS={'':'Não lido',reading:'Lendo',done:'Concluído'};
let items=[],filter='all',query='',cur=null,newCover,pgnId=null,delArmed=false,cat='all',st='all',selMode=false,sel=new Set(),vis=[];

const ic=n=>`<svg class="i"><use href="#i-${n}"/></svg>`;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function hue(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return h}
const grad=t=>`background:linear-gradient(160deg,hsl(${hue(t)} 45% 32%),hsl(${(hue(t)+40)%360} 50% 20%))`;
const bg=i=>i.cover?`background-image:url(${i.cover})`:grad(i.title);

function resize(file){return new Promise(res=>{const r=new FileReader();r.onload=()=>{const im=new Image();im.onload=()=>{const w=360,h=540,c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d'),s=Math.max(w/im.width,h/im.height),dw=im.width*s,dh=im.height*s;x.drawImage(im,(w-dw)/2,(h-dh)/2,dw,dh);res(c.toDataURL('image/jpeg',.82))};im.onerror=()=>res(null);im.src=r.result};r.onerror=()=>res(null);r.readAsDataURL(file)})}

function render(){
  const n={all:items.length};for(const k in TYPES)n[k]=items.filter(i=>i.kind===k).length;
  $('count').textContent=`${items.length} ${items.length===1?'item':'itens'} · ~/Biblioteca Bertonática`;
  if(filter!=='all'&&!n[filter])filter='all';
  const sc={all:items.length,unread:items.filter(i=>!i.status).length,reading:items.filter(i=>i.status==='reading').length,done:items.filter(i=>i.status==='done').length};
  // linha 1: tipo (botões) + status (lista compacta à direita)
  $('tabs').innerHTML=[['all','Todos'],['pdf','PDF'],['epub','EPUB'],['pgn','PGN']].map(([k,l])=>`<button data-k="${k}" class="${filter===k?'on':''}">${l} (${n[k]})</button>`).join('')
    +(items.length?`<select id="stSel" class="stsel" aria-label="Status de leitura" title="Filtrar por status de leitura">${[['all','Todos os status'],['unread','Não lido'],['reading','Lendo'],['done','Concluído']].map(([k,l])=>`<option value="${k}"${st===k?' selected':''}>${l} (${sc[k]})</option>`).join('')}</select>`:'');
  if($('stSel'))enhance($('stSel'));
  // linha 2: categorias
  const cats=[...new Set(items.map(i=>i.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt'));
  const none=items.filter(i=>!i.category).length;
  if(cat==='__none'&&!none)cat='all';
  if(cat!=='all'&&cat!=='__none'&&!cats.includes(cat))cat='all';
  const chips=[['all','Todos',items.length],...cats.map(c=>[c,c,items.filter(i=>i.category===c).length])];
  if(cats.length&&none)chips.push(['__none','Sem categoria',none]);
  $('cats').innerHTML=cats.length?chips.map(([k,l,c])=>`<button data-c="${esc(k)}" class="${cat===k?'on':''}">${esc(l)} (${c})</button>`).join(''):'';
  $('catList').innerHTML=cats.map(c=>`<option value="${esc(c)}">`).join('');
  const list=items.filter(i=>(filter==='all'||i.kind===filter)&&(cat==='all'||(cat==='__none'?!i.category:i.category===cat))&&(st==='all'||(st==='unread'?!i.status:i.status===st))&&(i.title+' '+i.author+' '+i.category).toLowerCase().includes(query)).sort((a,b)=>a.title.localeCompare(b.title,'pt'));
  vis=list;
  if(!list.length){$('grid').innerHTML=`<div class="empty" style="grid-column:1/-1">${items.length?'Nada encontrado.':'Biblioteca vazia.<br>Use “+ Adicionar”, “Importar pasta” ou coloque arquivos na pasta.'}</div>`;return}
  $('grid').innerHTML=list.map(i=>`<div class="card${sel.has(i.id)?' sel':''}" data-id="${esc(i.id)}"><div class="cover" data-o="${esc(i.id)}" style="${bg(i)}"><span class="badge">${TYPES[i.kind]}</span>${i.status?`<span class="stb ${i.status}">${STATUS[i.status]}</span>`:''}${i.cover?'':`<div class="g">${GLYPH[i.kind]}</div><div class="t">${esc(i.title)}</div>`}</div><div class="info"><div><b>${esc(i.title)}</b>${i.note?`<small class="nt" title="${esc(i.note)}">✎ ${esc(i.note)}</small>`:`<small>${esc(i.author||i.category||'')}</small>`}</div><button data-e="${esc(i.id)}" aria-label="Editar">${ic('pencil')}</button></div></div>`).join('');
}

$('q').oninput=e=>{query=e.target.value.toLowerCase();render()};
$('tabs').onclick=e=>{const k=e.target.dataset&&e.target.dataset.k;if(k){filter=k;render()}};
$('tabs').onchange=e=>{if(e.target.id==='stSel'){st=e.target.value;render()}};
$('cats').onclick=e=>{const b=e.target.closest('button');if(b&&b.dataset.c!==undefined){cat=b.dataset.c;render()}};
$('grid').onclick=e=>{const card=e.target.closest('.card');if(selMode&&card){const id=card.dataset.id;sel.has(id)?sel.delete(id):sel.add(id);render();selUI();return}const ed=e.target.closest('[data-e]'),o=e.target.closest('[data-o]');if(ed)edit(ed.dataset.e);else if(o)openItem(o.dataset.o)};
$('folder').onclick=()=>invoke('open_folder');
$('importDir').onclick=async()=>{const r=await pickPaths({directory:true});if(!r)return;items=await invoke('import_folder',{path:Array.isArray(r)?r[0]:r});render()};
function selUI(){$('selN').textContent=`${sel.size} selecionado(s)`;$('selBar').style.display=selMode?'flex':'none';$('selToggle').innerHTML=ic('select')+(selMode?'Sair da seleção':'Selecionar')}
$('selToggle').onclick=()=>{selMode=!selMode;sel.clear();render();selUI()};
$('selAll').onclick=()=>{vis.forEach(i=>sel.add(i.id));render();selUI()};
$('selDel').onclick=async()=>{
  if(!sel.size)return;
  const n=sel.size;
  if(await askChoice('Excluir '+n+(n===1?' item':' itens'),'Os arquivos serão apagados da biblioteca. Isso não pode ser desfeito.',['Excluir','Cancelar'])!==0)return;
  items=await invoke('delete_items',{ids:[...sel]});selMode=false;sel.clear();render();selUI();
};
$('selCancel').onclick=()=>$('selToggle').onclick();
$('selSt').onchange=async e=>{const v=e.target.value;e.target.value='';if(!v||!sel.size)return;items=await invoke('set_status',{ids:[...sel],status:v==='none'?'':v});selMode=false;sel.clear();render();selUI()};
$('selApply').onclick=async()=>{if(!sel.size)return;items=await invoke('set_category',{ids:[...sel],category:$('selCat').value.trim()});selMode=false;sel.clear();$('selCat').value='';render();selUI()};
$('add').onclick=async()=>{
  const r=await pickPaths({multiple:true,extensions:['pdf','epub','pgn'],name:'Livros e PGN'});
  if(!r)return;
  items=await invoke('add_files',{paths:Array.isArray(r)?r:[r]});render();autoCovers();
};

// ---- capa automática: primeira imagem do PDF / capa do EPUB (quem já tem capa, ou escolheu "sem capa", não é mexido) ----
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function zipIndex(buf){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);let e=buf.length-22;
  while(e>=0&&dv.getUint32(e,true)!==0x06054b50)e--;if(e<0)return null;
  const n=dv.getUint16(e+10,true);let p=dv.getUint32(e+16,true);const m=new Map(),td=new TextDecoder();
  for(let i=0;i<n&&dv.getUint32(p,true)===0x02014b50;i++){
    const nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true);
    m.set(td.decode(buf.subarray(p+46,p+46+nl)),{meth:dv.getUint16(p+10,true),cs:dv.getUint32(p+20,true),off:dv.getUint32(p+42,true)});p+=46+nl+el+cl;
  }
  return m;
}
async function zipGet(buf,m,name){
  const f=m.get(name);if(!f)return null;const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const s=f.off+30+dv.getUint16(f.off+26,true)+dv.getUint16(f.off+28,true),d=buf.subarray(s,s+f.cs);
  if(f.meth===0)return d;
  if(f.meth!==8)return null;
  return new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}
const norm=p=>{const o=[];for(const s of p.split('/')){if(s==='..')o.pop();else if(s&&s!=='.')o.push(s)}return o.join('/')};
async function epubCover(id){
  const b=await invoke('epub_bytes',{id});if(!b)return null;
  const buf=unb64(b),m=await zipIndex(buf);if(!m)return null;
  const xml=async n=>{const d=await zipGet(buf,m,n);return d?new DOMParser().parseFromString(new TextDecoder().decode(d),'text/xml'):null};
  const cont=await xml('META-INF/container.xml');const opfPath=cont?.querySelector('rootfile')?.getAttribute('full-path');if(!opfPath)return null;
  const opf=await xml(opfPath);if(!opf)return null;const dir=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')+1):'';
  const its=[...opf.getElementsByTagName('item')].map(e=>({id:e.getAttribute('id')||'',href:e.getAttribute('href')||'',type:e.getAttribute('media-type')||'',prop:e.getAttribute('properties')||''})).filter(i=>/^image\//.test(i.type));
  const metaId=[...opf.getElementsByTagName('meta')].find(e=>e.getAttribute('name')==='cover')?.getAttribute('content');
  const it=its.find(i=>/cover-image/.test(i.prop))||its.find(i=>i.id===metaId)||its.find(i=>/cover/i.test(i.id+i.href))||its[0];
  if(!it)return null;
  const d=await zipGet(buf,m,norm(dir+decodeURIComponent(it.href)));
  return d?resize(new Blob([d],{type:it.type})):null;
}
async function bookCover(it){
  try{
    if(it.kind==='pdf'){const b=await invoke('pdf_cover',{id:it.id});return b?await resize(new Blob([unb64(b)],{type:'image/jpeg'})):null}
    if(it.kind==='epub')return await epubCover(it.id);
  }catch(e){}
  return null;
}
let covBusy=false;
async function autoCovers(){
  if(covBusy)return;covBusy=true;
  try{
    for(const x of items.filter(i=>i.cover==null&&(i.kind==='pdf'||i.kind==='epub'))){
      if($('dlg').open)break;
      const c=await bookCover(x),i=items.find(y=>y.id===x.id);if(!i||i.cover!=null)continue;
      const r=await invoke('update_item',{id:i.id,title:i.title,author:i.author||'',category:i.category||'',status:i.status||'',note:i.note||'',cover:c||''});if(!Array.isArray(r))break;items=r;render();
    }
  }catch(e){}finally{covBusy=false}
}

const run=id=>invoke('open_item',{id}).catch(e=>{$('count').textContent=String(e)});
let cfg={};
const CFG_LABEL={pdf:'PDF',epub:'EPUB'};
function cfgRender(){$('cfgRows').innerHTML=['pdf','epub'].map(k=>`<label>${CFG_LABEL[k]}</label><div style="display:flex;gap:6px;align-items:center"><small style="flex:1;word-break:break-all;color:var(--mu)">${esc(cfg[k]||'Padrão do sistema')}</small><button class="ghost" data-c="${k}">Escolher</button><button class="ghost" data-r="${k}">Padrão</button></div>`).join('')}
export async function openConfig(){cfg=await invoke('get_config');cfgRender();$('cfgDlg').showModal()}
$('cfgBtn').onclick=openConfig;
$('cfgRows').onclick=async e=>{const c=e.target.dataset.c,r=e.target.dataset.r;
  if(c){const p=await pickPaths({multiple:false,extensions:['*']});if(p){cfg=await invoke('set_opener',{kind:c,path:p});cfgRender()}}
  if(r){cfg=await invoke('set_opener',{kind:r,path:null});cfgRender()}};
$('cfgClose').onclick=()=>$('cfgDlg').close();

async function openItem(id){
  const it=items.find(i=>i.id===id);if(!it)return;
  if(it.kind==='pgn'&&openPgnHook)openPgnHook(id,it.title);
  else run(id);
  if(!it.status)invoke('set_status',{ids:[id],status:'reading'}).then(v=>{items=v;render()}).catch(()=>{}); // abrir um item novo = começou a ler
}
let openPgnHook=null;
export const setOpenPgn=f=>{openPgnHook=f};
export const refreshLib=()=>invoke('list_items').then(v=>{items=v;render();autoCovers()}).catch(()=>{});

function prev(c){$('ePrev').style.cssText=c?`background-image:url(${c})`:grad(cur.title)}
function edit(id){
  cur=items.find(i=>i.id===id);newCover=undefined;delArmed=false;$('libDel').textContent='Excluir';
  $('eTitle').value=cur.title;$('eAuthor').value=cur.author||'';$('eCat').value=cur.category||'';$('eSt').value=cur.status||'';$('eNote').value=cur.note||'';prev(cur.cover);$('fromBook').hidden=cur.kind==='pgn';$('dlg').showModal();
}
$('pick').onclick=()=>$('cov').click();
$('cov').onchange=async e=>{const f=e.target.files[0];if(!f)return;const c=await resize(f);if(c){newCover=c;prev(c)}e.target.value=''};
$('clr').onclick=()=>{newCover='';prev(null)};
$('fromBook').onclick=async()=>{const b=$('fromBook'),t=b.textContent;b.disabled=true;const c=await bookCover(cur);if(c){newCover=c;prev(c)}else{b.textContent='Nenhuma imagem encontrada';await new Promise(r=>setTimeout(r,1800))}b.textContent=t;b.disabled=false};
$('cancel').onclick=()=>$('dlg').close();
$('save').onclick=async()=>{
  const cover=newCover===undefined?cur.cover:newCover;
  items=await invoke('update_item',{id:cur.id,title:$('eTitle').value.trim()||cur.title,author:$('eAuthor').value.trim(),category:$('eCat').value.trim(),status:$('eSt').value,note:$('eNote').value.trim(),cover});
  $('dlg').close();render();autoCovers();
};
$('libDel').onclick=async()=>{
  if(!delArmed){delArmed=true;$('libDel').textContent='Confirmar (apaga o arquivo)';return}
  items=await invoke('delete_item',{id:cur.id});$('dlg').close();render();
};

export const libReady=invoke('list_items').then(v=>{items=v;render();autoCovers()}).catch(()=>{});
