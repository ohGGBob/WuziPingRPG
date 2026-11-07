/** Navigation for the studio home.
 * Back peels off the top transient layer, then returns to home.
 * Home is the root: another back asks to leave the app and does not
 * reveal the editor underneath. Drafts are kept; only 「保存」 writes
 * an original phone file.
 */
export const BACK={
  DIALOG:'dialog',
  DRAWER:'drawer',
  DRAW:'draw',
  SEARCH:'search',
  LECTURE_TAB:'lectureTab',
  EDITOR:'editor',
  HOME:'home',
  EXIT:'exit'
};

export const HOME_ACTIONS=[
  {id:'python',group:'common',title:'写 Python',resume:'继续写 Python',detail:'离线运行代码和项目文件'},
  {id:'notepad',group:'common',title:'记事本',resume:'继续记事本',detail:'写字，草稿自动留在本机'},
  {id:'ai',group:'common',title:'AI 助手',resume:'继续 AI 助手',detail:'对话和手机工具，敏感操作要你点允许'},
  {id:'lecture',group:'more',title:'上课',resume:'继续上课',detail:'录音、笔记和时间轴'},
  {id:'tts',group:'more',title:'英文朗读',resume:'继续英文朗读',detail:'按句子朗读英文'},
  {id:'game',group:'more',title:'星火远征',resume:'继续星火远征',detail:'原来的游戏存档还在'}
];

const MODES=new Set(HOME_ACTIONS.map(item=>item.id));

function flag(value){return value===true;}
function normalize(ctx){
  const value=ctx&&typeof ctx==='object'?ctx:{};
  const mode=MODES.has(value.mode)?value.mode:'';
  const lectureTab=value.lectureTab==='timeline'||value.lectureTab==='slides'?value.lectureTab:'notes';
  return {
    dialogOpen:flag(value.dialogOpen),
    drawerOpen:flag(value.drawerOpen),
    drawing:flag(value.drawing),
    searchOpen:flag(value.searchOpen),
    homeOpen:flag(value.homeOpen)||flag(value.landingOpen),
    loungeOpen:flag(value.loungeOpen),
    mode,
    lectureTab,
    recording:flag(value.recording),
    running:flag(value.running),
    files:Array.isArray(value.files)?value.files:[],
    activePath:typeof value.activePath==='string'?value.activePath:'',
    resumeMode:MODES.has(value.resumeMode)?value.resumeMode:'',
    exitRequested:flag(value.exitRequested),
    flushed:flag(value.flushed)
  };
}

export function resolveBack(ctx){
  const value=normalize(ctx);
  if(value.dialogOpen)return {action:BACK.DIALOG};
  if(value.homeOpen)return {action:BACK.EXIT};
  if(value.drawerOpen)return {action:BACK.DRAWER};
  if(value.drawing)return {action:BACK.DRAW};
  if(value.searchOpen)return {action:BACK.SEARCH};
  if(value.mode==='lecture'&&value.lectureTab!=='notes')return {action:BACK.LECTURE_TAB};
  if(value.loungeOpen&&value.mode!=='game')return {action:BACK.EDITOR};
  return {action:BACK.HOME};
}

/** One back step. Does not discard file text. */
export function stepBack(ctx){
  const current=normalize(ctx);
  const decision=resolveBack(current);
  const next={...current,files:current.files};
  switch(decision.action){
    case BACK.DIALOG:next.dialogOpen=false;break;
    case BACK.DRAWER:next.drawerOpen=false;break;
    case BACK.DRAW:next.drawing=false;break;
    case BACK.SEARCH:next.searchOpen=false;break;
    case BACK.LECTURE_TAB:next.lectureTab='notes';break;
    case BACK.EDITOR:next.loungeOpen=false;break;
    case BACK.HOME:
      next.homeOpen=true;
      next.resumeMode=current.mode||current.resumeMode;
      next.flushed=true;
      break;
    case BACK.EXIT:
      next.homeOpen=true;
      next.exitRequested=true;
      next.flushed=true;
      break;
    default:break;
  }
  return {action:decision.action,state:next};
}

export function repeatBack(ctx,times=6){
  const trace=[];
  let state=normalize(ctx);
  const limit=Math.max(0,Math.min(12,Math.floor(Number(times)||0)));
  for(let i=0;i<limit;i++){
    const step=stepBack(state);
    trace.push(step.action);
    state=step.state;
  }
  return {trace,state};
}

export function unsavedOriginals(files){
  const list=Array.isArray(files)?files:[];
  const out=[];
  for(const file of list){
    if(!file||typeof file.path!=='string'||!file.path)continue;
    if(typeof file.uri!=='string'||!file.uri)continue;
    if(file.text!==file.savedText)out.push(file.path);
  }
  return out;
}

export function leaveWork(ctx){
  const value=normalize(ctx);
  return {
    flush:true,
    keepDrafts:true,
    discardEdits:false,
    dirty:unsavedOriginals(value.files),
    files:value.files,
    resumeMode:value.mode||value.resumeMode,
    homeOpen:true
  };
}

export function exitCopy(files){
  const dirty=unsavedOriginals(files);
  if(!dirty.length)return {title:'退出天工？',message:'草稿会留在本机。还没点「保存」的内容不会写回手机上的原文件。游戏存档另外保存。'};
  const shown=dirty.slice(0,3).join('、');
  const more=dirty.length>3?' 等 '+dirty.length+' 个文件':'';
  return {title:'退出天工？',message:'还有修改没写回原文件：'+shown+more+'。草稿会留在本机，点「保存」才会写回。'};
}

export function resumeCard({mode,activePath,dirty=0,fromSession=false}={}){
  const meta=HOME_ACTIONS.find(item=>item.id===mode);
  if(!meta)return {visible:false,mode:'',title:'',detail:''};
  const where=activePath&&meta.id!=='game'&&meta.id!=='ai'?activePath:meta.detail;
  const count=Math.max(0,Math.floor(Number(dirty)||0));
  const extra=count>0?'有 '+count+' 处修改还没写回原文件':(fromSession?'刚才的内容还在':'草稿留在本机');
  return {visible:true,mode:meta.id,title:meta.resume,detail:where+' · '+extra};
}

export function canLeaveMode({recording=false,running=false,to=''}={}){
  if(to==='home')return {ok:true,flush:true,reason:''};
  if(recording&&to!=='lecture')return {ok:false,flush:false,reason:'recording'};
  if(running&&(to==='python'||to==='notepad'||to==='lecture'||to==='tts'||to==='ai'))return {ok:false,flush:false,reason:'running'};
  return {ok:true,flush:true,reason:''};
}
