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
import {initMediaStore,putMedia,resolveMedia,releaseMedia,deleteMedia,collectMedia,mediaUrl,mediaMessage,mediaNative,beginAudio} from './media-store.js';

const NOTES_PATH='课堂笔记.md';
const MAX_SLIDES=50,SLIDE_MAX_W=1024,SLIDE_QUALITY=0.8;
const CHECKPOINT_MS=15000;      // 录音检查点：音频本身已经在写文件，这里只刷新时长/波形
const WORKSPACE_LIMIT=30*1024*1024;

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
  /* 光标行的高亮会在每个 gutter 上放一个空元素。时间戳列的 min-width
     把这个空元素撑开；光标滚出视口后元素被拆掉，列宽掉成 0，正文跟着变宽。
     占位符一直在，滚动不再改列宽。最长格式是 hh:mm:ss。 */
  initialSpacer:()=>new TimeMark('00:00:00',false),
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
/* 点击跳转只认左侧时间戳 gutter：以前整个编辑区的 click 都会 seek + 自动播放，
   写笔记时随手点一下正文就跳走音频、移动光标也会打断播放，太容易误触。 */
const lectureExtensions=[stampField,timeGutter,playHighlight];
export {lectureExtensions};

/* ---------------- 模块状态 ---------------- */

let env=null;                    // app.js 注入的钩子
let engine=null,playback=null,timeline=null;
let barState='idle';             // idle|starting|recording|recpaused|stopping|stopped|playing|playpaused|error
let persist={audio:null,anchors:[],slides:[],notes:[],translate:false,demoire:demoireSanitize(null),rate:1};
let pendingStamps=[];
let slideSeq=0,uiReady=false,animRaf=0,editAnchorId=null,previewSlideId=null,lastPlayPos=-1,showingRaw=false;
/* 当前讲到第几页（0 基）：翻页条与「翻页即打点」共用。 */
let curSlide=0;
/* 「从本行播放 10 秒」的自动暂停计时器，任何手动播放/暂停都要先取消它。 */
let lineStopTimer=0;
const RATES=[1,1.25,1.5,2];
/* 去摩尔纹的原图只留在内存里供「对比原图」，不写进工作区快照。 */
const rawSlides=new Map();
let toastTimer=0;
let ui={};
/* 录音期间音频由原生边收边写（streamSink），检查点只剩「把时长/波形记进草稿」。
   settling 是停止录音后的落盘计数：>0 时 lectureBusy() 仍为真，
   宿主退出前的轮询不会在 persist.audio 还是空的时候就把 WebView 销毁。 */
let checkpointTimer=0,sessionRef='',playbackJob=null,stopping=false,settling=0,pendingOldRef='',pendingOldAudio=null,streamSink=null;

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
/* 录音引用：新版是 lecture-media/xxx.webm（外置），旧工作区里还是 data: 内嵌，
   两种都要能读，否则升级后用户上节课的录音直接消失。 */
