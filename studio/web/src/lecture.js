/* 上课模式：录音 + 时间戳笔记 + 锚点 + PPT 照片，按时间轴同步。
   数据保存在工作区 state.lecture，随草稿自动保存/恢复；全部离线。
   - CodeMirror 扩展：行首时间戳 gutter、播放高亮、点击行跳转
   - AudioEngine：录音 + 能量 VAD 自动锚点；Playback：blob 回放
   - Timeline：canvas 波形 + 播放头 + 缩放 */

import {StateField,StateEffect} from '@codemirror/state';
import {gutter,GutterMarker,Decoration,EditorView} from '@codemirror/view';
import {AudioEngine,Playback,blobToBase64,fmt} from './audio-engine.js';
import {Timeline} from './timeline.js';
import {renderPptx} from './pptx.js';
import {demoireCanvas,demoireSanitize} from './demoire.js';

const NOTES_PATH='课堂笔记.md';
const MAX_SLIDES=50,SLIDE_MAX_W=1024,SLIDE_QUALITY=0.8;

/* ---------------- CodeMirror 时间戳标注 ---------------- */

const setStamps=StateEffect.define();    // [{pos,time}] 全量替换
const setPlayLine=StateEffect.define();  // 当前播放对应行首 pos | null

class TimeMark extends GutterMarker{
  constructor(text,on){super();this.text=text;this.on=on;}
  eq(other){return other instanceof TimeMark&&other.text===this.text&&other.on===this.on;}
  toDOM(){const span=document.createElement('span');span.className='cm-note-time'+(this.on?' on':'');span.textContent=this.text;return span;}
}
const stampField=StateField.define({
  create:()=>({stamps:[],play:null}),
  update(value,tr){
    let stamps=value.stamps,play=value.play,mut=false;
    for(const e of tr.effects){
      if(e.is(setStamps)){stamps=e.value.slice().sort((x,y)=>x.pos-y.pos);mut=true;}
      else if(e.is(setPlayLine)){play=e.value;mut=true;}
    }
    if(tr.docChanged){
      const mapped=[];
      for(const s of stamps)mapped.push({pos:tr.changes.mapPos(s.pos,-1),time:s.time});
      if(recActive()){
        const now=currentElapsed();
        tr.changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
          const text=tr.state.doc.sliceString(fromB,toB);
          /* 空文档里敲下第一行：第一行同样记时间戳 */
          if(fromA===0&&toA===0&&tr.startState.doc.length===0&&text&&text[0]!=='\n')mapped.push({pos:0,time:now});
          let idx=text.indexOf('\n');
          while(idx>=0){mapped.push({pos:fromB+idx+1,time:now});idx=text.indexOf('\n',idx+1);}
        });
      }
      mapped.sort((x,y)=>x.pos-y.pos||x.time-y.time);
      stamps=[];let last=-1;
      for(const s of mapped){if(s.pos===last)continue;last=s.pos;stamps.push(s);}
      mut=true;
    }
    return mut?{stamps,play}:value;
  }
});
function stampForLine(f,line){
  let best=null;
  for(const s of f.stamps){
    if(s.pos<line.from)continue;
    if(s.pos>line.to)break;
    if(!best||s.time<best.time)best=s;
  }
  return best;
}
function currentNotePos(f){
  if(f.play==null||!f.stamps.length)return null;
  let best=null;
  for(const s of f.stamps){if(s.time<=f.play&&(!best||s.time>best.time))best=s;}
  return best?best.pos:null;
}
const timeGutter=gutter({
  class:'cm-note-times',
  lineMarker(view,line){
    const f=view.state.field(stampField,false);
    if(!f||!f.stamps.length)return null;
    const s=stampForLine(f,line);
    if(!s)return null;
    const on=currentNotePos(f)!=null&&line.from<=currentNotePos(f)&&currentNotePos(f)<=line.to;
    return new TimeMark(fmt(s.time),on);
  },
  lineMarkerChange:update=>update.docChanged||update.transactions.some(tr=>tr.effects.some(e=>e.is(setPlayLine)||e.is(setStamps))),
  domEventHandlers:{
    mousedown(view,line){
      const f=view.state.field(stampField,false);
      const s=f&&stampForLine(f,line);
      if(s&&hasAudio()){seekTo(s.time,true);return true;}
      return false;
    }
  }
});
const playHighlight=EditorView.decorations.compute([stampField],state=>{
  const f=state.field(stampField,false);
  const pos=f?currentNotePos(f):null;
  if(pos==null)return Decoration.none;
  const line=state.doc.lineAt(pos);
  return Decoration.set([Decoration.line({class:'cm-note-playing'}).range(line.from)]);
});
const noteClick=EditorView.domEventHandlers({
  click(event,view){
    if(!hasAudio())return false;
    const pos=view.posAtCoords({x:event.clientX,y:event.clientY});
    if(pos==null)return false;
    const f=view.state.field(stampField,false);
    if(!f||!f.stamps.length)return false;
    const s=stampForLine(f,view.state.doc.lineAt(pos));
    if(s){seekTo(s.time,true);}
    return false;
  }
});
const lectureExtensions=[stampField,timeGutter,playHighlight,noteClick];
export {lectureExtensions};

/* ---------------- 模块状态 ---------------- */

let env=null;                    // app.js 注入的钩子
let engine=null,playback=null,timeline=null;
let barState='idle';             // idle|starting|recording|recpaused|stopping|stopped|playing|playpaused|error
let persist={audio:null,anchors:[],slides:[],notes:[],translate:false,demoire:demoireSanitize(null)};
let pendingStamps=[];
let slideSeq=0,uiReady=false,animRaf=0,editAnchorId=null,previewSlideId=null,lastPlayPos=-1,showingRaw=false;
let toastTimer=0;
let ui={};

