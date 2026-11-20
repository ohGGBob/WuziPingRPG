export const RECENTS_LIMIT=200;
export const RECENT_GROUPS=['today','yesterday','week','month','older'];
export const RECENT_SOURCES=['import','scan','lecture','photo','code','ai'];
export const RECENT_FORMATS=['document','slides','image','audio','note','project'];

const SOURCE_LABEL={import:'导入',scan:'扫描',lecture:'上课',photo:'修图',code:'代码',ai:'AI'};
const FORMAT_LABEL={document:'文档',slides:'幻灯片',image:'图片',audio:'音频',note:'笔记',project:'工程'};
const DAY=86400000;

const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const integer=(value,min,max,fallback=0)=>{
  const n=Math.round(Number(value));
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
};

export function formatForPath(path=''){
  const ext=String(path).split('.').pop().toLowerCase();
  if(['ppt','pptx'].includes(ext))return 'slides';
  if(['png','jpg','jpeg','webp','gif'].includes(ext))return 'image';
  if(['mp3','m4a','wav','ogg','aac'].includes(ext))return 'audio';
  if(['md','txt'].includes(ext))return 'note';
  if(['tgscene','json','zip'].includes(ext))return 'project';
  return 'document';
}

export function sanitizeRecent(raw){
  const value=raw&&typeof raw==='object'?raw:{};
  const source=RECENT_SOURCES.includes(value.source)?value.source:'import';
  const path=text(value.path,300);
  const uri=text(value.uri,500);
  if(!path&&!uri)return null;
  const title=text(value.title,160)||path.split('/').pop()||'未命名材料';
  const format=RECENT_FORMATS.includes(value.format)?value.format:formatForPath(path);
  const openedAt=integer(value.openedAt,0,Number.MAX_SAFE_INTEGER,Date.now());
  const rawPayload=value.payload&&typeof value.payload==='object'?value.payload:{};
  const payload={};
  if(['time','page','para'].includes(rawPayload.kind))payload.kind=rawPayload.kind;
  if(rawPayload.value!=null&&Number.isFinite(Number(rawPayload.value)))payload.value=Math.max(0,Math.round(Number(rawPayload.value)*10)/10);
  if(typeof rawPayload.label==='string')payload.label=text(rawPayload.label,120);
  if(rawPayload.slideIndex!=null)payload.slideIndex=integer(rawPayload.slideIndex,0,100000);
  if(typeof rawPayload.uri==='string')payload.uri=text(rawPayload.uri,500);
  return {
    id:text(value.id,520)||source+':'+(path||uri),
    source,format,path,uri,title,
    size:integer(value.size,0,1024*1024*1024),
    pages:integer(value.pages,0,100000),
    openedAt,
    pinned:value.pinned===true,
    customTitle:value.customTitle===true,
    thumbnail:text(value.thumbnail,8192),
    payload
  };
}

export function sanitizeRecents(raw){
  const list=Array.isArray(raw)?raw:[];
  const seen=new Set(),all=[];
  for(const item of list){
    const clean=sanitizeRecent(item);
    if(!clean)continue;
    const key=clean.source+'\u0000'+(clean.path||clean.uri);
    if(seen.has(key))continue;
    seen.add(key);all.push(clean);
  }
  if(all.length<=RECENTS_LIMIT)return all;
  const pinned=all.filter(item=>item.pinned).slice(0,RECENTS_LIMIT);
  const keys=new Set(pinned.map(item=>item.id));
  const rest=all.filter(item=>!keys.has(item.id)).slice(0,RECENTS_LIMIT-pinned.length);
  return [...pinned,...rest].sort((a,b)=>b.openedAt-a.openedAt);
}

export function upsertRecent(list,item,now=Date.now()){
  const clean=sanitizeRecent({...item,openedAt:item&&item.openedAt!=null?item.openedAt:now});
  if(!clean)return sanitizeRecents(list);
  const key=clean.source+'\u0000'+(clean.path||clean.uri);
  const old=(Array.isArray(list)?list:[]).map(sanitizeRecent).find(entry=>entry&&(entry.source+'\u0000'+(entry.path||entry.uri))===key);
  const merged=old?sanitizeRecent({
    ...old,
    ...clean,
    title:old.customTitle?old.title:clean.title,
    customTitle:old.customTitle||clean.customTitle,
    pinned:old.pinned||clean.pinned,
    size:Math.max(old.size,clean.size),
    pages:Math.max(old.pages,clean.pages),
    thumbnail:clean.thumbnail||old.thumbnail,
    payload:{...old.payload,...clean.payload}
  }):clean;
  return sanitizeRecents([
    merged,
    ...(Array.isArray(list)?list:[]).filter(old=>{
      const c=sanitizeRecent(old);
      return c&&(c.source+'\u0000'+(c.path||c.uri))!==key;
    })
  ]);
}

export function removeRecent(list,id){
  return sanitizeRecents(list).filter(item=>item.id!==id);
}

export function togglePinned(list,id){
  return sanitizeRecents(list).map(item=>item.id===id?{...item,pinned:!item.pinned}:item);
}

export function renameRecent(list,id,title){
  const next=text(title,160).trim();
  if(!next)return sanitizeRecents(list);
  return sanitizeRecents(list).map(item=>item.id===id?{...item,title:next,customTitle:true}:item);
}

export function recentGroup(item,now=Date.now()){
  const start=new Date(now);start.setHours(0,0,0,0);
  const today=start.getTime();
  const t=Number(item&&item.openedAt)||0;
  if(t>=today)return 'today';
  if(t>=today-DAY)return 'yesterday';
  if(t>=today-6*DAY)return 'week';
  if(t>=today-29*DAY)return 'month';
  return 'older';
}

export function groupRecents(list,mode='time',now=Date.now()){
  const items=sanitizeRecents(list);
  const groups=new Map();
  const add=(key,item)=>{if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);};
  for(const item of items){
    if(mode==='source')add(SOURCE_LABEL[item.source],item);
    else if(mode==='format')add(FORMAT_LABEL[item.format],item);
    else add({today:'今天',yesterday:'昨天',week:'近7天',month:'本月',older:'更早'}[recentGroup(item,now)],item);
  }
  return [...groups].map(([title,rows])=>({title,items:rows}));
}

export function recentMeta(item){
  const pieces=[SOURCE_LABEL[item.source]||item.source];
  if(item.size>0)pieces.push(item.size>=1048576?(item.size/1048576).toFixed(1)+' MB':Math.max(1,Math.round(item.size/1024))+' KB');
  if(item.pages>0)pieces.push(item.pages+' 页');
  return pieces.join(' · ');
}