function audioRef(audio){
  const item=audio||persist.audio;
  if(!item)return '';
  return String(item.ref||item.data||'');
}
function slideRef(slide){return slide?String(slide.ref||slide.data||''):'';}
function hasAudio(){return !!audioRef();}
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
    rate:$('playRate'),linePlay:$('linePlay'),
    anchors:$('anchorList'),slides:$('slideList'),import:$('importSlide'),slideInput:$('slideInput'),
    stage:$('slideStage'),slideNow:$('slideNow'),slideNowLabel:$('slideNowLabel'),slidePos:$('slidePos'),
    slidePrev:$('slidePrev'),slideNext:$('slideNext'),slideMark:$('slideMark'),
    importPptx:$('importPptx'),pptxInput:$('pptxInput'),
    tabs:$('lectureTabs'),
    anchorDialog:$('anchorDialog'),anchorLabel:$('anchorLabel'),anchorTime:$('anchorTime'),anchorSlide:$('anchorSlide'),
    slideDialog:$('slideDialog'),slideImage:$('slideImage'),slideTitle:$('slideTitle'),slideSeek:$('slideSeek'),
    slideToggleRaw:$('slideToggleRaw'),slideMoveUp:$('slideMoveUp'),slideMoveDown:$('slideMoveDown'),slideDelete:$('slideDelete'),
    demoireEnabled:$('demoireEnabled'),demoireStrength:$('demoireStrength'),demoireValue:$('demoireValue')
  };
  timeline=new Timeline(ui.canvas,{
    onSeek:t=>{if(hasAudio())seekTo(t,true);},
    onAnchor:a=>{seekTo(a.time,false);openAnchorDialog(a);}
  });
  ui.record.addEventListener('click',()=>{
    try{
      if(barState==='idle'||barState==='starting'||barState==='error')void startRecording();
      else if(barState==='playing')pauseAudio();
      else if(barState==='stopped'||barState==='playpaused')void playAudio();
    }catch(e){
      hint('按钮处理出错：'+((e&&e.message)||e));
      reportError('record click: '+((e&&(e.stack||e.message))||e));
    }
  });
  ui.pause.addEventListener('click',()=>{
    if(barState==='recording')pauseRecording();
    else if(barState==='recpaused')resumeRecording();
  });
  ui.stop.addEventListener('click',()=>{void stopRecording();});
  ui.newRec.addEventListener('click',()=>{
    if(hasAudio()&&!window.confirm('开始新录音会替换当前音频与锚点（PPT 照片保留，笔记正文会另存一份），继续吗？'))return;
    void startRecording();
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
  ui.zoomIn.addEventListener('click',()=>{timeline.zoom(1);ui.range.textContent=timeline.rangeLabel();});
  ui.zoomOut.addEventListener('click',()=>{timeline.zoom(-1);ui.range.textContent=timeline.rangeLabel();});
  for(const tab of ui.tabs.querySelectorAll('.lecture-tab')){
    tab.addEventListener('click',()=>{
      document.body.dataset.lectureTab=tab.dataset.tab;
      for(const t of ui.tabs.querySelectorAll('.lecture-tab')){
        t.classList.toggle('active',t===tab);
        t.setAttribute('aria-selected',String(t===tab));
      }
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
  ui.slideDialog.addEventListener('close',()=>{previewSlideId=null;showingRaw=false;});
  ui.slideSeek.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(slide&&slide.anchorTime!=null){seekTo(slide.anchorTime,true);ui.slideDialog.close();}
  });
  /* 预览里直接管理页面：删除 / 前移 / 后移（以前库满了提示「请先删除一些页面」，却没有入口）。 */
  if(ui.slideDelete)ui.slideDelete.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(slide)deleteSlide(slide);
  });
  if(ui.slideMoveUp)ui.slideMoveUp.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(slide)moveSlide(slide,-1);
  });
  if(ui.slideMoveDown)ui.slideMoveDown.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(slide)moveSlide(slide,1);
  });
  if(ui.slideToggleRaw)ui.slideToggleRaw.addEventListener('click',()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    const raw=slide?rawSlides.get(slide.id):null;
    if(!slide||!raw)return;
    showingRaw=!showingRaw;
    ui.slideImage.src=showingRaw?raw:slideUrl(slideRef(slide));
    ui.slideToggleRaw.textContent=showingRaw?'看修复后':'对比原图';
  });
  const slideDemoire=$('slideDemoire');
  if(slideDemoire)slideDemoire.addEventListener('click',async()=>{
    const slide=persist.slides.find(s=>s.id===previewSlideId);
    if(!slide||slideDemoire.disabled)return;
    if(persist.demoire.strength<=0){notify('请先把去摩尔纹强度调到大于 0%');return;}
    slideDemoire.disabled=true;
    try{
      const original=rawSlides.get(slide.id)||slideUrl(slideRef(slide));
      const img=await loadImage(original), cv=document.createElement('canvas');
      cv.width=img.width;cv.height=img.height;cv.getContext('2d').drawImage(img,0,0);
      const raw=cv.toDataURL('image/jpeg',SLIDE_QUALITY);
      const result=demoireCanvas(cv,persist.demoire.strength);
      if(!result.changed){notify('未检测到明显彩色摩尔纹，可调整强度或重新拍摄');return;}
      const data=cv.toDataURL('image/jpeg',SLIDE_QUALITY);
      let ref=data;try{ref=await putMedia(data.slice(data.indexOf(',')+1),'image/jpeg','slide-clean-'+Date.now()+'.jpg');}catch(e){reportError('处理结果保存在工作区：'+(e.message||e));}
      rawSlides.set(slide.id,raw);slide.ref=ref;delete slide.data;slide.demoire=true;
      showingRaw=false;ui.slideImage.src=slideUrl(ref);ui.slideToggleRaw.hidden=false;ui.slideToggleRaw.textContent='对比原图';
      renderSlides();renderSlideStage(false);env.scheduleSave();notify('已处理本页，可点对比原图');
    }catch(e){notify('处理失败：'+(e.message||e));}finally{slideDemoire.disabled=false;}
  });
  /* 播放倍速：复习时 1.25/1.5/2 倍循环切换 */
  if(ui.rate)ui.rate.addEventListener('click',()=>{
    const index=Math.max(0,RATES.indexOf(Number(persist.rate)));
    persist.rate=RATES[(index+1)%RATES.length];
    applyRate();
    env.scheduleSave();
    notify('播放速度 '+persist.rate+'×');
  });
  /* 从当前笔记行播放 10 秒：复习最常用的一条 */
  if(ui.linePlay)ui.linePlay.addEventListener('click',()=>{void playLineTen();});
  /* PPT 翻页：录音/播放中按「下一页」= 自动给新页打点 */
  if(ui.slidePrev)ui.slidePrev.addEventListener('click',()=>gotoSlide(curSlide-1,false));
  if(ui.slideNext)ui.slideNext.addEventListener('click',()=>gotoSlide(curSlide+1,true));
  if(ui.slideMark)ui.slideMark.addEventListener('click',()=>{linkCurrentSlide();});
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
    empty.textContent='还没有锚点。录音时开口说话会自动打点，也可以随手点「📌 标记锚点」。';
    list.append(empty);
  }
  refreshStatus();
}
function refreshStatus(){
  const el=document.getElementById('noteCount');
  if(el&&document.body.classList.contains('lecture'))el.textContent=lectureStatusText();
}
function renderSlides(){
  if(!uiReady)return;
  slideSeq=persist.slides.reduce((m,s)=>Math.max(m,parseInt(String(s.id).replace(/\D/g,''),10)||0),0)+1;
  const list=ui.slides;
  list.replaceChildren();
  persist.slides.forEach((slide,index)=>{
    const item=document.createElement('div');item.className='slideitem';item.dataset.index=String(index);
    const thumb=document.createElement('button');thumb.className='slidethumb';thumb.title=slide.name+'（长按删除）';
    const img=document.createElement('img');img.src=slideUrl(slideRef(slide));img.alt=slide.name;img.loading='lazy';
    thumb.append(img);
    thumb.addEventListener('click',()=>{if(longPressed){longPressed=false;return;}curSlide=index;renderSlideStage(false);openSlidePreview(slide);});
    /* 手机上没有右键：长按缩略图 = 删除这一页 */
    let pressTimer=0,longPressed=false;
    const startPress=()=>{longPressed=false;clearTimeout(pressTimer);pressTimer=setTimeout(()=>{longPressed=true;deleteSlide(slide);},650);};
    const cancelPress=()=>{clearTimeout(pressTimer);pressTimer=0;};
    thumb.addEventListener('pointerdown',startPress);
    thumb.addEventListener('pointerup',cancelPress);
    thumb.addEventListener('pointerleave',cancelPress);
    thumb.addEventListener('pointercancel',cancelPress);
    thumb.addEventListener('contextmenu',event=>{event.preventDefault();});
    const meta=document.createElement('div');meta.className='slidemeta';
    const time=document.createElement('button');time.className='slidetime';
    if(slide.anchorTime!=null){
      time.textContent='⏱ '+fmt(slide.anchorTime);
      time.title='跳到此页开始时间';
      time.addEventListener('click',()=>seekTo(slide.anchorTime,true));
    }else{
      time.textContent='＋ 锚点';
      time.title='标记为当前播放/录音时间';
      time.addEventListener('click',()=>{
        const t=markTime();
        if(t==null){notify('先开始录音或播放，再给这一页打点。');return;}
        linkSlideAt(slide,t);
        renderSlides();renderSlideStage(false);renderTimeline();
        env.scheduleSave();
      });
      time.classList.add('unlinked');
    }
    const name=document.createElement('span');name.className='slidename';name.textContent=slide.name;
    meta.append(time,name);
    item.append(thumb,meta);
    list.append(item);
  });
  if(!persist.slides.length){
    const empty=document.createElement('p');empty.className='slidempty';
    empty.textContent='还没有 PPT 页面。拍几张照片，或整个 PPT 文件导进来，每页都会挂在时间轴上。';
    list.append(empty);
  }
  renderSlideStage(false);
  refreshStatus();
}