/* 提示统一走这里：打包后模块内的函数名会被压缩，直接裸调用 notify 在真机上是
   undefined（这是录音、PPT 导入“点了没反应”的根因），所以只经 env 钩子调用，
   并保留一个不依赖宿主的兜底，保证任何失败都有可见反馈。 */
function notify(text){
  const message=String(text==null?'':text);
  if(env&&typeof env.notify==='function'){env.notify(message);return;}
  const el=document.getElementById('toast');
  if(!el)return;
  el.textContent=message;el.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},3500);
}
/* 录音条下方的常驻提示：用于展示“为什么没录上”，不随 toast 消失。 */
function hint(text){
  const el=ui.hint||document.getElementById('lectureHint');
  if(!el)return;
  el.textContent=text||'';
  el.hidden=!text;
}
/* 真机没有控制台：任何脚本异常（包括未来回归的 ReferenceError）都必须
   变成可见提示 + logcat 记录，否则又是“点了没反应”。 */
let globalHookInstalled=false;
function installGlobalErrorHook(){
  if(globalHookInstalled)return;
  globalHookInstalled=true;
  const show=(where,msg)=>{
    const text='脚本异常（'+where+'）：'+String(msg||'未知').slice(0,160);
    hint(text);reportError(text);
  };
  window.addEventListener('error',e=>show('js',(e&&e.message)||''));
  window.addEventListener('unhandledrejection',e=>{
    const r=e&&e.reason;
    show('async',(r&&(r.stack||r.message))||r);
  });
}
function reportError(text){
  try{console.error('[lecture] '+text);}catch(e){/* 无控制台 */}
  if(env&&typeof env.reportError==='function')env.reportError(String(text));
}

function recActive(){return !!(engine&&(engine.state==='recording'||engine.state==='paused'));}
/* 翻译开关做成胶囊按钮：勾选框在视觉上隐藏，靠 .on 表示状态。 */
function syncTranslatePill(){
  if(!ui.translateCheck)return;
  const pill=ui.translateCheck.closest('.rec-translate');
  if(pill)pill.classList.toggle('on',!!ui.translateCheck.checked);
}
function currentElapsed(){return engine?engine.elapsedSec():0;}
function hasAudio(){return !!(playback&&playback.url)||!!(persist.audio&&persist.audio.data);}
function playTime(){return playback&&playback.url?playback.audio.currentTime:0;}
function playDur(){return persist.audio?persist.audio.duration:(playback&&isFinite(playback.audio.duration)?playback.audio.duration:0);}

/* ---------------- UI ---------------- */

function $(id){return document.getElementById(id);}
function ensureUI(){
  if(uiReady)return;
  uiReady=true;
  ui={
    bar:$('lectureBar'),timer:$('recordTimer'),label:$('recordLabel'),hint:$('lectureHint'),
    record:$('recordBtn'),pause:$('pauseBtn'),stop:$('stopBtn'),newRec:$('newRecBtn'),anchor:$('anchorBtn'),
    translateToggle:$('translateToggle'),translateCheck:$('translateCheck'),
    canvas:$('timelineCanvas'),zoomIn:$('zoomIn'),zoomOut:$('zoomOut'),range:$('tlRange'),
    anchors:$('anchorList'),slides:$('slideList'),import:$('importSlide'),slideInput:$('slideInput'),
    importPptx:$('importPptx'),pptxInput:$('pptxInput'),
    tabs:$('lectureTabs'),
    anchorDialog:$('anchorDialog'),anchorLabel:$('anchorLabel'),anchorTime:$('anchorTime'),anchorSlide:$('anchorSlide'),
    slideDialog:$('slideDialog'),slideImage:$('slideImage'),slideTitle:$('slideTitle'),slideSeek:$('slideSeek'),
    slideToggleRaw:$('slideToggleRaw'),demoireEnabled:$('demoireEnabled'),demoireStrength:$('demoireStrength'),demoireValue:$('demoireValue')
  };
  timeline=new Timeline(ui.canvas,{
    onSeek:t=>{if(hasAudio())seekTo(t,true);},
    onAnchor:a=>{seekTo(a.time,false);openAnchorDialog(a);}
  });
  ui.record.addEventListener('click',()=>{
    try{
      if(barState==='idle'||barState==='starting'||barState==='error')startRecording();
      else if(barState==='playing')pauseAudio();
      else if(barState==='stopped'||barState==='playpaused')playAudio();
    }catch(e){
      hint('按钮处理出错：'+((e&&e.message)||e));
      reportError('record click: '+((e&&(e.stack||e.message))||e));
    }
  });
  ui.pause.addEventListener('click',()=>{
    if(barState==='recording')pauseRecording();
    else if(barState==='recpaused')resumeRecording();
  });
  ui.stop.addEventListener('click',stopRecording);
  ui.newRec.addEventListener('click',()=>{
    if(persist.audio&&persist.audio.data&&!window.confirm('开始新录音会替换当前音频与锚点（PPT 照片保留），继续吗？'))return;
    startRecording();
  });
  ui.anchor.addEventListener('click',markAnchor);
  if(ui.translateCheck){
    ui.translateCheck.checked=!!persist.translate;
    syncTranslatePill();
    ui.translateCheck.addEventListener('change',()=>{
      persist.translate=!!ui.translateCheck.checked;
      syncTranslatePill();
      env.scheduleSave();
      notify(persist.translate?'已开启实时翻译':'已关闭实时翻译');
    });
  }
  if(ui.demoireEnabled&&ui.demoireStrength){
    ui.demoireEnabled.checked=persist.demoire.enabled;
    ui.demoireStrength.value=Math.round(persist.demoire.strength*100);
    if(ui.demoireValue)ui.demoireValue.textContent=ui.demoireStrength.value+'%';
    ui.demoireEnabled.addEventListener('change',()=>{
      persist.demoire=demoireSanitize({enabled:ui.demoireEnabled.checked,strength:persist.demoire.strength});
      env.scheduleSave();
      notify(persist.demoire.enabled?'已开启拍后去摩尔纹（对新导入的照片生效）':'已关闭拍后去摩尔纹');
    });
    ui.demoireStrength.addEventListener('input',()=>{
      const pct=Number(ui.demoireStrength.value)||0;
      persist.demoire=demoireSanitize({enabled:persist.demoire.enabled,strength:pct/100});
      if(ui.demoireValue)ui.demoireValue.textContent=pct+'%';
      env.scheduleSave();
    });
  }
  if(ui.slideToggleRaw)ui.slideToggleRaw.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(!slide||!slide.raw)return;
    showingRaw=!showingRaw;
    ui.slideImage.src=showingRaw?slide.raw:slide.data;
    ui.slideToggleRaw.textContent=showingRaw?'看修复后':'对比原图';
  });
  ui.zoomIn.addEventListener('click',()=>{timeline.zoom(1);ui.range.textContent=timeline.rangeLabel();});
  ui.zoomOut.addEventListener('click',()=>{timeline.zoom(-1);ui.range.textContent=timeline.rangeLabel();});
  for(const tab of ui.tabs.querySelectorAll('.lecture-tab')){
    tab.addEventListener('click',()=>{
      document.body.dataset.lectureTab=tab.dataset.tab;
      for(const t of ui.tabs.querySelectorAll('.lecture-tab'))t.classList.toggle('active',t===tab);
      if(timeline)timeline.schedule();
    });
  }
  /* PPT 照片入口：安装包里交给原生相册选择器（无需 WebView 文件选择器与超大 base64），
     浏览器预览时退回 <input type="file">。 */
  ui.import.addEventListener('click',()=>{
    if(env&&typeof env.pickSlides==='function'&&env.pickSlides())return;
    ui.slideInput.click();
  });
  ui.slideInput.addEventListener('change',()=>importSlides(ui.slideInput.files));
  /* 整个 PPT 文件：安装包走原生文档选择器（文件复制进缓存，同源 URL 回传），
     浏览器预览退回隐藏 input。两者最终都进 importSlides / importPptxUrls。 */
  if(ui.importPptx)ui.importPptx.addEventListener('click',()=>{
    if(env&&typeof env.pickPptx==='function'&&env.pickPptx())return;
    if(ui.pptxInput)ui.pptxInput.click();
  });
  if(ui.pptxInput)ui.pptxInput.addEventListener('change',()=>importSlides(ui.pptxInput.files));
  ui.anchorDialog.addEventListener('close',onAnchorDialogClose);
  ui.slideDialog.addEventListener('close',()=>{previewSlideId=null;});
  ui.slideSeek.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(slide&&slide.anchorTime!=null){seekTo(slide.anchorTime,true);ui.slideDialog.close();}
  });
}
function setBar(state){
  barState=state;
  if(!uiReady)return;
  const rec=state==='recording',recPause=state==='recpaused',failed=state==='error';
  const stopped=state==='stopped'||state==='playing'||state==='playpaused';
  ui.bar.dataset.state=state;
  ui.record.hidden=rec||recPause||state==='stopping';
  ui.record.dataset.role=stopped?'play':(failed?'error':'rec');
  ui.label.textContent=stopped?(state==='playing'?'⏸ 暂停':'▶ 播放')
    :(state==='starting'?'启动中…':(failed?'⚠ 录音失败 · 重试':'🎙 开始录音'));
  ui.pause.hidden=!rec&&!recPause;
  ui.pause.textContent=recPause?'▶ 继续':'⏸ 暂停';
  ui.stop.hidden=!rec&&!recPause&&state!=='stopping';
  ui.newRec.hidden=!stopped;
  ui.anchor.hidden=!rec&&!recPause&&!stopped;
  ui.record.disabled=state==='starting';
  ui.stop.disabled=state==='stopping';
}
function renderAnchors(){
  if(!uiReady)return;
  const list=ui.anchors;
  list.replaceChildren();
  for(const anchor of persist.anchors){
    const row=document.createElement('div');row.className='anchorrow';
    const jump=document.createElement('button');jump.className='anchorjump';
    jump.title='跳到 '+fmt(anchor.time);
    const dot=document.createElement('i');dot.className='anchordot '+anchor.type;
    const time=document.createElement('b');time.textContent=fmt(anchor.time);
    const label=document.createElement('span');label.className='anchorlabel';
    label.textContent=anchor.label||(anchor.type==='speech'?'语音段':anchor.type==='silence'?'沉默':'手动标记');
    jump.append(dot,time,label);
    jump.addEventListener('click',()=>seekTo(anchor.time,true));
    const edit=document.createElement('button');edit.className='anchoredit';edit.textContent='✎';edit.title='编辑锚点';
    edit.addEventListener('click',()=>openAnchorDialog(anchor));
    row.append(jump,edit);
    list.append(row);
  }
  if(!persist.anchors.length){
    const empty=document.createElement('p');empty.className='anchorempty';
    empty.textContent='暂无锚点。录音时说话会自动标记，也可以点「📌 标记锚点」。';
    list.append(empty);
  }
}
function renderSlides(){
  if(!uiReady)return;
  slideSeq=persist.slides.reduce((m,s)=>Math.max(m,parseInt(String(s.id).replace(/\D/g,''),10)||0),0)+1;
  const list=ui.slides;
  list.replaceChildren();
  for(const slide of persist.slides){
    const item=document.createElement('div');item.className='slideitem';
    const thumb=document.createElement('button');thumb.className='slidethumb';thumb.title=slide.name;
    const img=document.createElement('img');img.src=slide.data;img.alt=slide.name;img.loading='lazy';
    thumb.append(img);
    thumb.addEventListener('click',()=>openSlidePreview(slide));
    const meta=document.createElement('div');meta.className='slidemeta';
    const time=document.createElement('button');time.className='slidetime';
    if(slide.anchorTime!=null){
      time.textContent='⏱ '+fmt(slide.anchorTime);
      time.title='跳到此页开始时间';
      time.addEventListener('click',()=>seekTo(slide.anchorTime,true));
    }else{
      time.textContent='＋ 锚点';
      time.title='标记为当前播放/录音时间';
      time.addEventListener('click',()=>linkSlideAt(slide,markTime()));
      time.classList.add('unlinked');
    }
    const name=document.createElement('span');name.className='slidename';name.textContent=slide.name;
    meta.append(time,name);
    item.append(thumb,meta);
    list.append(item);
  }
  if(!persist.slides.length){
    const empty=document.createElement('p');empty.className='slidempty';
    empty.textContent='还没有 PPT 页面。下方可以拍照片，也可以导入整个 PPT 文件，每一页都会记录在时间轴旁。';
    list.append(empty);
  }
}
function renderTimeline(){
  if(!timeline)return;
  const duration=recActive()?Math.max(playDur(),currentElapsed()):playDur();
  timeline.setData(duration,persist.audio?persist.audio.envelope:(engine?engine.envelope:[]),persist.anchors);
  timeline.setPlayhead(recActive()?currentElapsed():(barState==='playing'?playTime():timeline.playhead));
  if(uiReady)ui.range.textContent=timeline.rangeLabel();
}
function refreshAll(){
  renderAnchors();renderSlides();renderTimeline();
  if(barState==='recording'||barState==='recpaused'||barState==='stopping')setBar('idle');
  if(!engine&&barState!=='stopped'&&barState!=='playing'&&barState!=='playpaused')setBar(hasAudio()?'stopped':'idle');
  updateTimer();
}