/* ---------------- PPT 翻页与页面管理 ---------------- */
function clampSlide(index){return Math.max(0,Math.min(Math.max(0,persist.slides.length-1),index));}
function renderSlideStage(scroll){
  if(!uiReady)return;
  const total=persist.slides.length;
  if(total)curSlide=clampSlide(curSlide);else curSlide=0;
  const slide=total?persist.slides[curSlide]:null;
  if(ui.stage){
    ui.stage.hidden=!slide;
    if(slide){
      const src=slideUrl(slideRef(slide)),img=ui.slideNow;
      if(img&&img.getAttribute('src')!==src)img.src=src;
      if(img)img.alt=slide.name;
      if(ui.slideNowLabel)ui.slideNowLabel.textContent='第 '+(curSlide+1)+' / '+total+' 页'+(slide.anchorTime!=null?' · '+fmt(slide.anchorTime):'');
    }
  }
  if(ui.slidePos)ui.slidePos.textContent=total?(curSlide+1)+' / '+total:'0 / 0';
  if(ui.slidePrev)ui.slidePrev.disabled=curSlide<=0;
  if(ui.slideNext)ui.slideNext.disabled=!total||curSlide>=total-1;
  if(ui.slides)for(const item of ui.slides.querySelectorAll('.slideitem'))item.classList.toggle('active',total>0&&item.dataset.index===String(curSlide));
  if(scroll&&slide&&ui.slides){
    const item=ui.slides.querySelector('.slideitem[data-index="'+curSlide+'"]');
    try{if(item&&item.scrollIntoView)item.scrollIntoView({block:'nearest'});}catch(e){}
  }
}
/* 翻页：link=true 表示「翻页即打点」——录音/播放中翻到新页时自动记下时间，
   省掉「点缩略图 → 预览 → 关闭 → 再按标记」这一串。已经打过点的页不覆盖。 */
function gotoSlide(index,link){
  if(!persist.slides.length)return;
  curSlide=clampSlide(index);
  renderSlideStage(true);
  /* 只有正在录音/暂停时才「翻页即打点」：只是回放复习时翻页不该凭空生成锚点。 */
  if(link&&recActive())linkCurrentSlide(null,true);
}
/* 给当前页打点；auto=true 时只给还没打点的页补上，不覆盖手工调整过的时间 */
function linkCurrentSlide(time,auto){
  const slide=persist.slides[curSlide];
  if(!slide)return;
  const t=(time==null)?markTime():time;
  if(t==null){if(!auto)notify('先开始录音或播放，再给 PPT 打点。');return;}
  if(auto&&slide.anchorTime!=null)return;
  slide.anchorTime=Math.round(t*10)/10;
  linkSlideAt(slide,slide.anchorTime);
  renderSlides();renderSlideStage(false);renderTimeline();
  env.scheduleSave();
  if(!auto)notify('第 '+(curSlide+1)+' 页 · 已打点 '+fmt(slide.anchorTime));
}
function deleteSlide(slide){
  const index=persist.slides.indexOf(slide);
  if(index<0)return;
  if(!window.confirm('删除《'+slide.name+'》？这一页对应的时间点也会一起移除（笔记正文不受影响）。'))return;
  const orphanLabel='PPT：'+slide.name;
  persist.anchors=persist.anchors.filter(anchor=>{
    if(anchor.slideId!==slide.id)return true;
    if(anchor.label===orphanLabel)return false;   // 纯为这页建立的锚点一起删
    anchor.slideId=null;                          // 手动标记保留，只解除关联
    return true;
  });
  persist.slides.splice(index,1);
  try{deleteMedia(slideRef(slide));}catch(e){/* 外置文件可能已不存在 */}
  rawSlides.delete(slide.id);
  if(uiReady&&ui.slideDialog.open)ui.slideDialog.close();
  curSlide=clampSlide(index);
  renderAnchors();renderSlides();renderSlideStage(false);renderTimeline();
  env.scheduleSave();
  notify('已删除 1 页，剩余 '+persist.slides.length+' 页。');
}
function moveSlide(slide,delta){
  const index=persist.slides.indexOf(slide),to=index+delta;
  if(index<0||to<0||to>=persist.slides.length)return;
  persist.slides.splice(index,1);
  persist.slides.splice(to,0,slide);
  curSlide=to;
  renderSlides();renderSlideStage(true);
  if(uiReady&&ui.slideDialog.open)refreshSlideDialog(slide);
  env.scheduleSave();
  notify('已'+(delta<0?'前移':'后移')+'到第 '+(to+1)+' 页。');
}
/* ---------------- 播放倍速与单行复读 ---------------- */
function applyRate(){
  const rate=RATES.includes(Number(persist.rate))?Number(persist.rate):1;
  persist.rate=rate;
  if(uiReady&&ui.rate)ui.rate.textContent=rate+'×';
  if(playback){try{playback.audio.playbackRate=rate;}catch(e){/* 未加载 */}}
}
function cancelLineStop(){
  if(lineStopTimer){clearTimeout(lineStopTimer);lineStopTimer=0;}
}
/* 从光标所在笔记行的时间点播放 10 秒（倍速下按实际音频时长折算墙钟时间） */
async function playLineTen(){
  if(!hasAudio()){notify('还没有录音。点「🎙 开始录音」先录一段。');return;}
  let t=null;
  const view=env&&env.view();
  const field=view?view.state.field(stampField,false):null;
  if(view&&field&&field.stamps.length){
    const stamp=stampForLine(field,view.state.doc.lineAt(view.state.selection.main.head));
    if(stamp)t=stamp.time;
  }
  if(t==null)t=playTime();
  await seekTo(t,true);
  if(!playback||playback.audio.paused)return;
  cancelLineStop();
  lineStopTimer=setTimeout(()=>{
    lineStopTimer=0;
    if(playback&&!playback.audio.paused)pauseAudio();
  },Math.round(10000/Math.max(0.5,persist.rate||1)));
  notify('从 '+fmt(t)+' 播放 10 秒 · '+persist.rate+'×');
}