/* ---------------- 录音 ---------------- */

async function startRecording(){
  if(engine)return;
  /* 整个函数体包一层 try/catch：async 函数里 try 之外的同步异常会变成
     静默的 unhandledrejection——在真机上就是“点一下闪一下就没反应”。 */
  try{
    ensureUI();
    if(!AudioEngine.supported()){
      setBar('error');
      const reason='此设备的 WebView 不支持录音：缺少 MediaRecorder 或 getUserMedia。请更新 Android System WebView 后重试。';
      hint(reason);notify(reason);reportError(reason);
      return;
    }
    stopAudio();
    persist.audio=null;persist.anchors=[];
    engine=new AudioEngine(()=>{notify('已达 2 小时录音上限，已自动停止。');stopRecording();});
    setBar('starting');
    hint('');
    try{
      engine.anchors=persist.anchors;   // 共享引用：录音期间 persist.anchors 始终可见
      await engine.start();
    }catch(err){
      /* 先释放上一轮可能已经占住的麦克风，再允许「重试」。 */
      if(engine){try{engine.abort();}catch(e){}engine=null;}
      setBar('error');
      const message=micMessage(err);
      hint(message); /* 常驻横幅已经说明原因，不再重复弹一次 toast */
      reportError('录音启动失败：'+(err&&err.name||'Error')+' '+(err&&err.message||''));
      return;
    }
    setBar('recording');
    lastPlayPos=-1;
    updateTimer();
    ensureAnim();
    notify('录音已开始。每一行笔记都会自动记录时间戳。');
  }catch(fatal){
    if(engine){try{engine.abort();}catch(e){}engine=null;}
    setBar('error');
    const message='录音启动失败：'+((fatal&&(fatal.message||fatal.name))||'未知错误');
    hint(message);notify(message);
    reportError('startRecording fatal: '+((fatal&&(fatal.stack||fatal.message))||fatal));
  }
}
function pauseRecording(){
  if(!engine)return;
  engine.pause();
  setBar('recpaused');
  updateTimer();
}
function resumeRecording(){
  if(!engine)return;
  engine.resume();
  setBar('recording');
  ensureAnim();
}
async function stopRecording(){
  if(!engine)return;
  setBar('stopping');
  const result=await engine.stop();
  engine=null;
  if(!result||!result.blob||!result.blob.size){
    setBar('idle');
    notify('录音没有产生数据，请重试。');
    return;
  }
  try{
    const base64=await blobToBase64(result.blob);
    persist.audio={data:base64,mime:result.mime,duration:Math.round(result.duration*10)/10,envelope:result.envelope};
  }catch(err){
    setBar('idle');
    notify('录音数据编码失败：'+err.message);
    return;
  }
  persist.anchors.sort((a,b)=>a.time-b.time);
  ensurePlayback().load(persist.audio.data,persist.audio.mime);
  setBar('stopped');
  renderAnchors();renderTimeline();updateTimer();
  env.flush();
  notify('录音完成：'+fmt(persist.audio.duration)+' · '+persist.anchors.length+' 个锚点。');
}
function markAnchor(){
  const t=markTime();
  if(t==null){notify('先开始录音或播放，再标记锚点。');return;}
  const anchor=engine&&engine.state!=='idle'
    ?engine.markManual('标记 '+fmt(t))
    :(persist.anchors.push({id:'a'+Date.now()+'-m',time:Math.round(t*10)/10,type:'manual',label:'标记 '+fmt(t),slideId:null}),persist.anchors[persist.anchors.length-1]);
  persist.anchors.sort((a,b)=>a.time-b.time);
  const slide=[...persist.slides].reverse().find(s=>s.anchorTime==null);
  if(slide)linkSlideAt(slide,t,anchor);
  renderAnchors();renderSlides();renderTimeline();
  env.scheduleSave();
  notify('已标记 '+fmt(t)+(slide?' · 关联最新 PPT 照片':''));
}
function markTime(){
  if(engine&&engine.state!=='idle')return currentElapsed();
  if(hasAudio()&&(barState==='playing'||barState==='playpaused'||barState==='stopped'))return playTime();
  return null;
}
function linkSlideAt(slide,time,anchor){
  slide.anchorTime=Math.round(time*10)/10;
  if(!anchor){
    anchor=persist.anchors.find(a=>a.slideId===slide.id);
    if(!anchor){anchor={id:'a'+Date.now()+'-s',time:slide.anchorTime,type:'manual',label:'PPT：'+slide.name,slideId:slide.id};persist.anchors.push(anchor);}
  }
  anchor.slideId=slide.id;
  if(anchor.time!==slide.anchorTime){anchor.time=slide.anchorTime;persist.anchors.sort((a,b)=>a.time-b.time);}
}
function micMessage(err){
  const name=err&&err.name||'';
  if(name==='NotAllowedError'||name==='SecurityError')return '麦克风权限被拒绝。请在系统设置 → 应用 → 天工 → 权限中允许麦克风，然后点「重试」。';
  if(name==='NotFoundError'||name==='DevicesNotFound')return '没有找到可用的麦克风设备。';
  if(name==='NotReadableError'||name==='TrackStartError')return err&&err.fallbackAttempted===false
    ? '录音参数不被当前 WebView 支持，已自动切换；请点「重试」。'
    : '麦克风暂时无法启动：可能被其它录音/通话应用占用，或系统音频服务未就绪。请关闭其它应用后点「重试」。';
  if(name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError')return '麦克风不支持所需的录音参数，请重试一次。';
  if(name==='NotSupportedError')return '当前 WebView 不支持这段录音，请更新 Android System WebView。';
  if(name==='AbortError')return '录音被系统中断，请重试。';
  return '录音启动失败：'+((err&&(err.message||err.name))||'未知错误');
}

/* ---------------- 播放与同步 ---------------- */

function ensurePlayback(){
  if(playback)return playback;
  playback=new Playback();
  playback.audio.addEventListener('ended',()=>{setBar('stopped');timeline.setPlayhead(null);dispatchPlayLine(null);updateTimer();});
  playback.audio.addEventListener('play',()=>{setBar('playing');ensureAnim();});
  playback.audio.addEventListener('pause',()=>{if(barState==='playing'){setBar('playpaused');}updateTimer();});
  return playback;
}
function playAudio(){
  if(!persist.audio||!persist.audio.data){notify('还没有录音。点「🎙 开始录音」先录一段。');return;}
  const p=ensurePlayback();
  if(!p.url&&!p.load(persist.audio.data,persist.audio.mime)){notify('录音数据无法解码。');return;}
  p.audio.play().then(()=>{setBar('playing');ensureAnim();}).catch(()=>notify('播放失败，请再试一次。'));
}
function pauseAudio(){
  if(!playback)return;
  playback.audio.pause();
  setBar('playpaused');
  updateTimer();
}
function stopAudio(){
  if(!playback)return;
  playback.audio.pause();
  try{playback.audio.currentTime=0;}catch(e){/* 未加载 */}
  dispatchPlayLine(null);
  if(timeline)timeline.setPlayhead(null);
}
function seekTo(t,play){
  if(!persist.audio||!persist.audio.data)return;
  const p=ensurePlayback();
  if(!p.url&&!p.load(persist.audio.data,persist.audio.mime))return;
  const dur=playDur();
  try{p.audio.currentTime=Math.max(0,Math.min(dur||t,t));}catch(e){/* 元数据未就绪 */}
  timeline.setPlayhead(t);
  dispatchPlayLine(t);
  if(play)p.audio.play().then(()=>{setBar('playing');ensureAnim();}).catch(()=>{setBar('playpaused');updateTimer();});
  else{setBar(barState==='playing'?'playing':'playpaused');updateTimer();}
}
function playPosAt(t){
  const view=env&&env.view();
  const f=view?view.state.field(stampField,false):null;
  if(!f||!f.stamps.length)return null;
  let best=null;
  for(const s of f.stamps){if(s.time<=t&&(!best||s.time>best.time))best=s;}
  return best?best.pos:null;
}
function dispatchPlayLine(time){
  const view=env&&env.view();
  if(view)view.dispatch({effects:setPlayLine.of(time==null?null:time)});
}
function ensureAnim(){
  if(animRaf)return;
  const tick=()=>{
    animRaf=0;
    let busy=false;
    if(engine&&(engine.state==='recording'||engine.state==='paused')){
      busy=true;
      renderTimeline();
      updateTimer();
    }
    if(playback&&!playback.audio.paused){
      busy=true;
      const t=playback.audio.currentTime;
      timeline.setPlayhead(t);
      updateTimer();
      const view=env&&env.view();
      const f=view?view.state.field(stampField,false):null;
      const applied=f?currentNotePos(f):null;
      if(playPosAt(t)!==applied)dispatchPlayLine(t);   // 行变化时才下发新的播放时间
    }
    if(busy)animRaf=requestAnimationFrame(tick);
    else if(engine===null&&barState!=='recording'){updateTimer();}
  };
  animRaf=requestAnimationFrame(tick);
}
function updateTimer(){
  if(!uiReady)return;
  if(engine&&engine.state!=='idle'){
    ui.timer.textContent=fmt(currentElapsed());
  }else if(hasAudio()&&(barState==='stopped'||barState==='playing'||barState==='playpaused')){
    ui.timer.textContent=fmt(playTime())+' / '+fmt(playDur());
  }else if(persist.audio){
    ui.timer.textContent='00:00 / '+fmt(playDur());
  }else{
    ui.timer.textContent='00:00';
  }
}

/* ---------------- PPT 照片 ---------------- */

/* 原生把选中的照片压缩成 JPEG 写进 slide-cache/ 后只回传文件名，
   JS 用页面同源 URL 读取：既不需要 content:// 权限，也不用把几 MB 的 base64
   塞进 evaluateJavascript。 */
/* 资源命名空间根路径：页面固定是 <base>studio/index.html，剥掉这段就是
   slide-cache/ 所在的位置（appassets 源是 /，本机资源服务是 /<token>/）。 */
function assetBase(){
  const path=location.pathname||'/';
  const tail='studio/index.html';
  if(path.length>tail.length&&path.endsWith(tail))return location.origin+path.slice(0,path.length-tail.length);
  const cut=path.lastIndexOf('/');
  return location.origin+(cut>=0?path.slice(0,cut+1):'/');
}
function slideUrl(name){
  const text=String(name||'');
  if(/^(?:https?:|data:|blob:)/i.test(text))return text;
  return assetBase()+text.replace(/^\/+/,'');
}
function loadImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error('图片解码失败：'+url));
    img.src=url;
  });
}
async function compressSlide(source,label){
  const img=await loadImage(source);
  const scale=Math.min(1,SLIDE_MAX_W/(img.width||SLIDE_MAX_W));
  const w=Math.max(1,Math.round((img.width||SLIDE_MAX_W)*scale)),h=Math.max(1,Math.round((img.height||SLIDE_MAX_W*0.75)*scale));
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');ctx.drawImage(img,0,0,w,h);
  const raw=cv.toDataURL('image/jpeg',SLIDE_QUALITY);
  if(!raw.startsWith('data:image/'))throw new Error('压缩失败');
  /* 拍后即时去摩尔纹：只压色度、保留亮度，PPT 文字不会被磨糊。
     raw 只留在内存里供「对比原图」，不写进工作区快照。 */
  const setting=demoireSanitize(persist.demoire);
  let data=raw,cleaned=false;
  if(setting.enabled){
    try{cleaned=demoireCanvas(cv,setting.strength).changed;}catch(e){cleaned=false;}
    if(cleaned)data=cv.toDataURL('image/jpeg',SLIDE_QUALITY);
  }
  return {id:'s'+(slideSeq++),name:String(label||('slide_'+slideSeq)).slice(0,60),data,w,h,width:w,height:h,
    anchorTime:null,createdAt:Date.now(),raw:cleaned?raw:null,demoire:cleaned};
}
async function importSlides(files){
  ensureUI();
  const list=[...files||[]];
  if(ui.slideInput)ui.slideInput.value='';
  if(ui.pptxInput)ui.pptxInput.value='';
  if(!list.length)return;
  let added=0,firstError='',skippedPages=0;
  for(const file of list){
    const room=MAX_SLIDES-persist.slides.length;
    if(room<=0){notify('PPT 库已满（最多 '+MAX_SLIDES+' 张），后面的文件没有导入。');break;}
    const name=String(file.name||'');
    /* 整个 PPT 文件：浏览器预览走这里（原生渠道走 importPptxUrls）。 */
    if(/\.pptx$/i.test(name)||file.type==='application/vnd.openxmlformats-officedocument.presentationml.presentation'){
      try{
        notify('正在解析《'+name+'》，页数多时需要几秒…');
        const r=await addPptxSlides(await file.arrayBuffer(),name,room);
        added+=r.added;skippedPages+=r.skippedPages;
        if(r.total>r.added)notify('《'+name+'》共 '+r.total+' 页，剩余空间只装下了 '+r.added+' 页。');
      }catch(e){if(!firstError)firstError=e.message||String(e);}
      continue;
    }
    if(/\.ppt$/i.test(name)){
      if(!firstError)firstError='《'+name+'》是旧版 .ppt 格式：请先在 WPS/PowerPoint 里另存为 .pptx 再导入。';
      continue;
    }
    const url=URL.createObjectURL(file);
    try{
      persist.slides.push(await compressSlide(url,name));
      added++;
    }catch(e){if(!firstError)firstError=e.message||String(e);}
    finally{URL.revokeObjectURL(url);}
  }
  finishImport(added,firstError,skippedPages);
}
async function importSlideUrls(items){
  ensureUI();
  const list=[...items||[]].map(it=>typeof it==='string'?{url:it}:it);
  if(!list.length)return;
  let added=0,firstError='',skippedPages=0;
  for(const item of list){
    const room=MAX_SLIDES-persist.slides.length;
    if(room<=0){notify('PPT 库已满（最多 '+MAX_SLIDES+' 张），后面的文件没有导入。');break;}
    const name=String(item.name||item.url||'');
    if(/\.pptx$/i.test(name)){
      try{
        const r=await addPptxSlides(await fetchBuffer(slideUrl(item.url)),name,room);
        added+=r.added;skippedPages+=r.skippedPages;
        if(r.total>r.added)notify('该 PPT 共 '+r.total+' 页，剩余空间只装下了 '+r.added+' 页。');
      }catch(e){if(!firstError)firstError=e.message||String(e);}
      continue;
    }
    try{
      persist.slides.push(await compressSlide(slideUrl(item.url),name.split('/').pop()||('slide_'+(slideSeq+1))));
      added++;
    }catch(e){if(!firstError)firstError=e.message||String(e);}
  }
  finishImport(added,firstError,skippedPages);
}
/* 原生渠道导入整个 PPT 文件：原生已把 .pptx 复制进 slide-cache 并回传同源相对路径。 */
async function importPptxUrls(items){
  ensureUI();
  const list=[...items||[]].map(it=>typeof it==='string'?{url:it}:it);
  if(!list.length)return;
  if(MAX_SLIDES-persist.slides.length<=0){
    const message='PPT 库已满（最多 '+MAX_SLIDES+' 张），请先删除一些页面。';
    hint(message);notify(message);
    return;
  }
  let added=0,firstError='',skippedPages=0;
  for(const item of list){
    const room=MAX_SLIDES-persist.slides.length;
    if(room<=0)break;
    const name=String(item.name||item.url||'PPT');
    try{
      notify('正在解析《'+name+'》，页数多时需要几秒…');
      const r=await addPptxSlides(await fetchBuffer(slideUrl(item.url)),name,room);
      added+=r.added;skippedPages+=r.skippedPages;
      if(r.total>r.added)notify('《'+name+'》共 '+r.total+' 页，剩余空间只装下了 '+r.added+' 页。');
    }catch(e){if(!firstError)firstError=e.message||String(e);}
  }
  finishImport(added,firstError,skippedPages);
}
async function fetchBuffer(url){
  const res=await fetch(url);
  if(!res.ok)throw new Error('读取失败（HTTP '+res.status+'）');
  return res.arrayBuffer();
}
async function addPptxSlides(buffer,label,room){
  const result=await renderPptx(buffer,{maxW:SLIDE_MAX_W,quality:SLIDE_QUALITY});
  if(result.warnings&&result.warnings.length)reportError('PPT 部分页面渲染失败：'+result.warnings.join('；'));
  const base=(String(label||'PPT').split('/').pop().replace(/\.pptx?$/i,'').trim()||'PPT').slice(0,40);
  const take=result.images.slice(0,Math.max(0,room));
  take.forEach((data,i)=>{
    persist.slides.push({id:'s'+(slideSeq++),name:(base+' · 第'+(i+1)+'页').slice(0,60),data,w:result.width,h:result.height,anchorTime:null,createdAt:Date.now()});
  });
  return {added:take.length,total:result.images.length,skippedPages:result.warnings&&result.warnings.length||0};
}
function finishImport(added,firstError,skippedPages){
  renderSlides();renderTimeline();
  env.scheduleSave();
  if(!added){
    const message='PPT 导入失败：'+(firstError||'没有可识别的文件');
    hint(message);notify(message);reportError(message);
    return;
  }
  notify('已导入 '+added+' 张 PPT 页面'+(skippedPages?'（有 '+skippedPages+' 页无法渲染）':'')+'。录音中点「📌 标记锚点」即可关联当前页。');
}
function openSlidePreview(slide){
  ensureUI();
  previewSlideId=slide.id;
  showingRaw=false;
  ui.slideImage.src=slide.data;
  if(ui.slideToggleRaw){ui.slideToggleRaw.hidden=!slide.raw;ui.slideToggleRaw.textContent='对比原图';}
  ui.slideTitle.textContent=slide.name;
  ui.slideSeek.disabled=slide.anchorTime==null;
  ui.slideSeek.textContent=slide.anchorTime!=null?('跳到此页开始（'+fmt(slide.anchorTime)+'）'):'跳到此页开始';
  ui.slideDialog.showModal();
}

/* ---------------- 锚点编辑对话框 ---------------- */

function openAnchorDialog(anchor){
  ensureUI();
  editAnchorId=anchor.id;
  ui.anchorLabel.value=anchor.label||'';
  ui.anchorTime.value=String(anchor.time);
  const slide=anchor.slideId?persist.slides.find(s=>s.id===anchor.slideId):null;
  ui.anchorSlide.textContent=slide?('已关联 PPT：'+slide.name):'未关联 PPT 照片；把时间改成某张照片的开始处即可关联最新未标记照片。';
  ui.anchorDialog.showModal();
}
function onAnchorDialogClose(){
  const dialog=ui.anchorDialog;
  const anchor=persist.anchors.find(a=>a.id===editAnchorId);
  editAnchorId=null;
  if(!anchor)return;
  const action=dialog.returnValue;
  if(action==='delete'){
    const idx=persist.anchors.indexOf(anchor);
    if(idx>=0)persist.anchors.splice(idx,1);
    for(const slide of persist.slides)if(slide.anchorTime!=null&&anchor.slideId===slide.id&&Math.abs(slide.anchorTime-anchor.time)<0.05)slide.anchorTime=null;
  }else if(action==='save'){
    const parsed=parseTime(ui.anchorTime.value);
    if(parsed!=null)anchor.time=Math.round(parsed*10)/10;
    anchor.label=ui.anchorLabel.value.trim().slice(0,40);
    persist.anchors.sort((a,b)=>a.time-b.time);
  }else return;
  renderAnchors();renderSlides();renderTimeline();
  env.scheduleSave();
}
function parseTime(text){
  const raw=String(text||'').trim();
  if(!raw)return null;
  if(/^\d+(\.\d+)?$/.test(raw))return Number(raw);
  const parts=raw.split(':').map(Number);
  if(parts.some(n=>isNaN(n)))return null;
  return parts.reverse().reduce((sum,n,i)=>sum+n*Math.pow(60,i),0);
}