function renderTimeline(){
  if(!timeline)return;
  const duration=recActive()?Math.max(playDur(),currentElapsed()):playDur();
  /* 录音中优先用引擎里的实时包络：检查点落盘后 persist.audio 会变成
     45 秒前的快照，拿它画波形会看到进度条卡住。 */
  const envelope=recActive()?(engine?engine.envelope:[]):(persist.audio?persist.audio.envelope:[]);
  timeline.setData(duration,envelope,persist.anchors);
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

/* 上一节课留下的时间戳 / PPT 锚点必须在新录音开始前归档并清零：
   否则旧笔记行会按新课的音频时间跳到完全错误的位置。 */
function noteStamps(){
  if(!env)return [];
  const view=env.view();
  if(view&&env.activePath()===NOTES_PATH){
    const field=view.state.field(stampField,false);
    if(field)return field.stamps;
  }
  const state=env.editorState(NOTES_PATH);
  const field=state?state.field(stampField,false):null;
  return field?field.stamps:[];
}
function sessionLeftovers(){
  return {stamps:noteStamps().length,linked:persist.slides.filter(s=>s.anchorTime!=null).length};
}
function applySessionReset(){
  const before=sessionLeftovers();
  if(!before.stamps&&!before.linked)return '';
  let archived='';
  if(before.stamps&&env&&typeof env.archiveNote==='function'){
    /* 正文以文件模型为准：editorStates 里的快照只在切换文件时更新，
       用户一直在笔记里打字时它是旧的（甚至还是空的），会漏归档。 */
    const st=typeof env.getState==='function'?env.getState():null;
    const file=st&&st.files?st.files.find(f=>f.path===NOTES_PATH):null;
    let text=file?String(file.text||''):'';
    if(!text){
      const view=env.view&&env.view();
      if(view&&env.activePath&&env.activePath()===NOTES_PATH)text=view.state.doc.toString();
    }
    if(text.trim())archived=env.archiveNote(text)||'';
  }
  const view=env&&env.view();
  if(view&&env.activePath()===NOTES_PATH)view.dispatch({effects:setStamps.of([])});
  persist.notes=[];
  for(const slide of persist.slides)slide.anchorTime=null;
  renderSlides();renderTimeline();
  return archived;
}

function startCheckpoint(){
  stopCheckpoint();
  checkpointTimer=setInterval(()=>{saveCheckpoint();},CHECKPOINT_MS);
}
function stopCheckpoint(){
  if(checkpointTimer){clearInterval(checkpointTimer);checkpointTimer=0;}
}
/* 录音一开始就把引用写进草稿：音频是原生边录边写的文件，草稿里只要记下
   路径、时长和波形。进程被系统杀掉时，磁盘上已经写到最后一片，
   重开就能接着复习——不会再出现「整节课白录」。 */
function markLiveAudio(){
  if(!streamSink||!engine)return;
  const p=engine.progress();
  persist.audio={ref:streamSink.ref,mime:p.mime,duration:Math.round(p.duration*10)/10,envelope:p.envelope,checkpoint:true};
  if(env&&env.scheduleSave)env.scheduleSave();
}
/* 检查点：不需要再编码/重写音频（文件一直在写），只刷新草稿里的时长与波形。
   以前每 45 秒把累积的全部分片转一次 base64 重写，2 小时录音就是 19 MB
   字符串在 JS 与 Java 主线程上各过一遍，界面会卡一下。 */
function saveCheckpoint(){
  if(!engine||stopping||settling>0||!streamSink)return;
  if(engine.state!=='recording'&&engine.state!=='paused')return;
  markLiveAudio();
  const p=engine.progress();
  hint('录音中 · 已保存到 '+fmt(p.duration)+'（'+(p.bytes/1048576).toFixed(1)+' MB），意外退出最多丢 15 秒。');
}
/* 录音链路自己报错或被系统收走时（来电、拔耳机、切后台），
   立刻把已经录到的部分落盘，而不是等用户点停止才发现是空数据。 */
function onEngineEvent(info){
  if(!info||!engine)return;
  const reason=info.reason||'未知原因';
  reportError('录音链路异常（'+(info.type||'event')+'）：'+reason);
  hint('录音已中断：'+reason+'。正在保存已录到的部分…');
  void stopRecording({background:true});
}

async function startRecording(){
  if(engine||stopping)return;
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
    /* 先让原生层把 RECORD_AUDIO 权限拿到手，再调 getUserMedia。
       顺序反了的话，WebView 会在权限刚授予时初始化音频源失败，
       页面收到的是 NotReadableError（看起来像被别的应用占用）。 */
    if(env&&typeof env.requestMic==='function'){
      const granted=await env.requestMic();
      if(!granted){
        setBar('error');
        const reason='麦克风权限未开启。请在系统设置 → 应用 → 天工 → 权限 中允许麦克风，再点「重试」。';
        hint(reason);notify(reason);reportError('麦克风权限未授予');
        return;
      }
    }
    const leftover=sessionLeftovers();
    if((leftover.stamps||leftover.linked)&&!window.confirm(
      '开始新录音会清空上节课的 '+leftover.stamps+' 条笔记时间戳'+
      (leftover.linked?'和 '+leftover.linked+' 个 PPT 锚点':'')+
      '。\n上节课的笔记正文会另存为「课堂笔记-日期-时间.md」保留。继续吗？'))return;
    stopAudio();
    pendingOldRef=audioRef();
    pendingOldAudio=persist.audio?Object.assign({},persist.audio):null;
    persist.audio=null;persist.anchors=[];
    engine=new AudioEngine(()=>{notify('已达 2 小时录音上限，已自动停止。');void stopRecording();},onEngineEvent);
    /* 原生可用就让音频边录边写：先建文件，引擎每收到一个分片就顺序追加进去。
       这样停止时不需要把整段音频转成 base64 过桥，进程被杀也只丢最后一片。 */
    streamSink=mediaNative()?beginAudio('audio-'+Date.now(),'audio/webm'):null;
    if(streamSink){
      sessionRef=streamSink.ref;
      engine.attachSink({chunk:blob=>{
        streamSink.chunk(blob);
        if(!persist.audio)markLiveAudio();   // 第一片落地就把引用记进草稿
      }});
    }
    setBar('starting');
    hint('');
    try{
      engine.anchors=persist.anchors;   // 共享引用：录音期间 persist.anchors 始终可见
      await engine.start();
    }catch(err){
      /* 失败路径必须显式收尾：停轨道、关音频上下文，否则这台设备的麦克风会
         在自己进程里一直开着，用户点「重试」只会看到"被占用"。 */
      try{if(engine)engine.abortStart();}catch(cleanupError){/* 已释放 */}
      if(streamSink){streamSink.abort();streamSink=null;}   // 空的录音文件一并删掉
      setBar('error');engine=null;sessionRef='';
      if(pendingOldAudio){persist.audio=pendingOldAudio;pendingOldAudio=null;pendingOldRef='';}
      const message=micMessage(err);
      /* 先同步把基础原因写进提示条：设备枚举是异步的，万一它卡住，
         用户至少还能看到错误名，不会连"为什么失败"都没有。 */
      hint(message);
      notify(message);
      void micHint(err).then(detail=>{if(detail&&detail!==message)hint(detail);}).catch(()=>{});
      reportError('录音启动失败：'+(err&&err.name||'Error')+' '+(err&&err.message||''));
      return;
    }
    setBar('recording');
    lastPlayPos=-1;
    if(!streamSink)sessionRef='lecture-media/audio-'+Date.now()+'.webm';
    const archived=applySessionReset();
    startCheckpoint();
    updateTimer();
    ensureAnim();
    if(archived)notify('新一节开始，上节课笔记已归档为 '+archived+'。');
    else notify('录音已开始。每一行笔记都会自动记录时间戳。');
  }catch(fatal){
    engine=null;
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
/* options.background：切后台 / 退出时自动结束，不弹完成提示。
   options.exit：这是「停止并保存后退出」，不用为了回放把整段音频读进内存。 */
async function stopRecording(options){
  if(!engine||stopping)return;
  const background=!!(options&&options.background),exit=!!(options&&options.exit);
  stopping=true;
  /* 从点停止到落盘结束整条链都算「忙」：宿主退出前会轮询 lectureBusy()，
     以前 engine 一置空就返回 false，它立刻 flush（persist.audio 还是 null）
     并销毁 WebView，后面 742 行起的编码/写入全部作废——这就是「停止并保存后
     退出」丢录音的原因。 */
  settling++;
  stopCheckpoint();
  setBar('stopping');
  try{
    let result=null;
    try{
      result=await engine.stop();
    }catch(err){
      reportError('停止录音失败：'+((err&&err.message)||err));
    }
    engine=null;
    stopping=false;
    const interrupted=(result&&result.interrupted)||'';
    const bytes=result?(Number(result.bytes)||(result.blob?result.blob.size:0)):0;
    if(!result||!bytes){
      if(streamSink){streamSink.abort();streamSink=null;}
      sessionRef='';
      if(pendingOldAudio){persist.audio=pendingOldAudio;pendingOldAudio=null;pendingOldRef='';}
      setBar('idle');
      const reason=interrupted
        ?'录音中断，没有保存到有效数据：'+interrupted
        :'录音没有产生数据：麦克风可能刚启动就被系统收回。请检查麦克风权限后重试。';
      hint(reason);notify(reason);reportError(reason);
      if(env&&env.flush)env.flush();
      return;
    }
    try{
      persist.audio=await persistRecorded(result);
    }catch(err){
      setBar('idle');
      notify('录音数据编码失败：'+((err&&err.message)||err));
      reportError('录音落盘失败：'+((err&&err.stack||err.message)||err));
      return;
    }
    persist.anchors.sort((a,b)=>a.time-b.time);
    sessionRef='';
    const stale=pendingOldRef;
    pendingOldRef='';pendingOldAudio=null;
    if(stale&&stale!==audioRef()&&stale.indexOf('lecture-media/')===0)deleteMedia(stale);
    /* 切后台时不要为了回放把整段音频读进内存（2 小时约 14 MB）：
       回到前台第一次播放/跳转会自己加载。 */
    if(!exit){
      if(background)void loadPlayback(true);
      else await loadPlayback(true);
    }
    setBar('stopped');
    if(interrupted)hint('录音被中断（'+interrupted+'），已保存录到的 '+fmt(persist.audio.duration)+'。');
    renderAnchors();renderTimeline();updateTimer();
    if(env&&typeof env.onLectureCapture==='function')env.onLectureCapture({duration:persist.audio&&persist.audio.duration||0,anchors:persist.anchors.length,ref:audioRef()});
    if(env&&env.flush)env.flush();
    if(!background)notify('录音完成：'+fmt(persist.audio.duration)+' · '+persist.anchors.length+' 个锚点。');
    else notify('录音已在后台结束并保存：'+fmt(persist.audio.duration)+'。');
  }finally{
    streamSink=null;
    settling=Math.max(0,settling-1);
  }
}
/* 把停下来的录音变成一条可持久化的引用。
   正常路径：原生那边已经把分片写成文件，关流拿回引用即可（不碰 base64）。
   兜底一：关流失败，退回「整段 base64 → mediaPut」。
   兜底二：外置也失败，内嵌 data URL（草稿会变大，但录音不丢）。 */
async function persistRecorded(result){
  const duration=Math.round(result.duration*10)/10;
  const envelope=result.envelope;
  if(result.streamed&&streamSink){
    try{
      const saved=await streamSink.end();
      if(saved&&saved.bytes>0)return {ref:saved.ref,mime:result.mime,duration,envelope};
    }catch(err){
      reportError('录音落盘失败，改用整段保存：'+((err&&err.message)||err));
      hint('录音文件写入失败（'+((err&&err.message)||err)+'），已改用整段保存，草稿会变得很大。');
    }
  }
  if(!result.blob||!result.blob.size)throw new Error('录音数据为空');
  const base64=await blobToBase64(result.blob);
  const name=sessionRef?sessionRef.slice(sessionRef.lastIndexOf('/')+1):('audio-'+Date.now()+'.webm');
  try{
    const ref=await putMedia(base64,result.mime,name);
    return {ref,mime:result.mime,duration,envelope};
  }catch(err){
    reportError('录音外置失败，已内嵌保存：'+((err&&err.message)||err));
    hint('录音文件写入失败（'+((err&&err.message)||err)+'），已改用内嵌保存，草稿会变得很大。');
    return {ref:'data:'+result.mime+';base64,'+base64,mime:result.mime,duration,envelope};
  }
}
function markAnchor(){
  const t=markTime();
  if(t==null){notify('先开始录音或播放，再标记锚点。');return;}
  const anchor=engine&&engine.state!=='idle'
    ?engine.markManual('标记 '+fmt(t))
    :(persist.anchors.push({id:'a'+Date.now()+'-m',time:Math.round(t*10)/10,type:'manual',label:'标记 '+fmt(t),slideId:null}),persist.anchors[persist.anchors.length-1]);
  persist.anchors.sort((a,b)=>a.time-b.time);
  /* 按页码顺序找第一张还没打点的页：以前是 reverse().find()，导完 50 页 PPT
     第一次打点会关联到第 50 页，跟上课顺序正好相反。 */
  const slide=persist.slides.find(s=>s.anchorTime==null);
  if(slide){
    linkSlideAt(slide,t,anchor);
    curSlide=persist.slides.indexOf(slide);
  }
  renderAnchors();renderSlides();renderSlideStage(false);renderTimeline();
  env.scheduleSave();
  notify('已标记 '+fmt(t)+(slide?' · 关联第 '+(curSlide+1)+' 页':''));
}
function markTime(){
  if(engine&&engine.state!=='idle')return currentElapsed();
  if(hasAudio()&&(barState==='playing'||barState==='playpaused'||barState==='stopped'))return playTime();
  return null;
}
function linkSlideAt(slide,time,anchor){
  if(typeof time!=='number'||!isFinite(time)||time<0)return;
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
  if(name==='NotAllowedError'||name==='SecurityError'||name==='PermissionDeniedError')return '麦克风权限被拒绝。请在系统设置 → 应用 → 天工 → 权限中允许麦克风，然后点「重试」。';
  if(name==='NotFoundError'||name==='DevicesNotFoundError')return '没有找到可用的麦克风设备。';
  /* WebView 里这个错误大多数时候**不是**别的应用在占用：宿主缺少音频权限、
     音频服务还没释放上一路采集、音频焦点刚被切换，都会报同一个名字。
     引擎已经退避重试过，这里只把实情说清楚，别误导用户去关别的应用。 */
  if(name==='NotReadableError'||name==='TrackStartError')return '系统没有把麦克风交给页面（NotReadableError）。已自动重试，仍失败请重启应用再试。';
  if(name==='OverconstrainedError'||name==='ConstraintNotSatisfiedError')return '麦克风不支持所需的录音参数，请重试一次。';
  if(name==='NotSupportedError')return '当前 WebView 不支持这段录音，请更新 Android System WebView。';
  if(name==='AbortError')return '录音被系统中断，请重试。';
  return '录音启动失败：'+((err&&(err.message||err.name))||'未知错误');
}
/* 提示条里带可诊断的细节：错误名 + 系统向页面暴露的麦克风数量。
   0 个输入通常说明卡在权限/音频服务这一层，而不是被谁占用。 */
async function micHint(err){
  const base=micMessage(err);
  const parts=[];
  if(err&&err.name)parts.push(String(err.name));
  try{
    if(navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices){
      /* 有的 WebView 在权限未就绪时枚举会一直挂着，必须设上限。 */
      const devices=await Promise.race([
        navigator.mediaDevices.enumerateDevices(),
        new Promise(resolve=>setTimeout(()=>resolve(null),800))
      ]);
      if(devices)parts.push('系统暴露 '+devices.filter(d=>d&&d.kind==='audioinput').length+' 个麦克风输入');
    }
  }catch(e){/* 枚举失败不影响主提示 */}
  return base+(parts.length?'（'+parts.join(' · ')+'）':'');
}

/* ---------------- 播放与同步 ---------------- */

function ensurePlayback(){
  if(playback)return playback;
  playback=new Playback();
  playback.audio.addEventListener('ended',()=>{setBar('stopped');timeline.setPlayhead(null);dispatchPlayLine(null);updateTimer();});
  playback.audio.addEventListener('play',()=>{setBar('playing');applyRate();ensureAnim();});
  playback.audio.addEventListener('pause',()=>{if(barState==='playing'){setBar('playpaused');}updateTimer();});
  return playback;
}
/* 录音来源可能是外置文件（lecture-media/*.webm），必须 fetch 成 blob 再播：
   本地资源服务不支持 Range，直接给 <audio> 的话进度条拖不动。 */
async function loadPlayback(force){
  const ref=audioRef();
  if(!ref)return false;
  const p=ensurePlayback();
  if(!force&&p.loadedKey===ref&&p.url)return true;
  if(playbackJob&&playbackJob.ref===ref)return playbackJob.promise;
  const promise=(async()=>{
    try{
      const src=await resolveMedia(ref,persist.audio?persist.audio.mime:'');
      /* 等待期间可能已经换课或重录。过期结果不能盖住新的录音。 */
      if(audioRef()!==ref)return false;
      p.load(src);
      p.loadedKey=ref;
      updateTimer();
      return true;
    }catch(err){
      /* 在途 fetch 被 release 后会 reject。那是取消，不是当前文件损坏：
         不能清掉新录音的 loadedKey，也不能把「读取失败」报到当前这一条上。 */
      if(audioRef()!==ref)return false;
      p.loadedKey='';
      reportError('录音读取失败：'+((err&&err.message)||err));
      return false;
    }
  })();
  playbackJob={ref,promise};
  try{return await promise;}
  finally{if(playbackJob&&playbackJob.promise===promise)playbackJob=null;}
}
async function playAudio(){
  if(!hasAudio()){notify('还没有录音。点「🎙 开始录音」先录一段。');return;}
  const ref=audioRef();
  const ok=await loadPlayback();
  /* 加载完成时已经换成另一条录音：别把旧请求的失败说成文件损坏，也别自动开播。 */
  if(audioRef()!==ref)return;
  if(!ok){notify('录音数据无法解码，可能已经损坏。');return;}
  const p=ensurePlayback();
  p.audio.play().then(()=>{setBar('playing');ensureAnim();}).catch(()=>notify('播放失败，请再试一次。'));
}
function pauseAudio(){
  cancelLineStop();
  if(!playback)return;
  playback.audio.pause();
  setBar('playpaused');
  updateTimer();
}
function stopAudio(){
  cancelLineStop();
  if(!playback)return;
  playback.audio.pause();
  try{playback.audio.currentTime=0;}catch(e){/* 未加载 */}
  dispatchPlayLine(null);
  if(timeline)timeline.setPlayhead(null);
}
async function seekTo(t,play){
  if(!hasAudio())return;
  const ref=audioRef();
  if(!await loadPlayback()||audioRef()!==ref)return;
  const p=ensurePlayback();
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

/* 原生把选中的照片/整份 pptx 复制进 slide-cache/ 后只回传文件名，
   JS 用页面同源 URL 读取：既不需要 content:// 权限，也不用把几 MB 的 base64
   塞进 evaluateJavascript。压缩后的页面图再写进 lecture-media/ 长期保存。 */
function slideUrl(name){
  const text=String(name||'');
  if(/^(?:https?:|data:|blob:)/i.test(text))return text;
  return mediaUrl(text);
}
function loadImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error('图片解码失败：'+url));
    img.src=url;
  });
}
/* 每页压缩成长边 1024px 的 JPEG 后立刻外置保存，工作区 JSON 里只留引用。 */
async function storeSlideImage(data,label,w,h){
  const base64=data.slice(data.indexOf(',')+1);
  let ref=data;
  try{
    ref=await putMedia(base64,'image/jpeg','slide-'+Date.now()+'-'+(slideSeq+1)+'.jpg');
  }catch(err){
    reportError('图片外置失败，已内嵌保存：'+((err&&err.message)||err));
  }
  /* 尺寸键名必须与 lectureSanitize 读取的 width/height 一致，否则保存/恢复后尺寸丢失。 */
  return {id:'s'+(slideSeq++),name:String(label||('slide_'+slideSeq)).slice(0,60),ref,width:w,height:h,anchorTime:null,createdAt:Date.now()};
}
/* 按最长边缩放：竖拍照片也要压进 1024px，只按宽度缩会超出工作区配额。 */
export function slideScale(w,h,max=SLIDE_MAX_W){
  const width=Number.isFinite(w)&&w>0?w:max;
  const height=Number.isFinite(h)&&h>0?h:Math.round(max*0.75);
  const scale=Math.min(1,max/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
async function compressSlide(source,label){
  const img=await loadImage(source);
  const {width:w,height:h}=slideScale(img.width,img.height);
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  cv.getContext('2d').drawImage(img,0,0,w,h);
  const raw=cv.toDataURL('image/jpeg',SLIDE_QUALITY);
  if(!raw.startsWith('data:image/'))throw new Error('压缩失败');
  /* 拍后即时去摩尔纹：只压色度、保留亮度，PPT 文字不会被磨糊。
     原图只留在内存里供「对比原图」，不写进工作区快照。 */
  const setting=demoireSanitize(persist.demoire);
  let cleaned=false;
  if(setting.enabled){
    try{cleaned=demoireCanvas(cv,setting.strength).changed;}catch(e){cleaned=false;}
  }
  const data=cleaned?cv.toDataURL('image/jpeg',SLIDE_QUALITY):raw;
  const slide=await storeSlideImage(data,label,w,h);
  if(cleaned)rawSlides.set(slide.id,raw);
  slide.demoire=cleaned;
  return slide;
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
  for(let i=0;i<take.length;i++){
    const slide=await storeSlideImage(take[i],base+' · 第'+(i+1)+'页',result.width,result.height);
    persist.slides.push(slide);
  }
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
  if(env&&typeof env.onLectureMaterial==='function')env.onLectureMaterial({count:added,skippedPages});
  notify('已导入 '+added+' 张 PPT 页面'+(skippedPages?'（有 '+skippedPages+' 页无法渲染）':'')+'。录音中点「📌 标记锚点」即可关联当前页。');
}
function refreshSlideDialog(slide){
  if(!uiReady||!slide)return;
  const index=persist.slides.indexOf(slide);
  previewSlideId=slide.id;
  showingRaw=false;
  ui.slideImage.src=slideUrl(slideRef(slide));
  ui.slideTitle.textContent=slide.name+' · 第 '+(index+1)+' / '+persist.slides.length+' 页';
  ui.slideSeek.disabled=slide.anchorTime==null;
  ui.slideSeek.textContent=slide.anchorTime!=null?('跳到此页开始（'+fmt(slide.anchorTime)+'）'):'跳到此页开始';
  const hasRaw=!!rawSlides.get(slide.id);
  if(ui.slideToggleRaw){ui.slideToggleRaw.hidden=!hasRaw;ui.slideToggleRaw.textContent='对比原图';}
  if(ui.slideMoveUp)ui.slideMoveUp.disabled=index<=0;
  if(ui.slideMoveDown)ui.slideMoveDown.disabled=index>=persist.slides.length-1;
}
function openSlidePreview(slide){
  ensureUI();
  curSlide=Math.max(0,persist.slides.indexOf(slide));
  refreshSlideDialog(slide);
  renderSlideStage(false);
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
  /* <dialog> 的 returnValue 会保留上一次的值：上次点过「删除」的话，
     这次按 ESC 关闭也会被当成 delete，把锚点误删。showModal 前清空。 */
  ui.anchorDialog.returnValue='';
  ui.anchorDialog.showModal();
}
function onAnchorDialogClose(){
  const dialog=ui.anchorDialog;
  const anchor=persist.anchors.find(a=>a.id===editAnchorId);
  editAnchorId=null;
  /* 读一次就清空：ESC / 点遮罩关闭时 returnValue 不会再沿用上一次的动作。 */
  const action=dialog.returnValue;
  dialog.returnValue='';
  if(!anchor)return;
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
export function parseTime(text){
  const raw=String(text||'').trim();
  if(!raw)return null;
  let seconds;
  if(/^\d+(\.\d+)?$/.test(raw)){
    seconds=Number(raw);
  }else{
    const parts=raw.split(':').map(Number);
    /* '1:-2' 的加权和是 58：只拒绝负的总和会把这种负字段存成一个正时间。 */
    if(parts.some(n=>!Number.isFinite(n)||n<0))return null;
    seconds=parts.reverse().reduce((sum,n,i)=>sum+n*Math.pow(60,i),0);
  }
  /* 纯数字太长会变成 Infinity，冒号路径也可能算出负数。两种都不能存进锚点。 */
  return Number.isFinite(seconds)&&seconds>=0?seconds:null;
}

/* ---------------- app.js 集成点 ---------------- */

export function initLecture(hooks){
  env=hooks;
  initMediaStore(hooks);
}
export function lectureModeEnter(){
  installGlobalErrorHook();
  ensureUI();
  applyRate();
  renderSlideStage(false);
  document.body.dataset.lectureTab=document.body.dataset.lectureTab||'notes';
  setBar(hasAudio()?'stopped':'idle');
  refreshAll();
  hint('');
  if(persist.audio)void loadPlayback();
  ensureAnim();
}
export function lectureModeLeave(){
  cancelLineStop();
  if(playback&&!playback.audio.paused)playback.audio.pause();
  if(!engine){setBar('idle');hint('');}
  dispatchPlayLine(null);
  if(timeline){timeline.setPlayhead(null);timeline.setData(0,[],[]);}
  updateTimer();
}
export function lectureBusy(){
  /* 「忙」= 正在录 或 正在落盘。宿主退出前轮询的就是这个值：
     只把 engine 当判据的话，engine 一置空它就以为结束，立刻 flush 并销毁
     WebView，而音频还在后面的 await 链里没写完。 */
  return settling>0||stopping||recActive();
}
/* 课堂笔记的模板插入保护：时间戳可能是当前文档里的 StateField，
   也可能在切走文件后留在 editorStates 里，或来自恢复的工作区快照。 */
export function lectureStampCount(){
  try{
    if(env&&env.view&&env.view()&&env.activePath&&env.activePath()===NOTES_PATH){
      const field=env.view().state.field(stampField,false);
      if(field)return field.stamps.length;
    }
    if(env&&env.editorState){
      const state=env.editorState(NOTES_PATH);
      const field=state?state.field(stampField,false):null;
      if(field)return field.stamps.length;
    }
  }catch(e){/* 编辑器还没就绪时退回快照计数 */}
  return persist.notes.length;
}
/* 切后台 / 息屏 / 退出：立刻结束录音并把已录到的部分落盘。
   原来 onPause 只 flush 草稿而音频还没写进去，等于整节课白录。
   info.exit=true 表示这次是退出，不需要再把整段音频读进内存做回放。 */
export function lectureSuspend(info){
  const exit=!!(info&&info.exit);
  if(!recActive())return settling>0||stopping;   // 已经在收尾：让宿主继续等
  void stopRecording({background:true,exit});
  return true;
}
export function lectureStatusText(){
  return persist.anchors.length+' 锚点 · '+persist.slides.length+' 张照片';
}
export function lectureSeekRecent(anchor){
  if(!anchor||typeof anchor!=='object')return false;
  ensureUI();
  const value=Number(anchor.value);
  if(anchor.kind==='page'&&Number.isFinite(value)){
    curSlide=clampSlide(Math.max(0,Math.round(value)-1));
    renderSlideStage(false);
    return true;
  }
  if(anchor.kind==='time'&&Number.isFinite(value)&&hasAudio()){
    void seekTo(Math.max(0,value),false);
    return true;
  }
  return false;
}
/* 原生 mediaPut/mediaGc 的异步回执：app.js 收到未知类型时转进来。 */
export function lectureMediaMessage(m){return mediaMessage(m);}
/* 媒体引用校验：外置是短路径，旧工作区是 data URL，两者都要放行但要限量。 */
function validMediaRef(ref,maxData){
  if(!ref)return false;
  if(/^data:/i.test(ref))return ref.length<=maxData;
  return ref.length<=200&&ref.indexOf('lecture-media/')===0;
}
export function lectureSanitize(data){
  const d=(data&&typeof data==='object')?data:{};
  const rawAudio=(d.audio&&typeof d.audio==='object')?d.audio:null;
  const audioRefText=rawAudio?String(rawAudio.ref||rawAudio.data||''):'';
  const audio=validMediaRef(audioRefText,48*1024*1024)?{
    ref:audioRefText,
    mime:String(rawAudio.mime||'audio/webm').slice(0,80),
    duration:Math.max(0,Math.round((Number(rawAudio.duration)||0)*10)/10),
    envelope:Array.isArray(rawAudio.envelope)?rawAudio.envelope.filter(v=>typeof v==='number'&&isFinite(v)&&v>=0&&v<2).slice(0,20000).map(v=>Math.round(v*10000)/10000):[]
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
    .filter(s=>s&&validMediaRef(slideRef(s),6*1024*1024))
    .slice(0,MAX_SLIDES)
    .map((s,i)=>({
      id:String(s.id||('s'+(i+1))).slice(0,32),
      name:String(s.name||('slide_'+(i+1))).slice(0,60),
      ref:slideRef(s),
      /* 旧快照的尺寸键是 w/h：兼容读取，恢复后统一按 width/height 落盘。 */
      width:Math.max(1,Math.min(4096,Number(s.width||s.w)||SLIDE_MAX_W)),
      height:Math.max(1,Math.min(4096,Number(s.height||s.h)||768)),
      anchorTime:typeof s.anchorTime==='number'&&isFinite(s.anchorTime)?Math.round(s.anchorTime*10)/10:null,
      createdAt:Number(s.createdAt)||Date.now()
    })):[];
  const notes=Array.isArray(d.notes)?d.notes
    .filter(n=>n&&typeof n.pos==='number'&&isFinite(n.pos)&&n.pos>=0&&typeof n.time==='number'&&isFinite(n.time)&&n.time>=0)
    .slice(0,5000)
    .map(n=>({pos:Math.round(n.pos),time:Math.round(n.time*10)/10})):[];
  return {audio,anchors,slides,notes,translate:!!d.translate,active:!!d.active,demoire:demoireSanitize(d.demoire),rate:RATES.includes(Number(d.rate))?Number(d.rate):1};
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
    demoire:persist.demoire,
    rate:persist.rate
  };
}
export function lectureAfterRestore(){
  const state=env?env.getState():null;
  const data=(state&&state.lecture)||{};
  persist={audio:data.audio||null,anchors:data.anchors||[],slides:data.slides||[],notes:[],translate:!!data.translate,demoire:demoireSanitize(data.demoire),rate:RATES.includes(Number(data.rate))?Number(data.rate):1};
  pendingStamps=(data.notes||[]).slice();
  persist.anchors.sort((a,b)=>a.time-b.time);
  if(playback){playback.release();playback=null;}
  if(uiReady){
    if(ui.translateCheck)ui.translateCheck.checked=!!persist.translate;
    syncTranslatePill();
    refreshAll();
    applyRate();
    renderSlideStage(false);
  }
  if(persist.audio)void loadPlayback(true);
  /* 换课/重录留下的媒体文件没有人引用就清掉，别让私有目录无限增长。 */
  collectMedia([audioRef()].concat(persist.slides.map(slideRef)).filter(Boolean));
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
    persist={audio:clean.audio,anchors:clean.anchors,slides:clean.slides,notes:[],translate:!!clean.translate,demoire:clean.demoire,rate:clean.rate};
    persist.anchors.sort((a,b)=>a.time-b.time);
    ensureUI();
    if(persist.audio)void loadPlayback(true);
    setBar(hasAudio()?'stopped':'idle');
    refreshAll();
    return lectureDebug.info();
  },
  seek:t=>{void seekTo(Number(t)||0,false);return playTime();},
  stamp(list){const view=env&&env.view();if(view&&env.activePath()===NOTES_PATH&&Array.isArray(list))view.dispatch({effects:setStamps.of(list)});return lectureDebug.info();},
  time:()=>playTime(),
  anchors:()=>persist.anchors.slice(),
  slides:()=>persist.slides.slice(),
  importSlideUrls:urls=>importSlideUrls(urls),
  importPptxUrls:urls=>importPptxUrls(urls),
  checkpoint:()=>{saveCheckpoint();return persist.audio;},
  suspend:info=>lectureSuspend(info),
  busy:()=>lectureBusy(),
  stop:()=>stopRecording({background:true}),
  leftovers:()=>sessionLeftovers(),
  info(){return {bar:barState,audio:hasAudio(),duration:playDur(),anchors:persist.anchors.length,slides:persist.slides.length,ref:audioRef(),busy:lectureBusy(),streaming:!!streamSink};}
};