/* ---------------- app.js 集成点 ---------------- */

export function initLecture(hooks){
  env=hooks;
}
export function lectureModeEnter(){
  installGlobalErrorHook();
  ensureUI();
  document.body.dataset.lectureTab=document.body.dataset.lectureTab||'notes';
  setBar(hasAudio()?'stopped':'idle');
  refreshAll();
  hint('');
  if(persist.audio&&!playback){ensurePlayback().load(persist.audio.data,persist.audio.mime);}
  ensureAnim();
}
export function lectureModeLeave(){
  if(playback&&!playback.audio.paused)playback.audio.pause();
  setBar('idle');
  hint('');
  dispatchPlayLine(null);
  if(timeline){timeline.setPlayhead(null);timeline.setData(0,[],[]);}
  updateTimer();
}
export function lectureBusy(){
  return !!(engine&&(engine.state==='recording'||engine.state==='paused'));
}
export function lectureStatusText(){
  return persist.anchors.length+' 锚点 · '+persist.slides.length+' 张照片';
}
export function lectureSanitize(data){
  const d=(data&&typeof data==='object')?data:{};
  const audio=(d.audio&&typeof d.audio.data==='string'&&d.audio.data.length<40*1024*1024)?{
    data:d.audio.data,
    mime:String(d.audio.mime||'audio/webm').slice(0,80),
    duration:Math.max(0,Math.round((Number(d.audio.duration)||0)*10)/10),
    envelope:Array.isArray(d.audio.envelope)?d.audio.envelope.filter(v=>typeof v==='number'&&isFinite(v)&&v>=0&&v<2).slice(0,20000).map(v=>Math.round(v*10000)/10000):[]
  }:null;
  const anchors=Array.isArray(d.anchors)?d.anchors
    .filter(a=>a&&typeof a.time==='number'&&isFinite(a.time)&&a.time>=0)
    .slice(0,2000)
    .map((a,i)=>({
      id:String(a.id||('a'+(i+1))).slice(0,32),
      time:Math.round(a.time*10)/10,
      type:['speech','silence','manual'].includes(a.type)?a.type:'manual',
      label:String(a.label||'').slice(0,40),
      slideId:a.slideId?String(a.slideId).slice(0,32):null
    }))
    .sort((x,y)=>x.time-y.time):[];
  const slides=Array.isArray(d.slides)?d.slides
    .filter(s=>s&&typeof s.data==='string'&&s.data.startsWith('data:image/')&&s.data.length<6*1024*1024)
    .slice(0,MAX_SLIDES)
    .map((s,i)=>({
      id:String(s.id||('s'+(i+1))).slice(0,32),
      name:String(s.name||('slide_'+(i+1))).slice(0,60),
      data:s.data,
      width:Math.max(1,Math.min(4096,Number(s.width)||SLIDE_MAX_W)),
      height:Math.max(1,Math.min(4096,Number(s.height)||768)),
      anchorTime:typeof s.anchorTime==='number'&&isFinite(s.anchorTime)?Math.round(s.anchorTime*10)/10:null,
      createdAt:Number(s.createdAt)||Date.now()
    })):[];
  const notes=Array.isArray(d.notes)?d.notes
    .filter(n=>n&&typeof n.pos==='number'&&isFinite(n.pos)&&n.pos>=0&&typeof n.time==='number'&&isFinite(n.time)&&n.time>=0)
    .slice(0,5000)
    .map(n=>({pos:Math.round(n.pos),time:Math.round(n.time*10)/10})):[];
  return {audio,anchors,slides,notes,translate:!!d.translate,active:!!d.active,demoire:demoireSanitize(d.demoire)};
}
export function lectureSerialize(){
  let stamps=persist.notes;
  if(env){
    const active=env.activePath()===NOTES_PATH&&env.view()?env.view().state:env.editorState(NOTES_PATH);
    const field=active?active.field(stampField,false):null;
    if(field)stamps=field.stamps.map(s=>({pos:s.pos,time:Math.round(s.time*10)/10}));
  }
  return {
    active:env?env.workspaceMode()==='lecture':false,
    audio:persist.audio,
    anchors:persist.anchors,
    slides:persist.slides,
    notes:stamps,
    translate:!!persist.translate,
    demoire:persist.demoire
  };
}
export function lectureAfterRestore(){
  const state=env?env.getState():null;
  const data=(state&&state.lecture)||{};
  persist={audio:data.audio||null,anchors:data.anchors||[],slides:data.slides||[],notes:[],translate:!!data.translate,demoire:demoireSanitize(data.demoire)};
  pendingStamps=(data.notes||[]).slice();
  persist.anchors.sort((a,b)=>a.time-b.time);
  if(playback){playback.release();playback=null;}
  if(uiReady){
    if(persist.audio)ensurePlayback().load(persist.audio.data,persist.audio.mime);
    if(ui.translateCheck)ui.translateCheck.checked=!!persist.translate;
    syncTranslatePill();
    if(ui.demoireEnabled&&ui.demoireStrength){
      ui.demoireEnabled.checked=persist.demoire.enabled;
      ui.demoireStrength.value=Math.round(persist.demoire.strength*100);
      if(ui.demoireValue)ui.demoireValue.textContent=ui.demoireStrength.value+'%';
    }
    refreshAll();
  }
  /* restore() 中 createEditor 先于本函数执行，此时补一次注入，
     保证重启后时间戳直接出现在笔记 gutter 上。 */
  lectureViewCreated();
}
export function lectureViewCreated(){
  if(!env||!env.view())return;
  if(env.activePath()===NOTES_PATH&&pendingStamps.length){
    const view=env.view();
    view.dispatch({effects:setStamps.of(pendingStamps)});
    pendingStamps=[];
  }
}

/* ---------------- 调试/测试钩子 ---------------- */

export const lectureDebug={
  load(session){
    const clean=lectureSanitize(session);
    persist={audio:clean.audio,anchors:clean.anchors,slides:clean.slides,notes:[],demoire:clean.demoire};
    persist.anchors.sort((a,b)=>a.time-b.time);
    ensureUI();
    if(persist.audio)ensurePlayback().load(persist.audio.data,persist.audio.mime);
    setBar(hasAudio()?'stopped':'idle');
    refreshAll();
    return lectureDebug.info();
  },
  seek:t=>{seekTo(Number(t)||0,false);return playTime();},
  stamp(list){const view=env&&env.view();if(view&&env.activePath()===NOTES_PATH&&Array.isArray(list))view.dispatch({effects:setStamps.of(list)});return lectureDebug.info();},
  time:()=>playTime(),
  anchors:()=>persist.anchors.slice(),
  importSlideUrls:urls=>importSlideUrls(urls),
  importPptxUrls:urls=>importPptxUrls(urls),
  info(){return {bar:barState,audio:!!(persist.audio&&persist.audio.data),duration:playDur(),anchors:persist.anchors.length,slides:persist.slides.length};}
};
