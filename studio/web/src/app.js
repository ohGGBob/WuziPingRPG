import {PYTHON_LABS,normalizeLabProgress} from './python-lab.js';
import {renderPythonLabPanel} from './python-lab-panel.js';
import {renderStudyDesk} from './desk-study.js';
import {bindWorkspaceWheel} from './workspace-wheel.js';
import {bindWorkspacePages} from './workspace-pages.js';
import {renderCodeDesk,createDeskDraft,cppRunScope} from './desk-code.js';
import {defaultTabState,sanitizeTabState,selectTab,openTabPage,closeTabPage,rememberTabScroll,resolveTabBack,reselectTab,tabDepth} from './tabs.js';
import {sanitizeRecents,upsertRecent,groupRecents,recentMeta,formatForPath,removeRecent,togglePinned,renameRecent} from './recents.js';
import {defaultUi,sanitizeUi} from './state.js';
import {bindAiHandle} from './ai-handle.js';
import {EditorView,basicSetup} from 'codemirror';
import {EditorState,Compartment} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {indentWithTab,undo,redo,indentMore} from '@codemirror/commands';
import {python} from '@codemirror/lang-python';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';
import {cpp} from '@codemirror/lang-cpp';
import {java} from '@codemirror/lang-java';
import {markdown} from '@codemirror/lang-markdown';
import {HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {closeSearchPanel,openSearchPanel} from '@codemirror/search';
import {initLecture,lectureExtensions,lectureSerialize,lectureSanitize,lectureAfterRestore,lectureViewCreated,lectureModeEnter,lectureModeLeave,lectureBusy,lectureStatusText,lectureMediaMessage,lectureStampCount,lectureDebug,lectureSeekRecent} from './lecture.js';
import {initTTS,ttsExtensions,ttsSerialize,ttsSanitize,ttsAfterRestore,ttsModeEnter,ttsModeLeave,ttsHideBar,ttsShowBar,ttsDocumentChanged,ttsStatusText,ttsReceive,ttsDebug} from './tts.js';
import {initDraw,ensureDrawUI,enterDrawMode,exitDrawMode,isDrawMode,getDrawStrokes,loadDrawStrokes,getDrawView,loadDrawView} from './draw.js';
import {initAI,aiSerialize,aiSanitize,aiRestore,aiModeEnter,aiModeLeave,aiHidePanel,aiEnterPanel,aiStatusText,aiReceive,aiDebug} from './ai.js';
import {BACK,resolveBack,resolveEscapeBack,canLeaveMode,exitCopy,HOME_ACTIONS,HOME_ACTIONS as MODULES,moduleById,isNativeModule,moduleAvailability} from './back.js';
import {NOTE_TEMPLATES,templateById,templateFileName,sanitizeTemplateState,insertTemplate,noteTemplateAction,notepadTarget,isNotepadNotePath,shouldRememberCodePath} from './note-templates.js';
import {createQuizRequester,quizAIAvailability,normalizeQuizCount,gradeQuiz,retryWrongQuiz,quizToMarkdown,quizFileName,QUIZ_TYPE_LABELS,QUIZ_NOTE_LIMIT} from './quiz.js';
import {modelSanitize} from './model-data.js';
import {init as initModel} from './model3d.js';
import {readStoredTheme,sanitizeTheme,writeStoredTheme,themeFromSettings,applyTheme,themeColor} from './theme.js';
import {starSanitize} from './star-data.js';
import {splitLocations} from './error-loc.js';
import {snippetsFor,snippetById} from './snippets.js';
import {searchProject} from './project-search.js';
import {renderMarkdown} from './markdown.js';
import {DEFAULT_FOCUS,focusSanitize,focusToggle,focusReset,focusSkip,focusTick,focusSetMinutes,fmtTime,lastNDays} from './focus.js';
import {deckSanitize,addCard,removeCard,reviewCard,previewInterval,dueCards,deckStats} from './cards.js';
import {importCards,importMistakes,exportCards,exportMistakes,updateCard,importSummary} from './transfer.js';
import {SUBJECTS,MASTERY,CAUSES,bookSanitize,addMistake,updateMistake,setMastery,removeMistake,filterMistakes,bookStats,causeStats,recordQuizMistake,unfiledQuizMistakes,makeMistakeCard} from './mistakes.js';
import {habitsSanitize,addHabit,removeHabit,isChecked,toggleCheck,currentStreak,bestStreak,totalChecks,lastNDaysChecks,habitsStats} from './habits.js';
import {DAYS,PERIODS,COURSE_COLORS,scheduleSanitize,addCourse,updateCourse,removeCourse,coursesOnDay,nowInfo,currentStatus,fmtMin} from './schedule.js';
import {splitChapters,shelfSanitize,novelSettingsSanitize,progressText} from './novel.js';
import {QUIZ_SUBJECTS,bankCount,quizById,getBank,parseBankText,DIFF_LABELS} from './quiz-data.js';
import {quizStatsSanitize,buildQuiz as mqBuild,answerQuiz as mqAnswerFn,nextQuiz as mqNextFn,prevQuiz as mqPrevFn,skipQuiz as mqSkipFn,gradeQuiz as mqGrade,accuracy as mqAccuracy,sessionSummary as mqSummary,displayOptions,chosenDisplay,toggleStar as mqToggleStar,sanitizeSession as mqSanitizeSession,sessionWrongList as mqWrongList} from './medquiz.js';
import {examsSanitize,addExam,removeExam,updateExam,addMilestone,toggleMilestone,removeMilestone,sortExams,examProgress,countdownText,daysUntil} from './exams.js';
import {CALCULATORS,calcById,runCalc} from './medcalc.js';
import {LAYERS,PRESETS,defaultSoundscape,soundscapeSanitize,setLayer,setMaster,applyPreset,startTimer,clearTimer,timerRemaining,fadeGain,activeLayers} from './soundscape.js';
import {createSoundscapeAudio} from './soundscape-audio.js';
import {createSoundscapeVisual} from './soundscape-visual.js';
import {buildBackup,parseBackup,backupSummary} from './backup.js';
import {studyLogSanitize,logStudy,dayCounts} from './study-log.js';
import {fxBoot,setFx,fxEnabled,fxStored,fxPreferred,warp,materialize,hudMark} from './fx.js';
import {buildOverview} from './overview.js';
import {radarPoints,radarPolygon} from './study-radar.js';
import {init as initPelican} from './pelican3d.js';
import {pelicanSanitize} from './pelican.js';

const $=id=>document.getElementById(id),native=!!window.StudioBridge,MAX_FILE=2*1024*1024;
/* 输入防抖：列表快筛逐键重渲染会卡，停顿 120ms 再渲染。 */
function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};}
/* 轻触感反馈：打卡/评分/掌握等确认动作给一个短震动，不支持则静默。 */
function tap(){try{if(navigator.vibrate)navigator.vibrate(12);}catch(e){}}
/* 卡片到期标签：到期/今天/明天/N天后，比单纯间隔更直观。 */
function dueLabel(c,now){
  if(c.due<=now)return '到期';
  const dayStart=new Date(now);dayStart.setHours(0,0,0,0);
  const dueDay=new Date(c.due);dueDay.setHours(0,0,0,0);
  const days=Math.round((dueDay-dayStart)/86400000);
  if(days<=0)return '今天';
  if(days===1)return '明天';
  return days+'天后';
}
/* 列表分页：长列表一次全量建 DOM 是点开/滑动卡顿源之一。
   首屏只渲染 PAGE 条，点「显示更多」增量追加，不重建已有行。 */
const PAGE=60;
function appendMore(list,total,shown,onMore){
  if(shown>=total)return;
  const b=document.createElement('button');b.type='button';b.className='list-more';
  b.textContent='显示更多（还有 '+(total-shown)+' 条）';
  b.onclick=onMore;list.append(b);
}
/* 统一空状态：图标 + 标题 + 一句引导，取代各模块孤零零的灰字。
   可选 action 渲染成主按钮，空态也能一键开始。 */
function emptyState(icon,title,hint,action){
  const box=document.createElement('div');box.className='empty-state';
  const ic=document.createElement('span');ic.className='es-icon';ic.textContent=icon;ic.setAttribute('aria-hidden','true');
  const tt=document.createElement('b');tt.className='es-title';tt.textContent=title;
  box.append(ic,tt);
  if(hint){const h=document.createElement('span');h.className='es-hint';h.textContent=hint;box.append(h);}
  if(action){const b=document.createElement('button');b.type='button';b.className='es-action';b.textContent=action.label;b.onclick=action.onClick;box.append(b);}
  return box;
}
/* 原生工作区快照的硬上限（EditorActivity 里是同一个数）。
   以前超限是静默丢弃整份草稿，现在先在页面里算清楚再明确报错。 */
const WORKSPACE_LIMIT=30*1024*1024;

/* Light editor surface: calm paper background, quiet gutters, GitHub-like syntax colours. */
const codeTheme=EditorView.theme({
  '&':{backgroundColor:'var(--code)',color:'var(--text)',height:'100%'},
  '.cm-content':{caretColor:'var(--accent)'},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'var(--accent)'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,.cm-content ::selection':{backgroundColor:'var(--accent-soft)'},
  '.cm-gutters':{backgroundColor:'var(--code)',color:'var(--faint)',border:'none'},
  '.cm-activeLine':{backgroundColor:'var(--accent-soft)'},
  '.cm-activeLineGutter':{backgroundColor:'var(--accent-soft)',color:'var(--muted)'},
  '.cm-panels':{backgroundColor:'var(--surface-2)',color:'var(--text)'},
  '.cm-searchMatch':{backgroundColor:'#fde68a'},
  '.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#fca5a5'},
  '.cm-tooltip':{backgroundColor:'var(--surface)',border:'1px solid var(--line)',color:'var(--text)'},
  '.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'var(--accent-soft)',color:'var(--accent-strong)'}
},{dark:false});
const codeHighlight=HighlightStyle.define([
  {tag:tags.comment,color:'var(--syn-comment)',fontStyle:'italic'},
  {tag:[tags.keyword,tags.operatorKeyword,tags.modifier,tags.controlKeyword],color:'var(--syn-keyword)'},
  {tag:[tags.string,tags.special(tags.string),tags.regexp],color:'var(--syn-string)'},
  {tag:[tags.number,tags.bool,tags.null],color:'var(--syn-number)'},
  {tag:[tags.function(tags.variableName),tags.definition(tags.function(tags.variableName))],color:'var(--syn-function)'},
  {tag:[tags.className,tags.typeName,tags.namespace],color:'var(--syn-type)'},
  {tag:[tags.propertyName,tags.attributeName],color:'var(--syn-property)'},
  {tag:[tags.tagName],color:'var(--syn-property)'},
  {tag:tags.heading,color:'var(--syn-heading)',fontWeight:'600'},
  {tag:[tags.link,tags.url],color:'var(--syn-link)',textDecoration:'underline'},
  {tag:tags.invalid,color:'var(--syn-invalid)'}
]);
const langs={py:['Python',python],js:['JavaScript',javascript],mjs:['JavaScript',javascript],ts:['TypeScript',()=>javascript({typescript:true})],html:['HTML',html],htm:['HTML',html],css:['CSS',css],json:['JSON',json],c:['C',cpp],h:['C/C++',cpp],cpp:['C++',cpp],cc:['C++',cpp],java:['Java',java],md:['Markdown',markdown]};
const extension=path=>(path.split('.').pop()||'').toLowerCase();
const validPath=path=>typeof path==='string'&&path.length>0&&path.length<=200&&!path.startsWith('/')&&!path.split('/').some(v=>!v||v==='.'||v==='..')&&!/[\x00-\x1f\\:*?"<>|]/.test(path);
const makeFile=(path,text,uri='',encoding='UTF-8')=>({path,text,uri,encoding,savedText:text});
const defaults=()=>({version:1,pythonLabs:{},files:[makeFile('main.py','# 点右上「运行」试试。要输入内容时，先在终端的「输入」页填好\nfrom geometry import rectangle_area\nimport json\n\nname = input("你的名字：")\nprint(f"你好，{name}！")\n\nwith open("data.json", encoding="utf-8") as f:\n    shape = json.load(f)\n\narea = rectangle_area(shape["width"], shape["height"])\nprint(f"长方形面积：{area}")\n'),makeFile('geometry.py','def rectangle_area(width, height):\n    """计算长方形面积。"""\n    return width * height\n'),makeFile('data.json','{\n  "width": 8,\n  "height": 5\n}\n'),makeFile('main.cpp','// C++ 也能直接运行：和 Python 共用这套文件\n// 工作区里的其他 .cpp 会一起编译，头文件直接 include\n#include <iostream>\n#include <string>\n\nint main() {\n    std::string name;\n    std::cout << "你的名字：";\n    std::getline(std::cin, name);\n    std::cout << "你好，" << name << "！\\n";\n\n    int sum = 0;\n    for (int i = 1; i <= 100; ++i) sum += i;\n    std::cout << "1 加到 100 = " << sum << std::endl;\n    return 0;\n}\n'),makeFile('index.html','<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{background:#142330;color:#b2ebda;font:18px system-ui;padding:30px}button{padding:12px;border-radius:8px}</style>\n<h1>你好，天工！</h1>\n<p>这个页面是在手机上写的。</p>\n<button onclick="this.textContent=\'点到了！\'">点我一下</button>\n</html>\n')],active:'main.py',opened:['main.py','geometry.py'],stdin:'伍子平\n',settings:{fontSize:15,wrap:true,timeLimit:15,appearance:'system',accent:'teal'},drawStrokes:[],drawView:null,tts:{voice:'',locale:'en-US',rate:1},noteTemplates:sanitizeTemplateState(),ai:aiSerialize(),model:modelSanitize(null),star:{starred:[],motion:true},focus:DEFAULT_FOCUS(),pelican:{best:0},cards:deckSanitize(null),mistakes:bookSanitize(null),habits:habitsSanitize(null),schedule:scheduleSanitize(null),novel:shelfSanitize(null),medquiz:quizStatsSanitize(null),mqSession:null,exams:examsSanitize(null),soundscape:defaultSoundscape(),studyLog:studyLogSanitize(null),ui:defaultUi(),recents:[]});
let state=defaults(),view,restoring=false,worker=null,cppWorker=null,runToken=0,timeout=null,saveTimer=null,revision=0,latestSaved=0,renamePath=null,ready=false,toastTimer,pendingSaves=new Map(),runFiles=[];
/* 麦克风预热请求：id → resolve(granted)。设置超时兜底，别让录音按钮卡住。 */
const micWaiters=new Map();let micSeq=0;
function requestMic(){
  if(!native)return Promise.resolve(true);
  return new Promise(resolve=>{
    const id=++micSeq;
    micWaiters.set(id,resolve);
    send('micPermission',{id});
    setTimeout(()=>{if(micWaiters.has(id)){micWaiters.delete(id);resolve(true);}},20000);
  });
}
const langConfig=new Compartment(),wrapConfig=new Compartment(),editConfig=new Compartment();
let editorStates=new Map();
function active(){return state.files.find(f=>f.path===state.active)||state.files[0];}
function language(path){return langs[extension(path)]||['纯文本',()=>[]];}
function hideToast(){
  const t=$('toast');if(!t||t.hidden)return;
  /* 先播退出动画再真正隐藏；减弱动效时直接隐藏。 */
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){t.hidden=true;t.replaceChildren();t.classList.remove('toast-undo','toast-out');return;}
  t.classList.add('toast-out');
  setTimeout(()=>{t.hidden=true;t.replaceChildren();t.classList.remove('toast-undo','toast-out');},180);
}
function notify(text){
  const t=$('toast');if(!t)return;
  t.classList.remove('toast-undo','toast-out');
  t.textContent=text;t.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(hideToast,3500);
}
/* 带撤销的通知：删除类操作给 6 秒反悔窗口。
   同一时刻只保留一个撤销动作，新通知会顶掉旧的，避免误撤销到上一条。 */
let undoAction=null;
function notifyUndo(text,onUndo,ms=6000){
  const t=$('toast');if(!t)return;
  clearTimeout(toastTimer);
  undoAction=typeof onUndo==='function'?onUndo:null;
  t.replaceChildren();
  t.classList.add('toast-undo');
  const span=document.createElement('span');span.className='toast-text';span.textContent=text;
  const btn=document.createElement('button');btn.type='button';btn.className='toast-btn';btn.textContent='撤销';
  btn.onclick=()=>{
    const act=undoAction;undoAction=null;
    hideToast();clearTimeout(toastTimer);
    if(act)act();
  };
  t.append(span,btn);
  /* 倒计时进度条：直观显示还剩多少反悔时间。 */
  const bar=document.createElement('i');bar.className='toast-bar';bar.style.animationDuration=ms+'ms';t.append(bar);
  t.classList.remove('toast-out');t.hidden=false;
  toastTimer=setTimeout(()=>{undoAction=null;hideToast();},ms);
}
function send(type,data={}){if(native)window.StudioBridge.postMessage(JSON.stringify({type,...data}));}
function snapshot(){return {version:1,desk:deskKind,lastCodePath,pythonLabs:state.pythonLabs,files:state.files,active:state.active,opened:state.opened,stdin:$('stdin').value,settings:state.settings,noteTemplates:sanitizeTemplateState(state.noteTemplates),lecture:lectureSerialize(),tts:ttsSerialize(),drawStrokes:state.drawStrokes||[],drawView:getDrawView(),ai:aiSerialize(),model:modelSanitize(state.model),star:starSanitize(state.star,MODULES.map(m=>m.id)),focus:focusSanitize(state.focus),pelican:pelicanSanitize(state.pelican),cards:deckSanitize(state.cards),mistakes:bookSanitize(state.mistakes),habits:habitsSanitize(state.habits),schedule:scheduleSanitize(state.schedule),novel:shelfSanitize(state.novel),medquiz:quizStatsSanitize(state.medquiz),mqSession:mqSessionSnapshot(),exams:examsSanitize(state.exams),soundscape:soundscapeSanitize(state.soundscape),studyLog:studyLogSanitize(state.studyLog),ui:sanitizeUi({...state.ui,tabs:studioTabs,activeTab:studioTabs.activeTab,recentMode}),recents:sanitizeRecents(state.recents)};}
function mqSessionSnapshot(){const s=mqSession;if(!s||s.finished||!s.ids.length)return null;return {mode:s.mode,subject:s.subject,difficulty:s.difficulty,ids:s.ids,pos:s.pos,answers:s.answers,skipped:s.skipped||{},perm:s.perm};}
/* 保存前先做体积预算：超限就明确告诉用户“哪一部分太大、要删什么”，
   不再让原生静默 return 掉整份草稿。 */
function mb(bytes){return (bytes/1048576).toFixed(1);}
function flush(){
  clearTimeout(saveTimer);
  if(!ready)return;
  state.stdin=$('stdin').value;
  const data=snapshot(),id=++revision;
  $('saveState').textContent='正在保存草稿…';
  if(native){
    let text='';
    try{text=JSON.stringify(data);}
    catch(e){$('saveState').textContent='草稿保存失败';notify('草稿序列化失败：'+(e.message||e));return;}
    if(text.length>WORKSPACE_LIMIT){
      $('saveState').textContent='草稿过大，未保存';
      notify('草稿体积 '+mb(text.length)+' MB，超过 '+mb(WORKSPACE_LIMIT)+' MB 上限，这次改动没有写入。请到「上课」里删掉一些 PPT 页面，或把重要内容另存后再清理。');
      return;
    }
    window.StudioBridge.postMessage('{"type":"snapshot","id":'+id+',"data":'+text+'}');
    return;
  }
  try{localStorage.setItem('ember-studio-v1',JSON.stringify(data));latestSaved=id;$('saveState').textContent='草稿已保存';}
  catch(e){$('saveState').textContent='草稿保存失败';notify('空间不足，请先另存重要文件。');}
}
function scheduleSave(){if(restoring)return;$('saveState').textContent='草稿待保存';clearTimeout(saveTimer);saveTimer=setTimeout(flush,450);}
function changed(){renderFiles();scheduleSave();}
function loadState(data){
  if(!data||data.version!==1||!Array.isArray(data.files)||!data.files.length)throw Error('无有效工作区');
  const unique=new Set();const files=data.files.filter(f=>validPath(f.path)&&typeof f.text==='string'&&f.text.length<=MAX_FILE&&!unique.has(f.path)&&unique.add(f.path)).slice(0,160).map(f=>({...f,uri:typeof f.uri==='string'?f.uri:'',encoding:f.encoding||'UTF-8',savedText:typeof f.savedText==='string'?f.savedText:f.text}));
  if(!files.length)throw Error('工作区文件无法读取');
  state={...defaults(),...data,files,settings:{...defaults().settings,...data.settings}};
  state.pythonLabs = normalizeLabProgress(data.pythonLabs);
  deskKind = data.desk === 'code' ? 'code' : 'study';
  lastCodePath = files.some(file => file.path === data.lastCodePath) ? data.lastCodePath : '';
  state.lecture=lectureSanitize(data.lecture);
  state.tts=ttsSanitize(data.tts);
  state.ai=(data&&data.ai&&typeof data.ai==='object')?data.ai:aiSerialize();
  state.noteTemplates=sanitizeTemplateState(data.noteTemplates);
  state.drawStrokes=Array.isArray(data.drawStrokes)?data.drawStrokes:[];
  state.drawView=(data&&data.drawView&&typeof data.drawView==='object')?data.drawView:null;
  state.model=modelSanitize(data.model);
  state.star=starSanitize(data.star,MODULES.map(m=>m.id));
  state.focus=focusSanitize(data.focus);
  /* 恢复时不自动继续计时，避免后台偷跑。 */
  state.focus.running=false;
  state.pelican=pelicanSanitize(data.pelican);
  state.cards=deckSanitize(data.cards);
  state.mistakes=bookSanitize(data.mistakes);
  state.habits=habitsSanitize(data.habits);
  state.schedule=scheduleSanitize(data.schedule);
  state.novel=shelfSanitize(data.novel);
  state.medquiz=quizStatsSanitize(data.medquiz);
  state.mqSession=data.mqSession||null;
  state.exams=examsSanitize(data.exams);
  state.soundscape=soundscapeSanitize(data.soundscape);
  state.soundscape.timerEnd=0; /* 后台不续跑定时 */
  state.studyLog=studyLogSanitize(data.studyLog);
  state.ui=sanitizeUi(data.ui);
  state.recents=sanitizeRecents(data.recents);
  studioTabs=sanitizeTabState(state.ui.tabs);
  recentMode=state.ui.recentMode;
  state.settings.fontSize=Math.max(12,Math.min(24,Number(state.settings.fontSize)||15));state.settings.timeLimit=[15,30,60].includes(+state.settings.timeLimit)?+state.settings.timeLimit:15;if(window.innerWidth<700)state.settings.wrap=true;
  adoptTheme(data.settings);
  state.active=files.some(f=>f.path===state.active)?state.active:files[0].path;state.opened=Array.isArray(state.opened)?state.opened.filter(p=>files.some(f=>f.path===p)):[];if(!state.opened.includes(state.active))state.opened.push(state.active);
}
function restore(data){try{loadState(data);}catch(e){if(data)notify('工作区格式无法读取；原备份未被覆盖，请先导出或检查。');}if(isNotepadNotePath(state.active))lastNotePath=state.active;restoring=true;editorStates.clear();$('stdin').value=state.stdin||'';createEditor();restoring=false;ready=true;renderFiles();applySettings();markLandingReady();lectureAfterRestore();ttsAfterRestore();aiRestore(state.ai);loadDrawView(state.drawView);if(state.drawStrokes&&state.drawStrokes.length)loadDrawStrokes(state.drawStrokes);showStudioTab(studioTabs.activeTab);}
function createEditor(){
 if(view)view.destroy();
 const config={doc:active().text,extensions:[
   basicSetup,
   codeTheme,
   syntaxHighlighting(codeHighlight),
   ...lectureExtensions,
   ...ttsExtensions,
   keymap.of([indentWithTab]),
   langConfig.of(language(active().path)[1]()),
   wrapConfig.of(state.settings.wrap?EditorView.lineWrapping:[]),
   editConfig.of(EditorState.readOnly.of(!!worker)),
   EditorView.contentAttributes.of({autocapitalize:'off',autocorrect:'off',spellcheck:'false',enterkeyhint:'enter',inputmode:'text'}),
   EditorView.updateListener.of(update=>{
     if(update.docChanged&&!restoring){const f=active();f.text=update.state.doc.toString();scheduleSave();refreshBadges();ttsDocumentChanged('edited');updateMdPreview();}
     if(update.selectionSet||update.docChanged)position();
   })
 ]};
 view=new EditorView({state:EditorState.create(config),parent:$('editor')});view.dom.style.fontSize=state.settings.fontSize+'px';editorStates.set(active().path,view.state);position();lectureViewCreated();
}
function position(){if(!view)return;const pos=view.state.selection.main.head,line=view.state.doc.lineAt(pos);$('position').textContent=`第 ${line.number} 行，第 ${pos-line.from+1} 列`;const note=$('noteCount');if(note&&document.body.classList.contains('notepad'))note.textContent=view.state.doc.length+' 字 · '+view.state.doc.lines+' 行';else if(note&&document.body.classList.contains('lecture'))note.textContent=lectureStatusText();else if(note&&document.body.classList.contains('tts'))note.textContent=ttsStatusText();else if(note&&document.body.classList.contains('aiview'))note.textContent=aiStatusText();else if(note&&document.body.classList.contains('modelview'))note.textContent=modelApi?modelApi.status():'';const empty=$('noteEmpty');if(empty){const blank=document.body.classList.contains('notepad')||document.body.classList.contains('lecture');empty.classList.toggle('show',blank&&view.state.doc.length===0);}}
function renderFiles(){
 const list=$('fileList');list.replaceChildren();for(const f of state.files){const row=document.createElement('div');row.className='fileitem'+(f.path===state.active?' active':'');const b=document.createElement('button');b.className='fileopen';b.title=f.path;b.dataset.path=f.path;const glyph=document.createElement('span');glyph.className='fileglyph';glyph.textContent=extension(f.path).slice(0,3);const name=document.createElement('span');name.textContent=f.path+(f.text!==f.savedText?' •':'');b.append(glyph,name);b.onclick=()=>switchFile(f.path);const menu=document.createElement('button');menu.className='filemenu';menu.textContent='⋯';menu.setAttribute('aria-label','重命名 '+f.path);menu.onclick=()=>nameDialog(f.path);row.append(b,menu);list.append(row);}
 refreshBadges();
}
function refreshBadges(){
 const f=active();if(!f)return;
 updateLabPanel();
 $('activePath').textContent=f.path;$('dirtyFlag').textContent=f.uri?(f.text===f.savedText?'已保存到原文件':'有修改 · 保存写回'):'本地草稿 · 自动保存';$('language').textContent=document.body.classList.contains('drawing')?'画画':language(f.path)[0];$('encoding').textContent=f.encoding||'UTF-8';$('runButton').textContent=['html','htm'].includes(extension(f.path))?'↗ 预览':'▶ 运行';
 for(const b of $('fileList').querySelectorAll('.fileopen')){const p=b.dataset.path,t=state.files.find(x=>x.path===p);if(!t)continue;const name=b.lastElementChild;if(name)name.textContent=p+(t.text!==t.savedText?' •':'');b.closest('.fileitem').classList.toggle('active',p===state.active);}
}
function switchFile(path){if(worker){notify('请先停止运行，再切换文件。');return;}const f=state.files.find(f=>f.path===path);if(!f)return;if(workspaceMode==='python'&&shouldRememberCodePath(path))lastCodePath=path;if(isNotepadNotePath(path)&&(workspaceMode==='notepad'||workspaceMode==='python'))lastNotePath=path;if(workspaceMode==='tts')lastTtsPath=path;editorStates.set(state.active,view.state);state.active=path;if(!state.opened.includes(path))state.opened.push(path);restoring=true;const previous=editorStates.get(path);if(previous&&previous.doc.toString()===f.text){view.setState(previous);view.dispatch({effects:[langConfig.reconfigure(language(path)[1]()),wrapConfig.reconfigure(state.settings.wrap?EditorView.lineWrapping:[]),editConfig.reconfigure(EditorState.readOnly.of(false))]});}else createEditor();restoring=false;renderFiles();document.body.classList.remove('drawer');position();scheduleSave();recordRecent({path:f.path,title:f.path.split('/').pop()||f.path,uri:f.uri||'',mode:workspaceMode});if(workspaceMode==='tts')ttsDocumentChanged('switched');}
function nameDialog(path=null){if(worker)return;renamePath=path;$('nameTitle').textContent=path?'修改工作区路径':'新建文件';$('confirmName').textContent=path?'重命名':'创建';$('fileName').value=path||(workspaceMode==='notepad'?'笔记.txt':workspaceMode==='tts'?'English.txt':'new_file.py');const hint=$('nameHint');if(hint)hint.textContent=workspaceMode==='notepad'?'可带子文件夹；例如 日记/今天.txt。':workspaceMode==='tts'?'可带子文件夹；例如 Articles/chapter-one.txt。':'可带子文件夹；请写扩展名，例如 .py。';$('nameDialog').returnValue='cancel';$('nameDialog').showModal();setTimeout(()=>$('fileName').select(),50);}
$('nameDialog').addEventListener('close',()=>{if($('nameDialog').returnValue!=='default')return;const path=$('fileName').value.trim();if(!validPath(path)){notify('路径无效，请使用文件名或 folder/file.py。');return;}if(state.files.some(f=>f.path===path)&&path!==renamePath){notify('已有同名文件。');return;}if(renamePath){const f=state.files.find(f=>f.path===renamePath);moveLabPath(renamePath,path);f.path=path;state.opened=state.opened.map(p=>p===renamePath?path:p);if(state.active===renamePath)state.active=path;editorStates.delete(renamePath);}else{if(state.files.length>=160){notify('当前工作区最多 160 个文件。');return;}state.files.push(makeFile(path,''));}switchFile(path);changed();});
const themeQuery=window.matchMedia('(prefers-color-scheme: dark)');
function prefersDark(){try{return !!themeQuery.matches;}catch(e){return false;}}
function syncTheme(){
  const theme=sanitizeTheme(state.settings);
  state.settings.appearance=theme.appearance;
  state.settings.accent=theme.accent;
  const resolved=applyTheme(document.documentElement,theme,prefersDark());
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',themeColor(resolved));
  paintThemeChoices();
}
function paintThemeChoices(){
  const appearance=state.settings.appearance;
  const accent=state.settings.accent;
  document.querySelectorAll('#themeAppearance button').forEach(btn=>{
    const on=btn.dataset.value===appearance;
    btn.classList.toggle('selected',on);
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
  document.querySelectorAll('#themeAccent button').forEach(btn=>{
    const on=btn.dataset.value===accent;
    btn.classList.toggle('selected',on);
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
}
function adoptTheme(settings){
  let stored;
  try{stored=readStoredTheme(localStorage);}catch(e){stored=sanitizeTheme(null);}
  const theme=themeFromSettings(settings,stored);
  state.settings.appearance=theme.appearance;
  state.settings.accent=theme.accent;
  try{writeStoredTheme(localStorage,theme);}catch(e){}
  syncTheme();
}
function chooseTheme(partial){
  adoptTheme({...sanitizeTheme(state.settings),...partial});
  scheduleSave();
}
function bindThemeGroup(id,key){
  const root=$(id);
  if(!root)return;
  root.addEventListener('click',event=>{
    const btn=event.target.closest('button');
    if(!btn||!root.contains(btn)||!btn.dataset.value)return;
    chooseTheme({[key]:btn.dataset.value});
  });
}
try{themeQuery.addEventListener('change',()=>{if(state.settings.appearance==='system')syncTheme();});}catch(e){}
adoptTheme(null);
bindThemeGroup('themeAppearance','appearance');
bindThemeGroup('themeAccent','accent');
function applySettings(){$('fontSize').value=state.settings.fontSize;$('fontSizeValue').textContent=state.settings.fontSize;$('wordWrap').checked=!!state.settings.wrap;$('timeLimit').value=state.settings.timeLimit;syncTheme();if(view){view.dom.style.fontSize=state.settings.fontSize+'px';view.dispatch({effects:[wrapConfig.reconfigure(state.settings.wrap?EditorView.lineWrapping:[])]});}}
for(const id of ['fontSize','wordWrap','timeLimit'])$(id).oninput=()=>{state.settings.fontSize=+$('fontSize').value;state.settings.wrap=$('wordWrap').checked;state.settings.timeLimit=+$('timeLimit').value;applySettings();scheduleSave();};
/* 科幻动效开关：默认开；系统「减弱动效」时强制关并禁用开关。 */
{const t=$('fxToggle');if(t){t.checked=fxStored()&&!fxPreferred();t.disabled=fxPreferred();if(fxPreferred())t.title='系统已开启「减弱动效」，动效自动关闭';
  t.onchange=()=>{const on=setFx(t.checked);t.checked=on;if(on)warp();notify(on?'科幻动效已开启。':'科幻动效已关闭。');};}}
/* 报错行渲染成可点击链接：splitLocations 标出带「文件:行:列」的行。 */
function append(text,error=false){
 const out=$('output');
 if(out.textContent.length>=70000)return;
 const str=String(text).slice(0,70000-out.textContent.length);
 const frag=document.createDocumentFragment();
 for(const part of splitLocations(str)){
  const span=document.createElement('span');
  if(error)span.className='error';
  if(error&&part.loc){span.classList.add('errlink');span.dataset.path=part.loc.path;span.dataset.line=String(part.loc.line);span.dataset.col=String(part.loc.column||1);span.title='跳到 '+part.loc.path+':'+part.loc.line;}
  span.textContent=part.text;
  frag.append(span);
 }
 out.append(frag);out.scrollTop=out.scrollHeight;
}
/* 点击报错行：切到对应文件并把光标移到出错行列。 */
function gotoError(loc){
 if(!loc||worker)return;
 const f=state.files.find(x=>x.path===loc.path);
 if(!f){notify('找不到 '+loc.path+'，可能已重命名或删除。');return;}
 switchFile(loc.path);
 outputTab(false);
 if(!view)return;
 const doc=view.state.doc;
 const line=doc.line(Math.min(Math.max(1,loc.line),doc.lines));
 const pos=Math.min(line.from+Math.max(0,(loc.column||1)-1),line.to);
 view.dispatch({selection:{anchor:pos},scrollIntoView:true});
 view.focus();
}
/* 把当前终端输出存成工作区 txt 文件并打开，方便留存运行结果。 */
function saveOutputToFile(){
 const text=$('output').textContent;
 if(!text.trim()){notify('终端还没有输出可保存。');return;}
 if(state.files.length>=160){notify('工作区已满 160 个文件，先删掉一些再存。');return;}
 const now=new Date(),p=n=>String(n).padStart(2,'0');
 const stamp=now.getFullYear()+p(now.getMonth()+1)+p(now.getDate())+'-'+p(now.getHours())+p(now.getMinutes())+p(now.getSeconds());
 let path='输出-'+stamp+'.txt',seq=2;
 while(state.files.some(f=>f.path===path))path='输出-'+stamp+'-'+(seq++)+'.txt';
 state.files.push(makeFile(path,text));
 if(!state.opened.includes(path))state.opened.push(path);
 changed();
 switchFile(path);
 notify('输出已存为 '+path);
}
function setConsole(open){$('consolePanel').classList.toggle('folded',!open);$('foldConsole').setAttribute('aria-expanded',String(open));}
function outputTab(input=false){$('output').hidden=input;$('stdin').hidden=!input;$('inputTab').classList.toggle('active',input);$('outputTab').classList.toggle('active',!input);setConsole(true);}
function setRunning(running){updateLabPanel();$('runButton').hidden=running;$('stopButton').hidden=!running;for(const id of ['newFile','openFile','openFolder','saveButton','exportButton','menuNew','menuOpen','menuFolder','menuSave','menuGame','menuMode','menuTemplates','menuQuiz']){const el=$(id);if(el)el.disabled=running;}const save=$('saveButton');if(save)save.title=running?'运行中无法写回原文件，请先停止运行':'保存';if(view)view.dispatch({effects:editConfig.reconfigure(EditorState.readOnly.of(running))});}
/* kill=false 时保留 C++ 常驻线程（编译器留在内存，下次运行免加载）；
   停止按钮、超时、出错都走 kill=true，死循环程序必须能杀掉。 */
function stop(reason='已停止运行',kill=true){runToken++;if(worker){if(kill||worker!==cppWorker){worker.terminate();if(worker===cppWorker)cppWorker=null;}}worker=null;clearTimeout(timeout);setRunning(false);$('runState').textContent=reason;}
function applyRunFiles(files){let updated=0;for(const f of files||[]){if(!validPath(f.path)||typeof f.text!=='string'||f.text.length>MAX_FILE)continue;const existing=state.files.find(x=>x.path===f.path);if(existing){if(existing.text===f.text)continue;existing.text=f.text;editorStates.delete(f.path);}else if(state.files.length<160)state.files.push(makeFile(f.path,f.text));else continue;updated++;}if(updated){restoring=true;createEditor();restoring=false;changed();append(`\n[工作区] 已保留 ${updated} 个新增或修改的文件，写回手机文件需点击保存。\n`);}}
/* 学习/休闲面板里「运行/保存文件」没有意义：顶栏已隐藏这些按钮，
   这里再兜一层，避免快捷键或旧调用在面板内误跑后台代码文件。 */
const PANEL_MODES=new Set(['overview','focus','cards','mistakes','habits','schedule','medquiz','exams','medcalc','novel','soundscape','model','pelican','ai','game']);
function inPanelMode(){return PANEL_MODES.has(workspaceMode);}
async function run(){
 if(inPanelMode()){notify('当前面板不需要运行代码，回到「写代码」再运行。');return;}
 if(worker)return;const f=active(),ext=extension(f.path);if(['html','htm'].includes(ext)){preview();return;}if(!['py','js','mjs','c','cc','cpp','cxx'].includes(ext)){notify(language(f.path)[0]+' 只能编辑，不能运行。可运行 .py、.js、.cpp/.c，或预览 .html。');return;}
 const isCpp=['c','cc','cpp','cxx'].includes(ext);
 const lab = workspaceMode === 'python' && ext === 'py' ? labForFile(f.path) : null;
 const source = f.text;
 let labOutput = '';
 flush();outputTab(false);$('output').replaceChildren();$('runState').textContent=ext==='py'?'准备 Python…':isCpp?(cppWorker?'编译 C/C++…':'准备 C/C++ 编译器…'):'运行 JavaScript…';
 const scope=isCpp?cppRunScope(state.files,f.path):{root:'',files:state.files};
 runFiles=scope.files.map(file=>({path:file.path,text:file.text}));const token=++runToken;
 /* C++ 线程常驻复用：编译器只加载一次；Python/JS 仍每次新建。 */
 worker=isCpp?(cppWorker||(cppWorker=new Worker('cpp-worker.js'))):new Worker(ext==='py'?'python-worker.js':'javascript-worker.js');
 setRunning(true);const started=performance.now();let hasStarted=false;
 /* C++ 首次要读 28 MB 本地工具链再编译，准备阶段给 120 秒；复用后编译很快。运行上限从 started 起算。 */
 timeout=setTimeout(()=>{if(token!==runToken)return;append('\n准备超时，已停止。'+(isCpp?'C++ 编译器首次加载较慢，请重试；多次失败请更新系统 WebView。':'可以在设置中调整运行上限。')+'\n',true);stop('准备超时');},isCpp&&!cppWorker?120000:isCpp?60000:45000);
 worker.onmessage=event=>{if(token!==runToken)return;const m=event.data||{};if(m.runId!==undefined&&m.runId!==token)return;if(m.type==='loading'){$('runState').textContent='读取本地 C++ 编译器…';}else if(m.type==='progress'){const pct=Math.round((m.value||0)*100);$('runState').textContent='读取编译器 '+pct+'%（仅首次较慢）';}else if(m.type==='started'&&!hasStarted){hasStarted=true;clearTimeout(timeout);$('runState').textContent='运行中 · 可停止';timeout=setTimeout(()=>{append('\n达到运行上限，已终止工作线程。\n',true);stop('运行超时');},state.settings.timeLimit*1000);}else if(m.type==='stdout'||m.type==='stderr'){
   append(m.text,m.type==='stderr');
   if(lab && m.type==='stdout' && labOutput.length<=2000) labOutput += m.text.slice(0,2001-labOutput.length);
 }else if(m.type==='done'){
   if(lab && m.ok){
     const output = labOutput.length>2000 ? labOutput.slice(0,2000)+'\n…（仅记录前 2000 字）' : labOutput;
     state.pythonLabs[lab.id] = {...state.pythonLabs[lab.id],hasRun:true,runSource:source,output};
   }
   const elapsed=((performance.now()-started)/1000).toFixed(2);stop(m.ok?'执行完成 · '+elapsed+'s':'执行失败 · '+elapsed+'s',false);applyRunFiles(m.files);flush();}else if(m.type==='error'){append(m.text+'\n',true);stop('运行环境未能启动');}};
 worker.onerror=event=>{if(token!==runToken)return;append('运行环境错误：'+event.message+'\n请确认系统 WebView 支持 WebAssembly。\n',true);stop('运行环境错误');};
 worker.postMessage({runId:token,path:f.path,code:f.text,files:runFiles,projectRoot:scope.root,stdin:$('stdin').value});
}
function preview(){flush();if(native){send('preview',{path:active().path,files:state.files.map(f=>({path:f.path,text:f.text}))});return;}const dlg=document.createElement('dialog');dlg.style.cssText='width:96vw;height:90vh;padding:8px;max-width:1100px';const close=document.createElement('button');close.textContent='关闭预览';close.onclick=()=>{dlg.close();dlg.remove();};const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.style.cssText='width:100%;height:90%;background:white;border:0';let content=active().text;content=content.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,(tag,path)=>{const f=state.files.find(f=>f.path===path);return f?'<style>'+f.text+'</style>':tag;}).replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,(tag,path)=>{const f=state.files.find(f=>f.path===path);return f?'<script>'+f.text+'</script>':tag;});frame.srcdoc=content;dlg.append(close,frame);document.body.append(dlg);dlg.showModal();}
function saveFile(as=false){if(inPanelMode()){flush();notify('学习数据已自动存本机；要导出请用面板里的「导出 CSV」或设置里的备份。');return;}flush();const f=active(),id=String(Date.now())+'-'+Math.random();if(native){pendingSaves.set(id,{path:f.path,text:f.text});send(as||!f.uri?'export':'save',{id,path:f.path,text:f.text,uri:f.uri,encoding:f.encoding});}else{const blob=new Blob([f.text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=f.path.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);f.savedText=f.text;changed();notify('已导出文件。');}recordRecent({path:f.path,title:f.path.split('/').pop()||f.path,uri:f.uri||'',mode:workspaceMode});}
function importFiles(files){if(worker){notify('请停止运行后再导入。');return null;}let first='',backups=0,accepted=0;for(const file of files){if(!validPath(file.path)||typeof file.text!=='string'||file.text.length>MAX_FILE)continue;let path=file.path;const existing=state.files.find(f=>f.path===path);if(existing&&existing.uri!==file.uri){if(state.files.length>=159){notify('文件过多，请先另存草稿后重试。');break;}const backup='_草稿备份/'+Date.now()+'_'+path.split('/').pop().slice(-140);moveLabPath(path,backup);existing.path=backup;existing.uri='';state.opened=state.opened.map(p=>p===path?backup:p);editorStates.delete(path);backups++;}else if(existing){if(existing.text!==existing.savedText){notify('文件存在未写回的编辑，已保留草稿。');continue;}Object.assign(existing,makeFile(path,file.text,file.uri,file.encoding));accepted++;if(!first)first=path;continue;}if(state.files.length>=160)break;state.files.push(makeFile(path,file.text,file.uri||'',file.encoding||'UTF-8'));accepted++;if(!first)first=path;}if(first)switchFile(first);changed();for(const file of files){if(file&&file.path&&state.files.some(item=>item.path===file.path))recordRecent({source:'import',path:file.path,title:file.path.split('/').pop()||file.path,mode:'python',size:(file.text||'').length});}if(backups)notify('导入文件保留原名；同名旧稿已移到 _草稿备份。');return {accepted,backups};}
async function browserImport(event){const files=[];let skipped=0;for(const f of [...event.target.files].slice(0,160)){if(f.size>MAX_FILE){skipped++;continue;}try{const bytes=new Uint8Array(await f.arrayBuffer());if(bytes.includes(0))throw Error('binary');const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);files.push({path:f.webkitRelativePath||f.name,text,uri:'browser:'+f.name});}catch(e){skipped++;}}const result=importFiles(files);notify(`已接收 ${result?.accepted||0} / ${files.length} 个文本文件${skipped?'，另跳过 '+skipped+' 个非文本或过大文件':''}`);event.target.value='';}
window.StudioNative={receive(m){
  if(!m)return;
  if(m.type==='aiToolResult'){const r=aiToolWaiters.get(m.id);if(r){aiToolWaiters.delete(m.id);r(m.data||(m.ok?'完成':'操作未完成'));}return;}
  /* 课堂模式的媒体回执（mediaPut / mediaGc）先交给 lecture 处理。 */
  if(lectureMediaMessage(m))return;
  /* 上课前预热麦克风权限的回执（见 EditorActivity.micPermission）。 */
  if(m.type==='micPermission'){const done=micWaiters.get(m.id);if(done){micWaiters.delete(m.id);done(!!m.granted);}return;}
  if(m.type==='restore'){restore(m.data);if(m.error)notify(m.error);}
  /* 草稿保存失败（体积超限、磁盘满、旧工作区只读）必须让用户看见，
     不能只在状态栏留一句“草稿保存失败”。 */
  else if(m.type==='snapshotSaved'){
    if(m.id>=latestSaved){
      latestSaved=m.id;
      if(m.id===revision){
        $('saveState').textContent=m.ok?'草稿已保存':'草稿保存失败';
        if(!m.ok&&m.message)notify(m.message);
      }
    }
  }
  else if(m.type==='imported'){const result=importFiles(m.files||[]);if(result&&result.accepted<(m.files||[]).length)notify('工作区接收 '+result.accepted+' / '+m.files.length+' 个文件，其余因容量或未保存草稿冲突未导入；原文件保留。');else notify((m.message||'导入完成')+(result?.backups?'；同名旧稿已备份':''));}
  else if(m.type==='saved'){const pending=pendingSaves.get(m.id);pendingSaves.delete(m.id);if(m.ok&&pending){if(pending.binary){notify('已导出到手机文件。');}else{const f=state.files.find(f=>f.path===pending.path);if(f){f.savedText=pending.text;f.uri=m.uri||f.uri;f.encoding=m.encoding||f.encoding;changed();}notify('已保存到手机文件。');}}else notify(m.message||'保存未完成，草稿仍保留。');}
  /* 一次性出题请求有独立的 quiz- id；先于聊天接收器，避免落进 AI 会话。 */
  else if(quizRequester.receive(m)){}
  else if(ttsReceive(m)){}
  else if(aiReceive(m)){}
  else if(m.type==='capabilities'){moduleCaps={...m,native:true};refreshAvailability();}
  else if(m.type==='moduleReturned')nativeReturned(m.id,m);
  else if(m.type==='notice')notify(m.message);
  else if(m.type==='gameState')$('gameSaveInfo').textContent=m.exists?'发现游戏存档 · 进入后点击“继续旅程”。':'尚无游戏存档 · 开始后会自动保存。';
}};
/* One activation path per control. pointerup used to fire before click and let the
   interface change underneath the finger (drawer opening, Run becoming Stop), which
   made 0.1.7 buttons feel broken on phones. */
const on=(id,fn)=>{const el=$(id);if(el)el.addEventListener('click',fn);};
const closeDrawer=()=>document.body.classList.remove('drawer');
const closeMenu=()=>{const m=$('menuDialog');if(m&&m.open)m.close();};
const menu=(id,fn)=>on(id,()=>{closeMenu();fn();});
/* The file drawer lives inside #workbench. Hiding that section also hides the drawer,
   so the game page only adds gameview and lets CSS collapse the editor. */
function showGame(){flush();closeDrawer();closeMenu();$('lounge').hidden=false;document.body.classList.add('gameview');$('activePath').textContent='游戏';$('dirtyFlag').textContent='伍子平 · 星火远征';const gameTab=$('gameTab');if(gameTab)gameTab.classList.add('selected');const backToFile=$('codeTab');if(backToFile){backToFile.classList.remove('selected');backToFile.textContent=workspaceMode==='game'?'← 回到首页':'← 返回刚才的文件';}send('gameState');}
function showCode(){closeMenu();$('workbench').hidden=false;$('lounge').hidden=true;document.body.classList.remove('gameview');const gameTab=$('gameTab');if(gameTab)gameTab.classList.remove('selected');const codeTab=$('codeTab');if(codeTab)codeTab.classList.add('selected');renderFiles();if(view)view.requestMeasure();}
function setWorkspaceMode(mode){
  workspaceMode=selectedMode=mode;
  updateLabPanel();
  updateDeskShortcut();
  const drawToggle=$('drawToggle');if(drawToggle)drawToggle.hidden=mode!=='notepad';
  const mdToggle=$('mdToggle');if(mdToggle)mdToggle.hidden=mode!=='notepad';
  if(mode!=='notepad')setMdPreview(false);
  if(mode!=='notepad')document.body.classList.remove('notepad');
  if(mode!=='lecture')document.body.classList.remove('lecture');
  if(mode!=='tts')document.body.classList.remove('tts');
  if(mode!=='ai')document.body.classList.remove('aiview');
  if(mode!=='game')document.body.classList.remove('gameview');
  if(mode!=='model')document.body.classList.remove('modelview');
  if(mode!=='focus')document.body.classList.remove('focusview');
  if(mode!=='pelican')document.body.classList.remove('pelicanview');
  if(mode!=='cards')document.body.classList.remove('cardsview');
  if(mode!=='mistakes')document.body.classList.remove('mistakesview');
  if(mode!=='habits')document.body.classList.remove('habitsview');
  if(mode!=='schedule')document.body.classList.remove('scheduleview');
  if(mode!=='novel')document.body.classList.remove('novelview');
  if(mode!=='medquiz')document.body.classList.remove('medquizview');
  if(mode!=='exams')document.body.classList.remove('examsview');
  if(mode!=='medcalc')document.body.classList.remove('medcalcview');
  if(mode!=='soundscape'){document.body.classList.remove('soundscapeview');ssStop();}
  if(mode!=='overview')document.body.classList.remove('overviewview');
  for(const [id,m] of [['focusPanel','focus'],['pelicanPanel','pelican'],['cardsPanel','cards'],['mistakesPanel','mistakes'],['habitsPanel','habits'],['schedulePanel','schedule'],['novelPanel','novel'],['medquizPanel','medquiz'],['examsPanel','exams'],['medcalcPanel','medcalc'],['soundscapePanel','soundscape'],['overviewPanel','overview'],['modelPanel','model'],['aiPanel','ai']]){
    const el=$(id);if(el&&mode!==m)el.hidden=true;
  }
}
on('filesToggle',()=>{closeMenu();document.body.classList.toggle('drawer');});on('backdrop',closeDrawer);on('closeExplorer',closeDrawer);on('newFile',()=>nameDialog());on('newTab',()=>nameDialog());menu('menuNew',()=>nameDialog());
menu('findButton',()=>{openSearchPanel(view);const searchInput=document.querySelector('.cm-search input');if(searchInput)searchInput.focus();else if(view)view.focus();});menu('settingsButton',()=>{applySettings();$('settingsDialog').showModal();});on('saveButton',()=>saveFile());menu('menuSave',()=>saveFile());menu('exportButton',()=>saveFile(true));on('runButton',run);on('stopButton',()=>{append('\n[已手动停止]\n');stop();});on('outputTab',()=>outputTab(false));on('inputTab',()=>outputTab(true));on('clearOutput',()=>$('output').replaceChildren());on('saveOutput',saveOutputToFile);$('output').addEventListener('click',event=>{const link=event.target.closest('.errlink');if(link)gotoError({path:link.dataset.path,line:+link.dataset.line,column:+link.dataset.col||1});});on('foldConsole',()=>setConsole($('consolePanel').classList.contains('folded')));on('openFile',()=>{flush();closeDrawer();native?send('open'):$('browserFiles').click();});on('openFolder',()=>{flush();closeDrawer();native?send('folder'):$('browserFolder').click();});menu('menuOpen',()=>{flush();native?send('open'):$('browserFiles').click();});menu('menuFolder',()=>{flush();native?send('folder'):$('browserFolder').click();});on('moreButton',()=>$('menuDialog').showModal());$('browserFiles').onchange=browserImport;$('browserFolder').onchange=browserImport;$('stdin').oninput=scheduleSave;
on('codeTab',()=>{if(workspaceMode==='game'){flush();openLanding(true);return;}showCode();});on('gameTab',showGame);menu('menuGame',showGame);menu('menuMode',()=>{flush();openLanding(true);});on('playGame',()=>{flush();if(native)send('play');else notify('此预览仅展示编辑器，安装 APK 后可直接进入原生游戏。');});on('exportGame',()=>native?send('exportGame'):notify('游戏存档备份在 Android APK 中使用。'));on('importGame',()=>native?send('importGame'):notify('安装 APK 后可导入游戏备份。'));on('drawToggle',()=>{if(workspaceMode!=='notepad')return;if(isDrawMode()){exitDrawMode();}else{enterDrawMode();}});
/* Markdown 预览：记事本里把当前笔记渲染成排版视图，纯展示不可编辑。 */
let mdOn=false;
function updateMdPreview(){
  const box=$('mdPreview');if(!box||!mdOn)return;
  box.innerHTML=renderMarkdown(view?view.state.doc.toString():'');
}
function setMdPreview(on){
  mdOn=!!on&&workspaceMode==='notepad';
  const box=$('mdPreview'),btn=$('mdToggle');
  if(box)box.hidden=!mdOn;
  if(btn)btn.setAttribute('aria-pressed',mdOn?'true':'false');
  if(mdOn)updateMdPreview();
}
on('mdToggle',()=>{if(workspaceMode!=='notepad')return;if(isDrawMode())exitDrawMode();setMdPreview(!mdOn);});
$('menuDialog').addEventListener('click',event=>{if(event.target===$('menuDialog'))$('menuDialog').close();});
/* 菜单关掉以后焦点别丢在 body 上：没有别的对话框接着开、也没有谁自己接过焦点，
   就还给齿轮按钮。老 WebView 的 focus(options) 可能不接受参数，兜一层。 */
$('menuDialog').addEventListener('close',()=>{
 if(document.querySelector('dialog[open]'))return;
 const current=document.activeElement;
 if(current&&current!==document.body)return;
 const more=$('moreButton');if(!more)return;
 try{more.focus({preventScroll:true});}catch(e){try{more.focus();}catch(ignored){}}
});
/* AI 输入区表单：内联 onsubmit="return false" 违反 CSP（script-src 不含 unsafe-inline），
   换成显式监听阻止提交时的页面导航。发送逻辑（Ctrl+Enter / 点击）在 ai.js，不受影响。 */
$('aiComposer').addEventListener('submit',event=>event.preventDefault());

/* ---------------- 笔记模板 ---------------- */
const quizRequester=createQuizRequester({send:(type,data)=>send(type,data),notify,native});
let quizCurrent=null,quizAnswers={},quizSelfGrades={},quizResult=null,quizNoteText='',quizRequestToken=0;

function currentAISettings(){
  const data=aiSerialize();
  return data&&data.settings?data.settings:{};
}
function templateDanger(){
  const lecture=workspaceMode==='lecture';
  return {lecture,recording:lecture&&lectureBusy(),hasStamps:lecture&&lectureStampCount()>0};
}
function renderTemplateChoices(){
  const list=$('templateList');if(!list)return;
  list.replaceChildren();
  const selected=(state.noteTemplates&&state.noteTemplates.last)||'blank';
  for(const template of NOTE_TEMPLATES){
    const card=document.createElement('button');
    card.type='button';card.className='template-card'+(template.id===selected?' selected':'');
    card.dataset.template=template.id;card.setAttribute('role','radio');
    card.setAttribute('aria-checked',template.id===selected?'true':'false');
    const title=document.createElement('strong');title.textContent=template.title;
    const copy=document.createElement('small');copy.textContent=template.description;
    card.append(title,copy);
    card.onclick=()=>{
      state.noteTemplates=sanitizeTemplateState({last:template.id});
      scheduleSave();renderTemplateChoices();updateTemplateHint();
    };
    list.append(card);
  }
}
function updateTemplateHint(){
  const template=templateById(state.noteTemplates&&state.noteTemplates.last)||NOTE_TEMPLATES[0];
  const danger=templateDanger();
  const hint=$('templateHint'),insert=$('templateInsert');
  if(!hint||!insert)return;
  if(danger.lecture){
    hint.textContent=danger.recording||danger.hasStamps
      ?'课堂笔记固定为「课堂笔记.md」，并靠时间戳定位。当前'+(danger.recording?'正在录音':'已有时间戳')+'，插入模板会打乱时间轴；请用「新建模板笔记」另存一篇。'
      :'课堂笔记固定为「课堂笔记.md」。当前没有时间戳，可以插入；录音开始后请改用新建。';
    insert.disabled=danger.recording||danger.hasStamps;
  }else{
    hint.textContent='「新建模板笔记」会创建 '+template.baseName+'.md，重名自动编号；「插入当前笔记」把模板放到光标处。';
    insert.disabled=!!worker;
  }
}
function openTemplateDialog(){
  if(worker){notify('请先停止运行，再使用笔记模板。');return;}
  closeMenu();renderTemplateChoices();updateTemplateHint();
  const dlg=$('templateDialog');if(dlg&&!dlg.open)dlg.showModal();
}
function createTemplateNote(){
  if(worker){notify('请先停止运行，再新建模板笔记。');return;}
  const template=templateById(state.noteTemplates&&state.noteTemplates.last)||NOTE_TEMPLATES[0];
  if(state.files.length>=160){
    const hint=$('templateHint');if(hint)hint.textContent='当前工作区最多 160 个文件，先整理或导出一些草稿。';
    notify('当前工作区最多 160 个文件。');return;
  }
  const action=noteTemplateAction({mode:workspaceMode,action:'create'});
  if(!action.ok){notify(action.message);return;}
  const path=templateFileName(template.id,state.files.map(file=>file.path));
  state.files.push(makeFile(path,template.content));
  if(!state.opened.includes(path))state.opened.push(path);
  changed();
  const dlg=$('templateDialog');if(dlg&&dlg.open)dlg.close();
  const open=action.open&&(workspaceMode==='notepad'||workspaceMode==='python');
  if(open){
    switchFile(path);
    notify('已新建模板笔记：'+path);
  }else{
    scheduleSave();
    notify('已新建模板笔记：'+path+'；当前课堂笔记和录音时间戳保持不变，可在文件列表打开。');
  }
}
function insertTemplateNote(){
  if(worker){notify('请先停止运行，再插入模板。');return;}
  const template=templateById(state.noteTemplates&&state.noteTemplates.last)||NOTE_TEMPLATES[0];
  if(!template.content.trim()){
    const hint=$('templateHint');if(hint)hint.textContent='空白模板没有正文；请用「新建模板笔记」创建空白文件。';
    notify('空白模板没有正文；请用「新建模板笔记」创建空白文件。');return;
  }
  const danger=templateDanger();
  const action=noteTemplateAction({mode:workspaceMode,action:'insert',recording:danger.recording,hasStamps:danger.hasStamps});
  if(!action.ok){notify(action.message);updateTemplateHint();return;}
  if(!view){notify('编辑器还没有准备好。');return;}
  const selection=view.state.selection.main;
  const result=insertTemplate(view.state.doc.toString(),template.content,{from:selection.from,to:selection.to});
  if(!result.insert){notify('没有可插入的内容。');return;}
  view.dispatch({changes:{from:result.from,to:result.to,insert:result.insert},selection:{anchor:result.cursor},scrollIntoView:true});
  changed();
  const dlg=$('templateDialog');if(dlg&&dlg.open)dlg.close();
  notify('已插入「'+template.title+'」模板。');
}
on('templateCancel',()=>{const dlg=$('templateDialog');if(dlg&&dlg.open)dlg.close();});
on('templateCreate',createTemplateNote);
on('templateInsert',insertTemplateNote);
$('templateDialog').addEventListener('click',event=>{if(event.target===$('templateDialog'))$('templateDialog').close();});
menu('menuTemplates',openTemplateDialog);

/* ---------------- 代码片段库 ---------------- */
function openSnippetDialog(){
  if(worker){notify('请先停止运行，再插入代码片段。');return;}
  closeMenu();
  const dlg=$('snippetDialog'),list=$('snippetList'),lead=$('snippetLead');
  if(!dlg||!list)return;
  const ext=extension(active()?active().path:'');
  const items=snippetsFor(ext);
  list.replaceChildren();
  if(!items.length){
    if(lead)lead.textContent='当前文件（.'+(ext||'无扩展名')+'）暂时没有配套片段。支持 Python、C/C++、JavaScript、HTML、CSS。';
    const p=document.createElement('p');p.className='hint';p.textContent='换个对应语言的代码文件再试试。';list.append(p);
  }else{
    if(lead)lead.textContent='当前语言：'+language(active().path)[0]+'，共 '+items.length+' 个片段。点一下插到光标处。';
    for(const s of items){
      const card=document.createElement('button');
      card.type='button';card.className='snippet-card';
      const title=document.createElement('strong');title.textContent=s.title;
      const desc=document.createElement('small');desc.textContent=s.desc;
      card.append(title,desc);
      card.onclick=()=>insertSnippet(s.id);
      list.append(card);
    }
  }
  dlg.showModal();
}
function insertSnippet(id){
  if(worker){notify('请先停止运行，再插入代码片段。');return;}
  const s=snippetById(id);
  if(!s||!view){notify('编辑器还没有准备好。');return;}
  const sel=view.state.selection.main;
  view.dispatch({changes:{from:sel.from,to:sel.to,insert:s.code},selection:{anchor:sel.from+s.code.length},scrollIntoView:true});
  changed();
  const dlg=$('snippetDialog');if(dlg&&dlg.open)dlg.close();
  notify('已插入「'+s.title+'」片段。');
}
on('snippetClose',()=>{const dlg=$('snippetDialog');if(dlg&&dlg.open)dlg.close();});
$('snippetDialog').addEventListener('click',event=>{if(event.target===$('snippetDialog'))$('snippetDialog').close();});
menu('menuSnippets',openSnippetDialog);

/* ---------------- 全项目搜索 ---------------- */
function runProjectSearch(){
  const input=$('searchInput'),list=$('searchResults'),meta=$('searchMeta');
  if(!input||!list)return;
  const q=input.value;
  const caseSensitive=$('searchCase')&&$('searchCase').checked;
  const {results,total,truncated}=searchProject(state.files,q,{caseSensitive,maxResults:200,maxPerFile:20});
  list.replaceChildren();
  if(!q.trim()){
    if(meta)meta.textContent='输入关键词，在所有工作区文件里查找。';
    return;
  }
  if(meta)meta.textContent=total?('找到 '+total+' 处'+(truncated?'（仅显示前 '+results.length+' 处）':'')):'没有匹配。';
  for(const r of results){
    const row=document.createElement('button');
    row.type='button';row.className='search-row';
    const loc=document.createElement('span');loc.className='search-loc';loc.textContent=r.path+':'+r.line;
    const txt=document.createElement('span');txt.className='search-text';txt.textContent=r.text.trim()||'（空行）';
    row.append(loc,txt);
    row.onclick=()=>{
      const dlg=$('searchDialog');if(dlg&&dlg.open)dlg.close();
      gotoError({path:r.path,line:r.line,column:r.column});
    };
    list.append(row);
  }
}
function openSearchDialog(){
  closeMenu();
  const dlg=$('searchDialog');if(!dlg)return;
  dlg.showModal();
  const input=$('searchInput');
  if(input){input.value='';setTimeout(()=>input.focus(),50);}
  runProjectSearch();
}
on('searchClose',()=>{const dlg=$('searchDialog');if(dlg&&dlg.open)dlg.close();});
$('searchDialog').addEventListener('click',event=>{if(event.target===$('searchDialog'))$('searchDialog').close();});
$('searchInput').addEventListener('input',runProjectSearch);
$('searchCase').addEventListener('change',runProjectSearch);
menu('menuSearch',openSearchDialog);

/* ---------------- 笔记生成试题 ---------------- */
function setQuizStage(stage){
  const dlg=$('quizDialog');if(!dlg)return;
  dlg.dataset.stage=stage;
  $('quizSetup').hidden=stage!=='setup';
  $('quizProgress').hidden=stage!=='generating';
  $('quizBody').hidden=stage!=='ready'&&stage!=='graded';
  $('quizSubmit').hidden=stage!=='ready';
  $('quizRegenerate').hidden=stage==='generating';
  $('quizCancel').hidden=stage!=='generating';
  if(stage==='ready'){const result=$('quizResult');if(result){result.hidden=true;result.replaceChildren();}}
}
function openQuizDialog(){
  if(worker){notify('请先停止运行，再使用笔记出题。');return;}
  closeMenu();
  const dlg=$('quizDialog');if(!dlg||dlg.open)return;
  quizRequestToken++;
  quizRequester.cancel({silent:true});
  quizCurrent=null;quizAnswers={};quizSelfGrades={};quizResult=null;
  quizNoteText=view?view.state.doc.toString():active().text;
  const path=active()?active().path:'当前笔记';
  const noteInfo=$('quizNoteInfo');
  if(noteInfo)noteInfo.textContent='当前笔记：'+path+' · '+quizNoteText.length+' 字';
  const availability=quizAIAvailability(currentAISettings(),{native});
  const ai=$('quizAi'),offline=$('quizOffline'),hint=$('quizHint'),privacy=$('quizPrivacy');
  const empty=!quizNoteText.trim();
  if(ai){ai.disabled=empty||!availability.ok;ai.textContent=availability.ok?'AI 生成（发送笔记）':'AI 生成不可用';ai.classList.toggle('primary',availability.ok);ai.hidden=false;}
  if(offline){offline.disabled=empty;offline.classList.toggle('primary',!availability.ok);}
  if(privacy)privacy.textContent='隐私：点「AI 生成」会把当前笔记正文（最多前 '+QUIZ_NOTE_LIMIT+' 字）发送到你配置的接口'+(availability.endpoint?'（'+availability.endpoint+'）':'')+'。只有点击按钮才会发送；取消或关闭对话框会中断这次请求。离线练习只在本机从笔记句子出题，不发送任何内容。';
  if(hint)hint.textContent=empty?'当前笔记是空的，先写几句。':(availability.ok?'AI 与离线练习都可以用。':'暂不能使用 AI：'+availability.message);
  setQuizStage('setup');
  dlg.showModal();
}
function quizAnswersFromForm(){
  const answers={};
  if(!quizCurrent)return answers;
  for(const question of quizCurrent.questions){
    if(question.type==='single'){
      const checked=document.querySelector('input[name="quiz-'+question.id+'"]:checked');
      answers[question.id]=checked?checked.value:'';
    }else{
      const input=document.querySelector('.quiz-input[data-qid="'+question.id+'"],.quiz-textarea[data-qid="'+question.id+'"]');
      answers[question.id]=input?input.value:'';
    }
  }
  return answers;
}
function renderQuiz(quiz){
  quizCurrent=quiz;quizAnswers={};quizSelfGrades={};quizResult=null;
  const title=$('quizMetaTitle'),source=$('quizSource'),hint=$('quizHint');
  if(title)title.textContent=quiz.title||'笔记练习';
  if(source){source.textContent=quiz.source==='ai'?'AI 生成':'离线基础练习';source.className='quiz-source '+(quiz.source==='ai'?'ai':'offline');}
  if(hint)hint.textContent=quiz.note||(quiz.source==='ai'?'题目由 AI 生成；解析和原文依据仅供参考。':'题目在本机从笔记句子和关键词生成；答案回指原文。');
  const box=$('quizQuestions');if(box)box.replaceChildren();
  quiz.questions.forEach((question,index)=>{
    const card=document.createElement('section');card.className='quiz-question';card.dataset.qid=question.id;
    const head=document.createElement('div');head.className='quiz-qhead';
    const number=document.createElement('span');number.className='quiz-number';number.textContent=String(index+1);
    const type=document.createElement('span');type.className='quiz-type';type.textContent=QUIZ_TYPE_LABELS[question.type]||question.type;
    head.append(number,type);
    const prompt=document.createElement('p');prompt.className='quiz-prompt';prompt.textContent=question.question;
    card.append(head,prompt);
    if(question.type==='single'){
      const options=document.createElement('div');options.className='quiz-options';
      question.options.forEach((option,optionIndex)=>{
        const label=document.createElement('label');label.className='quiz-option';
        const input=document.createElement('input');input.type='radio';input.name='quiz-'+question.id;input.value=option;
        const text=document.createElement('span');text.textContent=String.fromCharCode(65+optionIndex)+'. '+option;
        label.append(input,text);options.append(label);
      });
      card.append(options);
    }else if(question.type==='blank'){
      const input=document.createElement('input');input.type='text';input.className='quiz-input';input.dataset.qid=question.id;
      input.autocomplete='off';input.placeholder='填写答案';input.setAttribute('aria-label','第 '+(index+1)+' 题填空答案');
      card.append(input);
    }else{
      const area=document.createElement('textarea');area.className='quiz-textarea';area.dataset.qid=question.id;
      area.rows=3;area.placeholder='用自己的话回答；提交后可自评';area.setAttribute('aria-label','第 '+(index+1)+' 题简答');
      card.append(area);
    }
    const feedback=document.createElement('div');feedback.className='quiz-feedback';feedback.hidden=true;
    card.append(feedback);
    if(box)box.append(card);
  });
  const submit=$('quizSubmit');if(submit){submit.disabled=false;submit.hidden=false;}
  const save=$('quizSave');if(save){save.disabled=false;save.textContent='保存练习';save.hidden=true;}
  const retry=$('quizRetry');if(retry)retry.hidden=true;
  const result=$('quizResult');if(result){result.hidden=true;result.replaceChildren();}
}
function renderQuizFeedback(){
  if(!quizCurrent||!quizResult)return;
  const resultById=new Map(quizResult.items.map(item=>[item.id,item]));
  const box=$('quizQuestions');
  if(box)for(const card of box.querySelectorAll('.quiz-question')){
    const question=quizCurrent.questions.find(item=>item.id===card.dataset.qid);
    const item=resultById.get(card.dataset.qid);
    if(!question||!item)continue;
    card.classList.toggle('correct',item.status==='correct');
    card.classList.toggle('wrong',item.status==='wrong');
    card.classList.toggle('pending',item.status==='self');
    for(const input of card.querySelectorAll('input,textarea'))input.disabled=true;
    const feedback=card.querySelector('.quiz-feedback');if(!feedback)continue;
    feedback.hidden=false;feedback.replaceChildren();
    const status=document.createElement('strong');status.className='quiz-feedback-status';
    status.textContent=item.status==='correct'?(item.selfGraded?'✓ 自评：答对了':'✓ 回答正确'):item.status==='wrong'?(item.selfGraded?'✗ 自评：还需加强':'✗ 回答错误'):'… 简答题待自评';
    feedback.append(status);
    if(question.type==='short'&&item.status==='self'){
      const row=document.createElement('div');row.className='quiz-selfgrade';
      for(const [value,label] of [[true,'答对了'],[false,'还需加强']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.onclick=()=>{
          quizSelfGrades[question.id]=value;
          quizResult=gradeQuiz(quizCurrent,quizAnswers,quizSelfGrades);
          renderQuizFeedback();
        };
        row.append(button);
      }
      feedback.append(row);
    }
    if(item.response&&String(item.response).trim()){
      const mine=document.createElement('p');mine.className='quiz-mine';mine.textContent='我的作答：'+item.response;feedback.append(mine);
    }
    const answer=document.createElement('p');answer.className='quiz-correct-answer';
    answer.textContent='正确答案：'+(question.type==='single'&&question.answerIndex>=0?String.fromCharCode(65+question.answerIndex)+'. ':'')+question.answer;
    feedback.append(answer);
    if(question.explanation){const p=document.createElement('p');p.className='quiz-explanation';p.textContent='解析：'+question.explanation;feedback.append(p);}
    if(question.evidence){
      const p=document.createElement('p');p.className='quiz-evidence';
      p.textContent='原文依据'+(question.evidenceLine?'（第 '+question.evidenceLine+' 行）':'')+'：'+question.evidence;
      feedback.append(p);
    }
  }
  updateQuizSummary();
}
function updateQuizSummary(){
  if(!quizResult)return;
  const box=$('quizResult');if(!box)return;
  box.hidden=false;box.replaceChildren();
  const score=document.createElement('strong');score.className='quiz-score';
  score.textContent=quizResult.complete
    ?'得分 '+quizResult.correct+' / '+quizResult.total+' · '+quizResult.score+' 分'
    :'自动判分 '+quizResult.correct+' / '+quizResult.decided+' · '+quizResult.pending+' 道简答待自评';
  const note=document.createElement('p');
  note.textContent=quizResult.complete?'可以点「保存练习」把题目、答案和原文依据写入工作区。':'简答题自评后会重新计算得分。';
  box.append(score,note);
  const retry=$('quizRetry');if(retry)retry.hidden=!quizResult.items.some(item=>item.status==='wrong');
  const save=$('quizSave');if(save)save.hidden=false;
}
function startQuizGeneration(forceOffline){
  if(!quizNoteText.trim()){
    const hint=$('quizHint');if(hint)hint.textContent='当前笔记为空，先写几句再出题。';
    notify('当前笔记为空，先写几句再出题。');return;
  }
  const token=++quizRequestToken;
  let request;
  try{
    request=quizRequester.generate({
      noteText:quizNoteText,
      settings:currentAISettings(),
      count:normalizeQuizCount($('quizCount').value),
      forceOffline,
      nativeAllowed:native
    });
  }catch(error){
    setQuizStage('setup');
    const hint=$('quizHint');if(hint)hint.textContent='练习生成失败：'+(error&&error.message?error.message:error);
    notify('练习生成失败，请重试。');
    return;
  }
  setQuizStage('generating');
  const cancel=$('quizCancel');if(cancel)cancel.hidden=request.mode!=='ai';
  const progress=$('quizProgressText');
  if(progress)progress.textContent=forceOffline?'正在本机生成离线练习…':(request.mode==='ai'?'正在请求 AI 出题…（笔记正文会发送到你配置的接口）':'正在准备离线练习…');
  request.promise.then(result=>{
    if(token!==quizRequestToken||!$('quizDialog').open)return;
    if(result.cancelled){setQuizStage('setup');$('quizHint').textContent='已取消生成，没有继续发送请求。';return;}
    if(!result.ok){setQuizStage('setup');$('quizHint').textContent=result.error||'生成失败';notify(result.error||'生成失败');return;}
    if(result.fallback)notify('AI 出题未完成，已改用离线基础练习。');
    renderQuiz(result.quiz);
    setQuizStage('ready');
    const hint=$('quizHint');
    if(hint)hint.textContent=result.source==='ai'?'AI 已生成练习；解析和原文依据仅供参考。':'已在本机生成离线练习，没有发送笔记。';
  }).catch(error=>{
    if(token!==quizRequestToken||!$('quizDialog').open)return;
    setQuizStage('setup');
    const hint=$('quizHint');if(hint)hint.textContent='练习生成失败：'+(error&&error.message?error.message:error);
    notify('练习生成失败，请重试。');
  });
}
on('quizCancel',()=>{
  quizRequestToken++;
  quizRequester.cancel({silent:false});
  setQuizStage('setup');
  const hint=$('quizHint');if(hint)hint.textContent='已取消生成。';
});
on('quizSubmit',()=>{
  if(!quizCurrent)return;
  quizAnswers=quizAnswersFromForm();
  quizResult=gradeQuiz(quizCurrent,quizAnswers,quizSelfGrades);
  renderQuizFeedback();
  setQuizStage('graded');
  const save=$('quizSave');if(save)save.hidden=false;
});
on('quizRetry',()=>{
  if(!quizCurrent||!quizResult)return;
  const retry=retryWrongQuiz(quizCurrent,quizResult);
  if(!retry){
    const hint=$('quizHint');if(hint)hint.textContent='没有需要重做的错题。';
    notify('没有需要重做的错题。');return;
  }
  renderQuiz(retry);setQuizStage('ready');
  const hint=$('quizHint');if(hint)hint.textContent='已筛出 '+retry.questions.length+' 道错题，重新作答。';
});
on('quizSave',()=>{
  if(!quizCurrent)return;
  const now=new Date();
  if(state.files.length>=160){
    const hint=$('quizHint');if(hint)hint.textContent='当前工作区最多 160 个文件，先整理或导出一些草稿。';
    notify('当前工作区最多 160 个文件。');return;
  }
  const path=quizFileName(now,state.files.map(file=>file.path));
  const markdown=quizToMarkdown(quizCurrent,quizResult,{date:now});
  state.files.push(makeFile(path,markdown));
  if(!state.opened.includes(path))state.opened.push(path);
  changed();
  const save=$('quizSave');if(save){save.disabled=true;save.textContent='已保存';}
  const dlg=$('quizDialog');if(dlg&&dlg.open)dlg.close();
  const open=!worker&&(workspaceMode==='notepad'||workspaceMode==='python');
  if(open)switchFile(path);
  notify('练习已保存到 '+path+(open?'':'，可在文件列表打开')+'。');
});
on('quizRegenerate',()=>{
  quizRequestToken++;quizRequester.cancel({silent:true});
  quizCurrent=null;quizAnswers={};quizSelfGrades={};quizResult=null;
  setQuizStage('setup');
  const hint=$('quizHint');if(hint)hint.textContent='可以重新选择 AI 或离线练习。';
});
on('quizClose',()=>{const dlg=$('quizDialog');if(dlg&&dlg.open)dlg.close();});
$('quizDialog').addEventListener('close',()=>{
  quizRequestToken++;
  quizRequester.cancel({silent:true});
});
$('quizDialog').addEventListener('click',event=>{if(event.target===$('quizDialog'))$('quizDialog').close();});
on('quizAi',()=>startQuizGeneration(false));
on('quizOffline',()=>startQuizGeneration(true));
menu('menuQuiz',openQuizDialog);

for(const b of document.querySelectorAll('.quickkeys button')){
 let startX=0,startY=0,moved=false;
 b.addEventListener('pointerdown',event=>{startX=event.clientX;startY=event.clientY;moved=false;});
 b.addEventListener('pointermove',event=>{if(Math.hypot(event.clientX-startX,event.clientY-startY)>12)moved=true;});
 b.addEventListener('mousedown',event=>event.preventDefault());
 b.addEventListener('click',event=>{
  if(moved)return;moved=false;
  if(worker)return;
  const key=b.dataset.key;
  if(key==='tab')indentMore(view);
  else if(key==='undo')undo(view);
  else if(key==='redo')redo(view);
  else if(key==='left'||key==='right'){const pos=Math.max(0,Math.min(view.state.doc.length,view.state.selection.main.head+(key==='left'?-1:1)));view.dispatch({selection:{anchor:pos},scrollIntoView:true});}
  else{if(key==='newline'){const sel=view.state.selection.main;view.dispatch({changes:{from:sel.from,to:sel.to,insert:'\n'},selection:{anchor:sel.from+1}});}else{const text=b.dataset.insert||'',sel=view.state.selection.main;view.dispatch({changes:{from:sel.from,to:sel.to,insert:text+(b.dataset.pair||'')},selection:{anchor:sel.from+text.length}});}}
  view.focus();
 });
}
function handleEscape(event){
  const target=event&&event.target;
  if(target&&target.closest&&target.closest('.cm-search'))return;
  const {openDialog,ctx}=backContext();
  const decision=resolveEscapeBack(ctx);
  if(!decision.action)return;
  if(decision.action===BACK.SEARCH){
    const active=document.activeElement;
    if(active&&active.closest&&active.closest('.cm-search'))return;
  }
  if(applyBackDecision(decision,{openDialog,escape:true}))event.preventDefault();
}
document.addEventListener('keydown',event=>{const mod=event.ctrlKey||event.metaKey;if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();if(worker)notify('运行中无法写回原文件，请先停止运行');else saveFile(event.shiftKey);}else if(event.key==='F5'||mod&&event.key==='Enter'){event.preventDefault();run();}else if(mod&&event.key.toLowerCase()==='o'){event.preventDefault();$('openFile').click();}else if(mod&&event.key.toLowerCase()==='n'){event.preventDefault();nameDialog();}else if(event.key==='Escape'){handleEscape(event);}});
window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();});
const onViewportChange=()=>{if((window.visualViewport?window.visualViewport.height:innerHeight)<520)setConsole(false);syncAiHandle();};
window.addEventListener('resize',onViewportChange);if(window.visualViewport)window.visualViewport.addEventListener('resize',onViewportChange);
/* Home is the root screen. A mode sits on top of it; back returns here. */
const landing = $('landing');
const catalogScroll = $('toolCatalog');
const homeCards = [...$('toolCatalog').querySelectorAll('.home-card')];
let catalogFromWheel = false, catalogFocus = null, catalogScrollTop = 0;
const MODE_KEY='ember-studio-mode';
let deskKind='study';
const deskExamples=defaults().files;
let labPanelView = null;
let homeWeekOffset=0;
let studioTabs=sanitizeTabState(state.ui&&state.ui.tabs);
let recentMode=(state.ui&&state.ui.recentMode)||'time';
let rootVisible=true,moduleOwnerTab='home',lastTabTapAt=0,lastTabTapName='',aiHandleApi=null;

const currentTab=()=>studioTabs.activeTab;
const tabRoot=$(`recentRoot`),profileRoot=$('profileRoot'),tabbar=$('studioTabbar');
const tabButtons=[...document.querySelectorAll('[data-studio-tab]')];
const recentModeButtons=[...document.querySelectorAll('[data-recent-mode]')];

function sourceForMode(mode){
  if(mode==='lecture')return 'lecture';
  if(mode==='photo')return 'photo';
  if(mode==='scan')return 'scan';
  if(mode==='ai')return 'ai';
  if(mode==='python'||mode==='notepad')return 'code';
  return 'import';
}

function recordRecent(entry){
  const clean=entry&&typeof entry==='object'?entry:null;
  if(!clean)return;
  const mode=clean.mode||workspaceMode;
  const path=clean.path||'';
  const item={
    source:clean.source||sourceForMode(mode),
    path,
    uri:clean.uri||'',
    title:clean.title||path.split('/').pop()||'未命名材料',
    format:clean.format||formatForPath(path),
    size:clean.size||0,
    pages:clean.pages||0,
    openedAt:Date.now(),
    payload:clean.payload||{}
  };
  if(!item.path&&!item.uri)return;
  state.recents=upsertRecent(state.recents,item,item.openedAt);
  if(rootVisible&&currentTab()==='recent')renderRecents();
  scheduleSave();
}

function recentTimeLabel(t){
  const d=new Date(Number(t)||0),now=new Date();
  if(d.toDateString()===now.toDateString())return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return (d.getMonth()+1)+'/'+d.getDate();
}

function openRecent(item){
  if(item&&(item.source==='photo'||item.source==='scan')){
    enterHomeMode(item.source,{originTab:currentTab(),payload:item.payload});
    return;
  }
  if(item&&item.source==='lecture'){
    enterHomeMode('lecture',{originTab:currentTab(),payload:item.payload});
    setTimeout(()=>{
      if(item.payload&&item.payload.kind==='page')setLectureTab('slides');
      if(item.payload&&item.payload.kind==='time')setLectureTab('timeline');
      if(!lectureSeekRecent(item.payload))notify('已打开上课模块，但没有找到对应页面或录音时间点。');
    },fxEnabled()?330:70);
    return;
  }
  if(item&&item.path&&state.files.some(file=>file.path===item.path)){
    enterHomeMode(item.format==='note'?'notepad':'python',{originTab:currentTab()});
    switchFile(item.path);
    return;
  }
  notify('这条材料需要在对应模块里打开；索引已保留。');
}

function renderRecents(){
  const list=$('recentList'),overview=$('recentOverview');
  if(!list)return;
  for(const button of recentModeButtons){
    button.setAttribute('aria-selected',button.dataset.recentMode===recentMode?'true':'false');
  }
  const query=String(($('recentSearch')&&$('recentSearch').value)||'').trim().toLowerCase();
  const filtered=query?state.recents.filter(item=>(item.title+' '+item.path).toLowerCase().includes(query)):state.recents;
  const groups=groupRecents(filtered,recentMode);
  if(overview)overview.textContent=state.recents.length?'本机最近 '+state.recents.length+' 条，正文不会写入工作区 JSON':'打开、保存和导入的材料会出现在这里';
  list.replaceChildren();
  if(!groups.length){
    const empty=query?emptyState('⌕','没有找到','换个关键词，或清空搜索后再试。',{label:'清空搜索',onClick:()=>{const input=$('recentSearch');if(input){input.value='';renderRecents();input.focus();}}}):emptyState('◷','还没有最近文件','打开或导入一份材料后，会按时间、来源和格式整理。',{label:'去首页',onClick:()=>showStudioTab('home')});
    list.append(empty);return;
  }
  for(const group of groups){
    const box=document.createElement('section');box.className='recent-group';
    const title=document.createElement('h2');title.textContent=group.title;box.append(title);
    for(const item of group.items){
      const row=document.createElement('div');row.className='recent-row'+(item.pinned?' pinned':'');row.dataset.id=item.id;
      const main=document.createElement('button');main.type='button';main.className='recent-main';
      const thumb=document.createElement('span');thumb.className='recent-thumb';
      if(item.thumbnail&&/^(data:image\/|blob:)/i.test(item.thumbnail)){const img=document.createElement('img');img.alt='';img.src=item.thumbnail;thumb.append(img);}
      else thumb.textContent=(item.format==='slides'?'PPT':item.format==='image'?'IMG':item.format==='audio'?'AUD':item.format==='note'?'TXT':'DOC');
      const copy=document.createElement('span');copy.className='recent-copy';
      const name=document.createElement('strong');name.textContent=item.title;
      const meta=document.createElement('small');meta.textContent=recentMeta(item);
      copy.append(name,meta);
      const time=document.createElement('span');time.className='recent-time';time.textContent=recentTimeLabel(item.openedAt);
      main.append(thumb,copy,time);main.onclick=()=>openRecent(item);
      const menu=document.createElement('button');menu.type='button';menu.className='recent-menu';menu.textContent='⋯';menu.setAttribute('aria-label','更多操作');
      menu.onclick=event=>{
        event.stopPropagation();
        const old=row.querySelector('.recent-actions');if(old){old.remove();return;}
        for(const open of list.querySelectorAll('.recent-actions'))open.remove();
        const actions=document.createElement('div');actions.className='recent-actions';
        const add=(label,fn)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=e=>{e.stopPropagation();fn();};actions.append(button);};
        add(item.pinned?'取消固定':'固定',()=>{state.recents=togglePinned(state.recents,item.id);renderRecents();scheduleSave();});
        add('重命名',()=>{const title=window.prompt('新的名称',item.title);if(title){state.recents=renameRecent(state.recents,item.id,title);renderRecents();scheduleSave();}});
        add('导出',()=>downloadText(item.title+'.recent.json',JSON.stringify(item,null,2),'application/json'));
        add('信息',()=>notify(recentMeta(item)+' · '+(item.path||item.uri)));
        add('删除',()=>{if(window.confirm('从最近记录中删除《'+item.title+'》？原文件不会被删除。')){state.recents=removeRecent(state.recents,item.id);renderRecents();scheduleSave();}});
        row.append(actions);
        setTimeout(()=>{
          const outside=e=>{if(!actions.contains(e.target)){actions.remove();document.removeEventListener('pointerdown',outside,true);}};
          document.addEventListener('pointerdown',outside,true);
        },0);
      };
      row.append(main,menu);
      box.append(row);
    }
    list.append(box);
  }
}

function renderProfile(){
  let sum={streak:0,weekTotal:0,cards:{total:0},mistakes:{total:0}};
  try{sum=buildOverview(state,Date.now());}catch(e){}
  const values={
    profileStreak:sum.streak||0,
    profileFocus:(sum.week||[]).reduce((total,day)=>total+(Number(day.focus)||0),0),
    profileCards:sum.cards&&sum.cards.total||0,
    profileMistakes:sum.mistakes&&sum.mistakes.total||0
  };
  for(const [id,value] of Object.entries(values)){const node=$(id);if(node)node.textContent=String(value);}
}

function applyHomeSettings(){
  const settings=state.ui.homeSettings||{};
  const map={homeAiHandle:'aiHandle',homeTimetableDefault:'timetableDefaultOpen',homeWeekend:'showWeekend',homeEvening:'showEvening'};
  for(const [id,key] of Object.entries(map)){const node=$(id);if(node)node.checked=key==='timetableDefaultOpen'?settings[key]===true:settings[key]!==false;}
}

function updateHomeSetting(key,value){
  const settings={...state.ui.homeSettings,[key]:value};
  state.ui=sanitizeUi({...state.ui,tabs:studioTabs,homeSettings:settings,timetableOpen:key==='timetableDefaultOpen'?value:state.ui.timetableOpen});
  applyHomeSettings();renderWorkspaces();syncAiHandle();scheduleSave();
}

function activeRootScroll(){
  if(currentTab()==='recent')return tabRoot;
  if(currentTab()==='profile')return profileRoot;
  if(landing.dataset.surface==='catalog')return catalogScroll;
  return $(deskKind==='code'?'codeDesk':'studyDesk');
}

function captureTabScroll(){
  const node=activeRootScroll();
  if(node)studioTabs=rememberTabScroll(studioTabs,node.scrollTop,studioTabs.activeTab);
}

function syncTabbar(){
  for(const button of tabButtons)button.setAttribute('aria-selected',button.dataset.studioTab===studioTabs.activeTab?'true':'false');
}

function showStudioTab(tab,{focus=false}={}){
  if(!['recent','home','profile'].includes(tab))tab='home';
  captureTabScroll();
  studioTabs=selectTab(studioTabs,tab);
  state.ui=sanitizeUi({...state.ui,tabs:studioTabs,activeTab:tab,recentMode});
  rootVisible=true;
  document.body.classList.remove('studio-module');
  document.body.classList.toggle('studio-tab-recent',tab==='recent');
  document.body.classList.toggle('studio-tab-profile',tab==='profile');
  if(tabbar)tabbar.hidden=false;
  if(tab==='home')resetLandingRoot();
  landing.hidden=tab!=='home';
  if(tabRoot)tabRoot.hidden=tab!=='recent';
  if(profileRoot)profileRoot.hidden=tab!=='profile';
  landingOpen=tab==='home';
  syncTabbar();
  if(tab==='home'){
    if(landing.dataset.surface==='catalog'){
      landing.dataset.surface='desk';
      $('workspaceTitle').textContent=deskKind==='code'?'编程':'学习';
      $('catalogHome').hidden=true;
      workspacePages.open(deskKind,{animate:false});
    }
    renderWorkspaces();
    workspacePages.align();
    const node=activeRootScroll();
    if(node)node.scrollTop=studioTabs.scroll.home||0;
  }else if(tab==='recent'){
    renderRecents();
    tabRoot.scrollTop=studioTabs.scroll.recent||0;
  }else{
    renderProfile();
    profileRoot.scrollTop=studioTabs.scroll.profile||0;
  }
  if(focus){
    const root=tab==='recent'?tabRoot:tab==='profile'?profileRoot:landing;
    if(root){if(!root.hasAttribute('tabindex'))root.setAttribute('tabindex','-1');root.focus({preventScroll:true});}
  }
  scheduleSave();
  syncAiHandle();
}

function resetLandingRoot(){
  if(!landing)return;
  clearTimeout(landingTimer);
  landing.hidden=false;
  landing.classList.remove('landing-out');
  landing.removeAttribute('aria-hidden');
  landingOpen=true;
  rootVisible=true;
  document.body.classList.remove('studio-module');
  if(tabbar)tabbar.hidden=false;
  syncAiHandle();
}

function returnToStudioRoot(){
  const tab=moduleOwnerTab||'home';
  studioTabs=closeTabPage(studioTabs,tab).state;
  showStudioTab(tab);
}

function syncAiHandle(){
  const handle=$('aiEdgeHandle');if(!handle)return;
  const settings=state.ui&&state.ui.homeSettings||{};
  const viewport=window.visualViewport?window.visualViewport.height:window.innerHeight;
  const show=settings.aiHandle!==false&&rootVisible&&studioTabs.activeTab==='home'&&!document.body.classList.contains('studio-module')&&viewport>=500;
  handle.hidden=!show;
  if(aiHandleApi)aiHandleApi.sync();
}

function labForFile(path) {
  return PYTHON_LABS.find(lab => state.pythonLabs[lab.id]?.path === path);
}

function moveLabPath(from, to) {
  const lab = labForFile(from);
  if (lab) state.pythonLabs[lab.id].path = to;
}

function openPythonLab(id) {
  const lab = PYTHON_LABS.find(item => item.id === id);
  if (!lab) return;
  const progress = state.pythonLabs[id];
  let file = state.files.find(item => item.path === progress?.path);
  const needsDraft = !file || extension(file.path) !== 'py';
  if (needsDraft && state.files.length >= 160) {
    notify('工作区已满，请先整理文件再开始新实验。');
    return;
  }
  if (!enterCodeDeskEditor()) return;
  if (needsDraft) {
    const base = '实验-' + id;
    let path = base + '.py', suffix = 2;
    while (state.files.some(item => item.path === path || item.path.startsWith(path + '/'))) {
      path = base + '-' + suffix++ + '.py';
    }
    file = makeFile(path, file ? file.text : lab.starter);
    state.files.push(file);
    state.pythonLabs[id] = {prediction:'',hasRun:false,output:'',runSource:'',...progress,path};
  }
  switchFile(file.path);
}

function updateLabPanel() {
  const file = active();
  const lab = workspaceMode === 'python' && extension(file.path) === 'py' ? labForFile(file.path) : null;
  const progress = lab ? state.pythonLabs[lab.id] : null;
  const modified = !!progress?.hasRun && progress.runSource !== file.text;
  const running = !!worker;
  if (labPanelView && labPanelView.progress === progress &&
      labPanelView.modified === modified && labPanelView.running === running) return;
  labPanelView = {progress, modified, running};
  renderPythonLabPanel($('pythonLabPanel'), {
    lab, progress: progress && {...progress, modified, running},
    onPredict(value) {
      progress.prediction = value;
      scheduleSave();
    },
    onRun: run
  });
}

function updateDeskShortcut(){
  const next=workspaceMode==='python'?'学习区':'编程区';
  for(const id of ['deskSwitch','aiDeskSwitch']){
    const button=$(id);
    button.textContent=next;
    button.setAttribute('aria-label','切换到'+next);
  }
}
function renderWorkspaces() {
  if (!ready) return;
  const study = $('studyDesk'), code = $('codeDesk');
  const studyTop = study.scrollTop, codeTop = code.scrollTop;
  const studyBody = $('deskBody'), codeBody = $('codeBody');
  studyBody.setAttribute('aria-busy', 'false');
  codeBody.setAttribute('aria-busy', 'false');
  renderCodeDesk(codeBody,{state,exampleFiles:deskExamples,lastCodePath,
    openCode:()=>enterHomeMode('python'),
    openCodeFile:path=>{if(enterCodeDeskEditor())switchFile(path);},
    newCodeFile:ext=>{
      if(state.files.length>=160){notify('工作区已有 160 个文件，请先整理文件。');return;}
      if(!enterCodeDeskEditor())return;
      const draft=createDeskDraft(state.files,ext);
      state.files.push({...makeFile(draft.path,draft.text),...draft});
      switchFile(draft.path);
    },
    importCodeFile:()=>{if(enterCodeDeskEditor())$('openFile').click();}
  });
  renderStudyDesk(studyBody,{state,openMode:enterHomeMode,runStudyAction:runPlanAction,
    labProgress:state.pythonLabs,openLab:openPythonLab,
    weekboard:{
      state,open:state.ui.timetableOpen,weekOffset:homeWeekOffset,
      onToggle(open){
        state.ui=sanitizeUi({...state.ui,timetableOpen:open});
        scheduleSave();renderWorkspaces();
      },
      onWeekOffset(delta){
        if(delta===0)homeWeekOffset=0;
        else homeWeekOffset+=delta;
        renderWorkspaces();
      },
      onOpenCourse(){enterHomeMode('schedule');},
      onEdit(id){
        enterHomeMode('schedule');
        setTimeout(()=>{
          const course=state.schedule.courses.find(item=>item.id===id);
          if(course)schedOpenForm(course);
        },fxEnabled()?330:70);
      }
    }
  });
  study.scrollTop = studyTop;
  code.scrollTop = codeTop;
}
function enterCodeDeskEditor(){
  if(worker){notify('请先停止正在运行的程序。');return false;}
  enterHomeMode('python');
  return !landingOpen&&workspaceMode==='python';
}
function updateWorkspacePage(page) {
  const inCatalog = page === 'catalog';
  landing.dataset.surface = inCatalog ? 'catalog' : 'desk';
  $('workspaceTitle').textContent = {study: '学习', code: '编程', catalog: '全部工具'}[page];
  $('catalogHome').hidden = !inCatalog;
  catalogFromWheel = false;
  if (!inCatalog && deskKind !== page) {
    deskKind = page;
    if (ready) flush();
  }
}
function showDesk(kind) {
  const fromModule = !landingOpen;
  if (fromModule) openLanding(true);
  workspacePages.open(kind, {animate: !fromModule, focus: true});
}
function closeDeskCatalog() {
  const restoreWheelFocus = catalogFromWheel;
  showDesk(deskKind);
  if (restoreWheelFocus) $('deskWheel').focus({preventScroll:true});
}
function switchModuleDesk(){
  if(worker||lectureBusy()){
    notify(worker?'请先停止正在运行的程序，再切换工作区。':'请先停止录音，再切换工作区。');
    return;
  }
  showDesk(workspaceMode==='python'?'study':'code');
}
const workspacePages = bindWorkspacePages($('workspacePages'), $('workspaceTabs'), updateWorkspacePage);
const wheelPage = () => landing.dataset.surface === 'catalog' ? 'tools' : deskKind;
bindWorkspaceWheel($('workspaceWheel'), $('deskWheel'), wheelPage, destination => {
  if (destination === 'tools') {
    workspacePages.open('catalog', {focus: true});
    catalogFromWheel = true;
  } else if (destination === 'game') {
    enterHomeMode('game');
  } else {
    showDesk(destination);
  }
});
on('catalogHome',closeDeskCatalog);
on('deskSettings',()=>{applySettings();$('settingsDialog').showModal();});
on('deskSwitch',switchModuleDesk);
on('aiDeskSwitch',switchModuleDesk);
const KNOWN_MODES=HOME_ACTIONS.map(item=>item.id);
let landingOpen=true,landingTimer=0,selectedMode='',workspaceMode='python',lastCodePath='',lastTtsPath='',lastNotePath='',homeFromSession=false,lastOpened='';
updateDeskShortcut();
/* 原生侧在 ready 之后发 capabilities；浏览器预览里修图页可以直接打开，扫描需要相机。 */
let moduleCaps={native,browserPhoto:!native,sdk:0};
try{const savedMode=localStorage.getItem(MODE_KEY);if(KNOWN_MODES.includes(savedMode))selectedMode=savedMode;}catch(e){}
function rememberedMode(){if(KNOWN_MODES.includes(lastOpened))return lastOpened;return homeFromSession&&KNOWN_MODES.includes(workspaceMode)?workspaceMode:selectedMode;}
function refreshAvailability(){for(const card of homeCards){const a=moduleAvailability(card.dataset.mode,moduleCaps);card.dataset.unavailable=a.ok?'0':'1';if(!a.ok)card.title=a.message;else card.removeAttribute('title');}}
function markLandingReady() {
  landing.dataset.ready = '1';
  for (const card of homeCards) card.disabled = false;
  for (const id of ['deskStudy', 'deskCode', 'deskCatalog', 'deskWheel', 'deskSettings']) $(id).disabled = false;
  refreshAvailability();
  renderWorkspaces();
  workspacePages.open(landing.dataset.surface === 'catalog' ? 'catalog' : deskKind, {animate: false});
}
function hideLanding(ownerTab=moduleOwnerTab||currentTab()){
  if(!landing)return;
  captureTabScroll();
  moduleOwnerTab=ownerTab;
  rootVisible=false;
  document.body.classList.add('studio-module');
  if(tabbar)tabbar.hidden=true;
  syncAiHandle();
  if(tabRoot)tabRoot.hidden=true;
  if(profileRoot)profileRoot.hidden=true;
  if(workspaceMode==='ai')aiEnterPanel();
  if(workspaceMode==='tts')ttsShowBar();
  if(workspaceMode==='model'&&modelApi)modelApi.enter();
  if(workspaceMode==='pelican'&&pelicanApi)pelicanApi.enter();
  if(!landingOpen){landing.hidden=true;clearTimeout(landingTimer);return;}
  landingOpen=false;
  landing.classList.add('landing-out');
  landing.setAttribute('aria-hidden','true');
  clearTimeout(landingTimer);
  landingTimer=setTimeout(()=>{
    if(landingOpen){landing.hidden=false;landing.classList.remove('landing-out');landing.removeAttribute('aria-hidden');return;}
    landing.hidden=true;landing.classList.remove('landing-out');
    if(view&&['python','notepad','lecture','tts'].includes(workspaceMode))view.focus();
  },fxEnabled()?310:280);
}
function openLanding(reopen=false){
  if(!landing)return;
  if(reopen&&workspaceMode==='tts')ttsHideBar();
  if(reopen&&workspaceMode==='ai'){setAISettings(false);aiHidePanel();}
  if(reopen&&workspaceMode==='model'&&modelApi)modelApi.leave();
  if(reopen&&workspaceMode==='pelican'&&pelicanApi)pelicanApi.leave();
  closeDrawer();closeMenu();
  if(view){try{closeSearchPanel(view);}catch(e){}}
  resetLandingRoot();
  homeFromSession=!!reopen;
  if(reopen&&KNOWN_MODES.includes(workspaceMode)){selectedMode=workspaceMode;lastOpened=workspaceMode;}
  renderWorkspaces();
  workspacePages.align();
  if (landing.dataset.surface === 'catalog') {
    catalogScroll.scrollTop = catalogScrollTop;
    (catalogFocus || $('catalogHome')).focus({preventScroll:true});
  }
  showStudioTab(moduleOwnerTab||'home');
}
function setLectureTab(name){
  const tab=name==='timeline'||name==='slides'?name:'notes';
  document.body.dataset.lectureTab=tab;
  for(const button of document.querySelectorAll('.lecture-tab')){
    const on=button.dataset.tab===tab;
    button.classList.toggle('active',on);
    button.setAttribute('aria-selected',on?'true':'false');
  }
}
/* 模块自己的子层，栈顶在前。新功能要加子层时在这里登记，返回键就会先关它。 */
const MODULE_LAYERS=[
  {id:'aiSettings',mode:'ai',open:()=>!!$('aiPanel')&&$('aiPanel').classList.contains('settings-open'),close:()=>setAISettings(false)},
  {id:'modelPanel',mode:'model',open:()=>!!modelApi&&modelApi.panelOpen(),close:()=>{if(modelApi)modelApi.closePanel();}}
];
function moduleLayers(){return MODULE_LAYERS.filter(layer=>(!layer.mode||layer.mode===workspaceMode)&&layer.open()).map(layer=>layer.id);}
function closeModuleLayer(id){const layer=MODULE_LAYERS.find(item=>item.id===id);if(layer)layer.close();}
function setAISettings(open){const panel=$('aiPanel'),btn=$('aiSettingsToggle');if(!panel)return;panel.classList.toggle('settings-open',!!open);if(btn){btn.setAttribute('aria-expanded',open?'true':'false');btn.textContent=open?'收起设置':'设置';}}
function backContext(){
  const openDialog=document.querySelector('dialog[open]');
  return {
    openDialog,
    ctx:{
      dialogOpen:!!openDialog,
      drawerOpen:document.body.classList.contains('drawer'),
      drawing:isDrawMode()||document.body.classList.contains('drawing')||($('drawLayer')&&!$('drawLayer').hidden),
      searchOpen:!!(view&&view.dom&&view.dom.querySelector('.cm-search')),
      homeOpen:rootVisible,
      activeTab:studioTabs.activeTab,
      tabDepth:tabDepth(studioTabs),
      moduleOpen:!rootVisible,
      catalogOpen:studioTabs.activeTab==='home'&&landing.dataset.surface==='catalog',
      loungeOpen:!!$('lounge')&&!$('lounge').hidden,
      layers:moduleLayers(),
      mode:workspaceMode,
      lectureTab:document.body.dataset.lectureTab||'notes'
    }
  };
}
function applyBackDecision(decision,{openDialog=null,escape=false}={}){
  switch(decision.action){
    case BACK.DIALOG:
      if(openDialog)openDialog.close('cancel');
      return true;
    case BACK.CATALOG:
      closeDeskCatalog();
      return true;
    case BACK.TAB_PAGE:
      if(!rootVisible)returnToStudioRoot();
      else{
        studioTabs=resolveTabBack(studioTabs).state;
        showStudioTab(studioTabs.activeTab);
      }
      return true;
    case BACK.TAB_HOME:
      showStudioTab('home');
      return true;
    case BACK.DRAWER:
      document.body.classList.remove('drawer');
      return true;
    case BACK.DRAW:
      exitDrawMode();
      setTimeout(()=>{if(view)view.focus();},0);
      return true;
    case BACK.SEARCH:
      closeSearchPanel(view);
      if(view)view.focus();
      return true;
    case BACK.LAYER:
      closeModuleLayer(decision.layer);
      return true;
    case BACK.LECTURE_TAB:
      setLectureTab('notes');
      return true;
    case BACK.EDITOR:
      showCode();
      return true;
    case BACK.HOME:
      flush();
      returnToStudioRoot();
      return true;
    case BACK.EXIT:
      if(escape)return false;
      flush();
      return false;
    default:return false;
  }
}
function handleSystemBack(){
  try{
    if(aiHandleApi&&aiHandleApi.dragging){aiHandleApi.cancel();return true;}
    const {openDialog,ctx}=backContext();
    return applyBackDecision(resolveBack(ctx),{openDialog});
  }catch(error){
    console.error('[Studio] back handling failed',error);
    return true;  }
}
/* 刷新后 active 可能是模板笔记；先恢复它，不能又跳回固定的 笔记.txt。 */
function ensureNote(){
  const target=notepadTarget({active:state.active,lastNote:lastNotePath,files:state.files});
  let note=state.files.find(f=>f.path===target.path);
  if(!note){note=makeFile(target.path,'');state.files.push(note);}
  lastNotePath=note.path;
  if(!state.opened.includes(note.path))state.opened.push(note.path);
  return note;
}
function ensureLectureNote(){let note=state.files.find(f=>f.path==='课堂笔记.md');if(!note){note=makeFile('课堂笔记.md','');state.files.push(note);changed();}if(!state.opened.includes(note.path))state.opened.push(note.path);return note;}
function ensureEnglishText(){let text=state.files.find(f=>f.path==='English.txt');if(!text){const activeFile=state.files.find(f=>f.path===state.active&&/\.(txt|md)$/i.test(f.path)&&/[A-Za-z]/.test(f.text||''));if(activeFile)text=activeFile;}if(!text){if(state.files.length>=160){notify('工作区已有 160 个文件，请先打开英文文本或腾出一个文件名额。');return null;}text=makeFile('English.txt','The old lighthouse stood at the edge of the bay, and every evening its light swept across the water. Mara liked to sit on the steps below it and read until the pages went grey.\n\nOne night a storm rolled in from the sea. The wind tore at her jacket, but the light kept turning, steady as a heartbeat. She closed her book and watched it work, and decided she would write about it in the morning.\n');state.files.push(text);changed();}if(!state.opened.includes(text.path))state.opened.push(text.path);lastTtsPath=text.path;return text;}
function applyMode(mode){
  const guard=canLeaveMode({recording:workspaceMode==='lecture'&&lectureBusy(),running:!!worker,to:mode});
  if(!guard.ok&&guard.reason==='recording'){notify('正在上课录音，请先点「⏹ 停止」结束录音，再切换模式。');selectedMode='lecture';return false;}
  if(!guard.ok){notify('Python 或 JavaScript 正在运行，请先停止运行，再切换模式。');return false;}
  const ttsTarget=mode==='tts'?((lastTtsPath&&state.files.find(x=>x.path===lastTtsPath))||state.files.find(x=>x.path==='English.txt')||ensureEnglishText()):null;
  if(mode==='tts'&&!ttsTarget)return false;
  if(workspaceMode==='tts'&&mode!=='tts')ttsModeLeave();
  if(workspaceMode==='model'&&mode!=='model'&&modelApi)modelApi.leave();
  if(workspaceMode==='pelican'&&mode!=='pelican'&&pelicanApi)pelicanApi.leave();
  const leavingAI=workspaceMode==='ai'&&mode!=='ai';
  const fxChanged=workspaceMode!==mode;
  setWorkspaceMode(mode);restorePanelScroll(mode);  const noteEmpty=$('noteEmpty');
  /* 跃迁转场：只在真正换模块时走一次扫描 + 目标面板实体化。 */
  const FX_STAGGER={overview:'.ov-tasks>*',focus:'.focus-actions button',cards:'.cards-actions button',mistakes:'.mist-filters>*',habits:'.habit-add>*',schedule:'.sched-head>*',novel:'.novel-head>*',medquiz:'.mq-row>*',exams:'.exam-head>*',medcalc:'.mc-chips button',soundscape:'.ss-presets button',model:'.model-modes button',ai:'.ai-section',python:'.quickkeys button',notepad:'.quickkeys button',lecture:'.lecture-tab',tts:'.tts-main>*',game:'.game-actions button'};
  const FX_PANEL={overview:'overviewPanel',focus:'focusPanel',cards:'cardsPanel',mistakes:'mistakesPanel',habits:'habitsPanel',schedule:'schedulePanel',novel:'novelPanel',medquiz:'medquizPanel',exams:'examsPanel',medcalc:'medcalcPanel',soundscape:'soundscapePanel',model:'modelPanel',ai:'aiPanel',python:'workbench',notepad:'workbench',lecture:'workbench',tts:'workbench',game:'lounge'};
  const fxEnter=()=>{if(!fxChanged)return;warp();const p=FX_PANEL[mode];if(p)materialize(p,FX_STAGGER[mode]);};
  /* 焦点管理：换模块后把焦点落到面板容器（不显示焦点框），读屏/键盘用户能感知上下文；
     不滚动页面、不打断输入框里正在打字的人。 */
  if(fxChanged){const p=FX_PANEL[mode];const panel=p?$(p):null;
    if(panel){if(!panel.hasAttribute('tabindex'))panel.setAttribute('tabindex','-1');
      setTimeout(()=>{const ae=document.activeElement;const typing=ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.isContentEditable);if(!typing)panel.focus({preventScroll:true});},fxEnabled()?340:60);}}
  if(noteEmpty)noteEmpty.textContent=mode==='lecture'?'点上方「🎙 开始录音」，边听边记；每一行都会自动带上时间戳。':'从这里开始写点什么…';
  const drawToggle=$('drawToggle');
  if(leavingAI)aiModeLeave();
  const aiPanel=$('aiPanel');
  if(mode==='overview'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('overviewview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const op=$('overviewPanel');if(op)op.hidden=false;
    $('activePath').textContent='学习总览';$('dirtyFlag').textContent='';
    renderOverview();fxEnter();
    return true;
  }
  if(mode==='focus'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('focusview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=false;
    $('activePath').textContent='专注番茄';$('dirtyFlag').textContent='';
    renderFocus();fxEnter();
    return true;
  }
  if(mode==='cards'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('cardsview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=false;
    $('activePath').textContent='记忆卡片';$('dirtyFlag').textContent='';
    cardsResetReview();renderCards();fxEnter();
    return true;
  }
  if(mode==='mistakes'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('mistakesview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=false;
    $('activePath').textContent='错题本';$('dirtyFlag').textContent='';
    mistCloseForm();renderMistakes();fxEnter();
    return true;
  }
  if(mode==='habits'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('habitsview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=false;
    $('activePath').textContent='习惯打卡';$('dirtyFlag').textContent='';
    renderHabits();fxEnter();
    return true;
  }
  if(mode==='schedule'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('scheduleview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=false;
    $('activePath').textContent='课程表';$('dirtyFlag').textContent='';
    schedCloseForm();renderSchedule();fxEnter();
    return true;
  }
  if(mode==='novel'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('novelview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=true;
    const np=$('novelPanel');if(np)np.hidden=false;
    $('activePath').textContent='小说阅读器';$('dirtyFlag').textContent='';
    novelShowShelf();renderNovelShelf();fxEnter();
    return true;
  }
  if(mode==='medquiz'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('medquizview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=true;
    const np=$('novelPanel');if(np)np.hidden=true;
    const qp=$('medquizPanel');if(qp)qp.hidden=false;
    $('activePath').textContent='医学生刷题';$('dirtyFlag').textContent='';
    mqShowSetup();renderMqSetup();fxEnter();
    return true;
  }
  if(mode==='exams'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('examsview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=true;
    const np=$('novelPanel');if(np)np.hidden=true;
    const qp=$('medquizPanel');if(qp)qp.hidden=true;
    const ep=$('examsPanel');if(ep)ep.hidden=false;
    $('activePath').textContent='任务 DDL';$('dirtyFlag').textContent='';
    examCloseForm();renderExams();fxEnter();
    return true;
  }
  if(mode==='medcalc'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('medcalcview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=true;
    const np=$('novelPanel');if(np)np.hidden=true;
    const qp=$('medquizPanel');if(qp)qp.hidden=true;
    const ep=$('examsPanel');if(ep)ep.hidden=true;
    const cp2=$('medcalcPanel');if(cp2)cp2.hidden=false;
    $('activePath').textContent='临床计算';$('dirtyFlag').textContent='';
    mcSelect(mcCurrent||'bmi');fxEnter();
    return true;
  }
  if(mode==='soundscape'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('soundscapeview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=true;
    const np=$('novelPanel');if(np)np.hidden=true;
    const qp=$('medquizPanel');if(qp)qp.hidden=true;
    const ep=$('examsPanel');if(ep)ep.hidden=true;
    const cp2=$('medcalcPanel');if(cp2)cp2.hidden=true;
    const ssp=$('soundscapePanel');if(ssp)ssp.hidden=false;
    $('activePath').textContent='潮声 · 白噪音景';$('dirtyFlag').textContent='';
    ssEnter();fxEnter();
    return true;
  }
  if(mode==='pelican'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('pelicanview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const pp=$('pelicanPanel');if(pp)pp.hidden=false;
    $('activePath').textContent='鹈鹕骑车';$('dirtyFlag').textContent='';
    if(!pelicanApi.enter()){notify('鹈鹕骑车需要 WebGL 支持，当前设备暂不可用。');openLanding(true);}fxEnter();
    return true;
  }
  if(mode==='model'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('modelview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const fp2=$('focusPanel');if(fp2)fp2.hidden=true;
    const pp2=$('pelicanPanel');if(pp2)pp2.hidden=true;
    const panel=$('modelPanel');if(panel)panel.hidden=false;
    $('activePath').textContent='3D 建模';$('dirtyFlag').textContent='场景自动保存';
    /* 3D 渲染层 enter 时才建 WebGL；不可用则提示降级。 */
    if(!modelApi.enter()){notify('3D 需要 WebGL 支持，当前设备暂不可用；其它功能不受影响。');openLanding(true);}fxEnter();
    return true;
  }
  if(mode==='ai'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('aiview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=false;
    $('activePath').textContent='AI 助手';$('dirtyFlag').textContent='';
    aiModeEnter();fxEnter();return true;
  }
  if(aiPanel)aiPanel.hidden=true;
  const modelPanelEl=$('modelPanel');if(modelPanelEl)modelPanelEl.hidden=true;
  const focusPanelEl=$('focusPanel');if(focusPanelEl)focusPanelEl.hidden=true;
  const pelicanPanelEl=$('pelicanPanel');if(pelicanPanelEl)pelicanPanelEl.hidden=true;
  document.body.classList.remove('aiview');$('workbench').hidden=false;
  if(mode==='game'){document.body.classList.remove('notepad');document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();showGame();fxEnter();return true;}
  showCode();
  /* 只有代码类文件进入 lastCodePath；模板/课堂笔记不能污染 Python 返回目标。 */
  if(mode==='notepad'){document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(shouldRememberCodePath(state.active))lastCodePath=state.active;document.body.classList.add('notepad');switchFile(ensureNote().path);if(drawToggle)drawToggle.hidden=false;}
  else if(mode==='lecture'){document.body.classList.remove('notepad');document.body.classList.remove('tts');document.body.classList.add('lecture');if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();const note=ensureLectureNote();switchFile(note.path);lectureModeEnter();}
  else if(mode==='tts'){document.body.classList.remove('notepad');document.body.classList.remove('lecture');lectureModeLeave();document.body.classList.add('tts');if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();switchFile(ttsTarget.path);ttsModeEnter();}
  else{document.body.classList.remove('notepad');document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();const f=(lastCodePath&&state.files.find(x=>x.path===lastCodePath))||state.files.find(x=>x.path==='main.py')||state.files.find(x=>!x.path.endsWith('.txt'))||state.files[0];if(f)switchFile(f.path);}
  setTimeout(()=>{if(view)view.focus();},260);fxEnter();
  return true;
}
/* 原生模块（扫描相机、修图）是独立页面：首页留在下面，系统返回键关掉它就回到这里。 */
function openNativeModule(id,originTab=currentTab(),payload={}){
  const meta=moduleById(id);
  const guard=canLeaveMode({recording:workspaceMode==='lecture'&&lectureBusy(),running:!!worker,to:id});
  if(!guard.ok){notify(guard.reason==='recording'?'正在上课录音，请先点「⏹ 停止」结束录音，再打开'+meta.title+'。':'代码正在运行，请先停止，再打开'+meta.title+'。');return false;}
  const a=moduleAvailability(id,moduleCaps);
  if(!a.ok){notify(a.message);return false;}
  flush();
  moduleOwnerTab=originTab;
  studioTabs=openTabPage(studioTabs,id,originTab);
  rootVisible=false;
  landing.hidden=true;
  if(tabRoot)tabRoot.hidden=true;
  if(profileRoot)profileRoot.hidden=true;
  document.body.classList.add('studio-module');
  if(tabbar)tabbar.hidden=true;
  selectedMode=id;lastOpened=id;try{localStorage.setItem(MODE_KEY,id);}catch(e){}
  if(native)send('openModule',{id,payload});
  else if(id==='photo')location.href='../photo/index.html?from=studio';
  return true;
}
function nativeReturned(id,meta={}){
  if(!isNativeModule(id))return;
  if(!rootVisible)returnToStudioRoot();
  lastOpened=id;selectedMode=id;
  const hasOutput=!!(meta&&(meta.uri||meta.path||meta.title));
  if(!hasOutput)return;
  recordRecent({
    source:id,uri:'module:'+id,mode:id,
    title:hasOutput?String(meta.title||meta.path||'').split('/').pop():id==='photo'?'修图材料':'扫描文档',
    format:id==='photo'?'image':'document',
    size:Number(meta&&meta.size)||0,
    pages:Number(meta&&meta.pages)||0,
    payload:{uri:String(meta&&(meta.uri||meta.path)||'module:'+id),title:String(meta&&meta.title||'')}
  });
  catalogFocus?.focus({preventScroll:true});
}
function enterHomeMode(mode,{originTab=currentTab(),payload={}}={}){
  if(!ready||(mode!=='game'&&!KNOWN_MODES.includes(mode)))return;
  moduleOwnerTab=originTab;
  if (landing.dataset.surface === 'catalog') catalogScrollTop = catalogScroll.scrollTop;
  if(isNativeModule(mode)){openNativeModule(mode,originTab,payload);return;}
  /* Re-opening the mode already on screen is a cancel, not another applyMode. */
  if(homeFromSession&&mode===workspaceMode){hideLanding();return;}
  if(!applyMode(mode))return;
  if(mode!=='game'){
    selectedMode=mode;lastOpened=mode;try{localStorage.setItem(MODE_KEY,mode);}catch(e){}
  }
  studioTabs=openTabPage(studioTabs,mode,originTab);
  hideLanding(originTab);
}
for (const card of homeCards) card.addEventListener('click', () => {
  catalogFocus = card;
  enterHomeMode(card.dataset.mode);
});
on('homeButton',()=>{flush();returnToStudioRoot();});
on('aiHome',()=>{flush();returnToStudioRoot();});
on('aiSettingsToggle',()=>{const panel=$('aiPanel');setAISettings(!(panel&&panel.classList.contains('settings-open')));});
aiHandleApi=bindAiHandle($('aiEdgeHandle'),{
  getRatio:()=>state.ui.aiHandle.yRatio,
  setRatio:value=>{state.ui=sanitizeUi({...state.ui,aiHandle:{...state.ui.aiHandle,yRatio:value}});scheduleSave();},
  onOpen:()=>{if(rootVisible&&currentTab()==='home')enterHomeMode('ai',{originTab:'home'});}
});
syncAiHandle();
for(const button of tabButtons){
  button.onclick=()=>{
    const tab=button.dataset.studioTab;
    if(tab!==currentTab()){
      lastTabTapAt=0;lastTabTapName='';
      showStudioTab(tab,{focus:true});
      return;
    }
    const now=Date.now(),result=reselectTab(studioTabs,tab);
    studioTabs=result.state;
    if(result.action==='root'){
      showStudioTab(tab,{focus:true});
    }else if(lastTabTapName===tab&&now-lastTabTapAt<=650){
      const node=activeRootScroll();if(node)node.scrollTop=0;
      showStudioTab(tab);
    }
    lastTabTapName=tab;lastTabTapAt=now;
    scheduleSave();
  };
}
for(const button of recentModeButtons){
  button.onclick=()=>{
    recentMode=button.dataset.recentMode;
    state.ui=sanitizeUi({...state.ui,tabs:studioTabs,recentMode});
    renderRecents();scheduleSave();
  };
}
{const input=$('recentSearch');if(input)input.oninput=debounce(renderRecents,80);}
for(const button of document.querySelectorAll('[data-profile-action]')){
  button.onclick=()=>{
    const action=button.dataset.profileAction;
    if(action==='home'){
      applyHomeSettings();$('homeSettingsDialog').showModal();
    }else if(action==='appearance'||action==='study'){
      $('settingsDialog').showModal();
    }else if(action==='privacy'){
      applySettings();$('settingsDialog').showModal();
    }else if(action==='about'){
      $('aboutDialog').showModal();
    }
  };
}
for(const [id,key] of [['homeAiHandle','aiHandle'],['homeTimetableDefault','timetableDefaultOpen'],['homeWeekend','showWeekend'],['homeEvening','showEvening']]){
  const node=$(id);if(node)node.onchange=()=>updateHomeSetting(key,node.checked);
}
for(const node of [tabRoot,profileRoot]){
  if(node)node.addEventListener('scroll',()=>{
    studioTabs=rememberTabScroll(studioTabs,node.scrollTop,node===tabRoot?'recent':'profile');
  },{passive:true});
}
window.__studioLandingReady=true;
initLecture({
  notify,
  send:(type,payload)=>send(type,payload),
  native:()=>native,
  /* 上课模式的异常要在真机上留痕：写到 logcat 的同时在界面提示。 */
  reportError:text=>{if(native)send('jsError',{kind:'lecture',detail:String(text).slice(0,300)});},
  /* 安装包里 PPT 照片交给原生相册选择器（压缩后只用同源 URL 回传），
     浏览器预览没有桥时返回 false，退回 <input type="file">。 */
  pickSlides:()=>{if(!native)return false;send('pickSlides');return true;},
  /* 整个 PPT 文件交给原生文档选择器：复制进缓存后以同源 URL 回传给页面解析。 */
  pickPptx:()=>{if(!native)return false;send('pickPptx');return true;},
  scheduleSave,
  flush,
  /* 录音前先在原生层拿到 RECORD_AUDIO 运行时权限：WebView 的采集如果等到
     onPermissionRequest 里才弹系统权限框，授权回来时音频源往往已经初始化失败。 */
  requestMic,
  /* 开始新一节录音时把上一节课的笔记正文另存一份，
     时间戳会被清空，正文不能跟着丢。 */
  archiveNote:text=>{
    const value=String(text||'');
    if(!value.trim())return '';
    if(state.files.length>=160){notify('工作区文件已满，上节课笔记没有单独归档，正文仍保留在当前笔记里。');return '';}
    const now=new Date(),p=n=>String(n).padStart(2,'0');
    const stamp=now.getFullYear()+p(now.getMonth()+1)+p(now.getDate())+'-'+p(now.getHours())+p(now.getMinutes());
    let name='课堂笔记-'+stamp+'.md',seq=2;
    while(state.files.some(f=>f.path===name))name='课堂笔记-'+stamp+'-'+(seq++)+'.md';
    state.files.push(makeFile(name,value));
    changed();
    return name;
  },
  onLectureCapture:info=>recordRecent({source:'lecture',uri:'lecture-recording:'+Date.now(),mode:'lecture',title:'课堂录音 '+fmtMin(Math.round((info.duration||0)/60)),format:'audio',payload:{kind:'time',value:Math.round((info.duration||0)*10)/10,label:(info.anchors||0)+' 个锚点'}}),
  onLectureMaterial:info=>recordRecent({source:'lecture',uri:'lecture-slides:'+Date.now(),mode:'lecture',title:'课堂 PPT',format:'slides',pages:info.count||0,payload:{kind:'page',value:1,label:'PPT 第 1 页'}}),
  activePath:()=>state.active,
  view:()=>view,
  editorState:path=>editorStates.get(path)||null,
  ensureNote:ensureLectureNote,
  switchFile:path=>switchFile(path),
  workspaceMode:()=>workspaceMode,
  getState:()=>state
});
initTTS({
  native,
  send,
  notify,
  workspaceMode:()=>workspaceMode,
  getText:()=>view?view.state.doc.toString():active().text,
  getSettings:()=>state.tts,
  setSettings:value=>{state.tts=ttsSanitize(value);},
  saveSettings:scheduleSave,
  /* 当前句高亮用的编辑器钩子：可选，tts.js 每次现取，view 重建后自动跟随。 */
  view:()=>view,
  activePath:()=>state.active
});
function bytesToBase64(bytes){let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));return btoa(binary);}
/* 3D 渲染层静态初始化（IIFE 单文件打包，原生壳内联普通 script）。
 * 设备 WebView 为现代 Chrome，three 可正常解析；初始化不依赖 WebGL，
 * 仅 enter() 时才创建渲染器，WebGL 不可用则降级。 */
const modelApi=initModel({
  notify,native,
  send:(type,payload)=>send(type,payload),
  getState:()=>state.model,
  setState:value=>{state.model=modelSanitize(value);},
  scheduleSave,
  exportBinary:(name,bytes,mime)=>{
    const id='model-'+Date.now()+'-'+Math.floor(Math.random()*1e6);
    if(native){pendingSaves.set(id,{path:name,text:'',binary:true});send('exportBinary',{id,path:name,data:bytesToBase64(bytes),mime});}
    else{const blob=new Blob([bytes],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已导出 '+name);}
  }
});
const pelicanApi=initPelican({
  notify,
  getBest:()=>(state.pelican&&state.pelican.best)||0,
  setBest:b=>{state.pelican={best:b};scheduleSave();},
  onOver:(score,best)=>{notify('鹈鹕撞上了！得分 '+score+'，最佳 '+best+'。');}
});
/* ---------------- 专注番茄 ---------------- */
function todayStr(){const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
function renderFocus(){
  const s=state.focus||DEFAULT_FOCUS();
  const phase=$('focusPhase');if(phase)phase.textContent=s.phase==='work'?'专注':s.phase==='short'?'短休息':'长休息';
  const time=$('focusTime');if(time)time.textContent=fmtTime(s.remaining);
  const ring=$('focusRing');
  if(ring){
    const total=(s.phase==='work'?s.workMin:s.phase==='short'?s.shortMin:s.longMin)*60;
    const frac=total>0?Math.max(0,Math.min(1,s.remaining/total)):0;
    const C=2*Math.PI*52;
    ring.style.strokeDasharray=C.toFixed(1);
    ring.style.strokeDashoffset=(C*(1-frac)).toFixed(1);
    ring.classList.toggle('rest',s.phase!=='work');
  }
  const dots=$('focusDots');
  if(dots){dots.replaceChildren();for(let i=0;i<4;i++){const d=document.createElement('i');if(i<s.cycle)d.className='on';dots.append(d);}}
  const hint=$('focusCycleHint');
  if(hint){
    if(s.phase==='long')hint.textContent='长休息中，好好放松～';
    else if(s.phase==='short')hint.textContent='短休息 · 再来 '+(4-s.cycle)+' 个专注进入长休息';
    else hint.textContent='本轮第 '+s.cycle+' / 4 个 · 完成 4 个进入长休息';
  }
  const start=$('focusStart');if(start)start.textContent=s.running?'暂停':'开始';
  const snd=$('focusSound');if(snd)snd.checked=!!s.sound;
  const wm=$('focusWorkMin'),sm=$('focusShortMin'),lm=$('focusLongMin');
  if(wm&&document.activeElement!==wm)wm.value=s.workMin;
  if(sm&&document.activeElement!==sm)sm.value=s.shortMin;
  if(lm&&document.activeElement!==lm)lm.value=s.longMin;
  const stats=$('focusStats');
  if(stats){const today=s.today&&s.today.date===todayStr()?s.today.count:0;stats.textContent='今日 '+today+' 个 · 累计 '+s.completed+' 个';}
  const chart=$('focusChart');
  if(chart){
    const days=lastNDays(s.history||{},7,todayStr());
    const max=Math.max(1,...days.map(d=>d.count));
    chart.replaceChildren();
    for(const d of days){
      const bar=document.createElement('span');bar.className='bar'+(d.count?'':' zero');
      const fill=document.createElement('i');fill.style.height=Math.round(d.count/max*52+3)+'px';
      const lab=document.createElement('b');lab.textContent=d.date.slice(8);
      bar.title=d.date+'：'+d.count+' 个';bar.append(fill,lab);chart.append(bar);
    }
  }
}
/* 专注×潮声联动：勾选后专注段自动播「深度专注」预设，休息/暂停即停。
   仅在用户勾选时接管音频，不勾选则完全不碰潮声。 */
function focusSoundPlay(){
  state.soundscape=applyPreset(ssState(),'focus');
  const a=ssEnsureAudio();
  if(!a.ensure())return;
  a.resume();
  for(const id of activeLayers(state.soundscape)){const L=state.soundscape.layers[id];a.startLayer(id,L.vol);a.setLayerVol(id,L.vol);}
  for(const l of LAYERS)if(!state.soundscape.layers[l.id].on)a.stopLayer(l.id);
  a.setMaster(state.soundscape.master);
}
function focusSoundStop(){if(ssAudio)ssAudio.stopAll();}
function buzzFocus(){try{if(navigator.vibrate)navigator.vibrate([60,40,60]);}catch(e){}}
/* 专注时把倒计时写进标题栏：切到别的标签/最小化也能瞥见剩余时间。 */
const BASE_TITLE=document.title||'天工';
function syncFocusTitle(){
  const s=state.focus;
  if(s&&s.running){
    const tag=s.phase==='work'?'专注':s.phase==='short'?'短休':'长休';
    document.title=fmtTime(s.remaining)+' · '+tag+' — '+BASE_TITLE;
  }else if(document.title!==BASE_TITLE){
    document.title=BASE_TITLE;
  }
}
setInterval(()=>{
  if(!state.focus||!state.focus.running){syncFocusTitle();return;}
  const r=focusTick(state.focus,todayStr());
  state.focus=r.state;
  if(r.finished){
    notify(state.focus.phase==='work'?'休息结束，开始新一轮专注。':'一个专注段完成，休息一下。');
    buzzFocus();
    /* 完成的是工作段（现进入休息）才记一笔专注。 */
    if(state.focus.phase!=='work')state.studyLog=logStudy(state.studyLog,todayStr(),'focus');
    /* 进入休息段：联动停声；休息结束回工作段不自动响，等用户点开始。 */
    if(state.focus.sound&&state.focus.phase!=='work')focusSoundStop();
    scheduleSave();
  }
  if(workspaceMode==='focus')renderFocus();
  syncFocusTitle();
},1000);
on('focusStart',()=>{
  state.focus=focusToggle(state.focus);
  if(state.focus.sound){if(state.focus.running&&state.focus.phase==='work')focusSoundPlay();else focusSoundStop();}
  renderFocus();syncFocusTitle();scheduleSave();
});
on('focusReset',()=>{state.focus=focusReset(state.focus);if(state.focus.sound)focusSoundStop();renderFocus();syncFocusTitle();scheduleSave();});
on('focusSkip',()=>{state.focus=focusSkip(state.focus);if(state.focus.sound)focusSoundStop();renderFocus();syncFocusTitle();scheduleSave();});
{const fs=$('focusSound');if(fs)fs.onchange=()=>{state.focus={...state.focus,sound:fs.checked};if(!fs.checked)focusSoundStop();else if(state.focus.running&&state.focus.phase==='work')focusSoundPlay();scheduleSave();};}
/* 专注页空格开始/暂停（输入框里打字不触发）。 */
document.addEventListener('keydown',e=>{
  if(workspaceMode!=='focus')return;
  if(e.key!==' '&&e.code!=='Space')return;
  const tag=(e.target&&e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select'||tag==='button'||e.ctrlKey||e.metaKey||e.altKey)return;
  e.preventDefault();$('focusStart').click();
});
for(const [id,key] of [['focusWorkMin','workMin'],['focusShortMin','shortMin'],['focusLongMin','longMin']]){
  const el=$(id);if(el)el.onchange=()=>{state.focus=focusSetMinutes(state.focus,key,+el.value);renderFocus();scheduleSave();};
}

/* 记忆卡片：复习队列 + 翻面 + 四档评分 + 添加/列表。 */
let cardsQueue=[],cardsCurrent=null,cardsShown=false;
function cardsResetReview(){cardsQueue=[];cardsCurrent=null;cardsShown=false;}
function renderCards(){
  const deck=state.cards||deckSanitize(null);
  const st=deckStats(deck,Date.now());
  const stats=$('cardsStats');if(stats)stats.textContent='共 '+st.total+' 张 · 到期 '+st.due+' · 已学 '+st.learned;
  const face=$('cardsFaceText'),hint=$('cardsFaceHint'),rate=$('cardsRate');
  if(cardsCurrent){
    face.textContent=cardsShown?cardsCurrent.back:cardsCurrent.front;
    hint.textContent=cardsShown?'回忆一下，再给自己打分':'点卡片看背面';
    rate.hidden=!cardsShown;
    /* 评分按钮显示真实下次间隔，打分前心里有数。 */
    if(cardsShown){for(const b of rate.querySelectorAll('button')){const iv=previewInterval(cardsCurrent,+b.dataset.rate,Date.now());const lab=b.querySelector('.iv');if(lab)lab.textContent=iv;}}
  }else{
    face.textContent=cardsQueue.length?'共 '+cardsQueue.length+' 张待复习，点「开始复习」':'没有到期的卡片，去添加或稍后再来';
    /* 复习完/无到期时告知下一批何时到，形成节奏预期。 */
    if(!cardsQueue.length){
      const now=Date.now();
      const future=deck.cards.filter(c=>c.due>now);
      if(future.length){
        const next=Math.min(...future.map(c=>c.due));
        hint.textContent='下一批 '+dueLabel({due:next},now)+'到期（'+future.length+' 张）';
      }else hint.textContent='';
    }else hint.textContent='';
    rate.hidden=true;
  }
  const list=$('cardsList');
  const fw=$('cardsFilterWrap');if(fw)fw.hidden=list?list.hidden:true;
  if(list&&!list.hidden){
    list.replaceChildren();
    const q=($('cardsFilter')?$('cardsFilter').value:'').trim().toLowerCase();
    const shown=q?deck.cards.filter(c=>(c.front+' '+c.back).toLowerCase().includes(q)):deck.cards;
    const buildRow=c=>{
      const row=document.createElement('div');row.className='cards-row';
      const t=document.createElement('span');t.className='t';t.textContent=c.front;
      const d=document.createElement('span');d.className='d';d.textContent=dueLabel(c,Date.now());
      const edit=document.createElement('button');edit.type='button';edit.className='edit';edit.textContent='改';
      edit.onclick=()=>cardsBeginEdit(c);
      const del=document.createElement('button');del.type='button';del.textContent='删';
      del.onclick=()=>{
        const removed=c;
        state.cards=removeCard(state.cards,c.id);
        if(cardsEditId===c.id)cardsEndEdit();
        cardsResetReview();renderCards();scheduleSave();
        notifyUndo('已删除「'+removed.front.slice(0,14)+'」',()=>{
          const d=deckSanitize(state.cards);
          if(d.cards.some(x=>x.id===removed.id))return;
          const nextId=Math.max(d.nextId,removed.id+1);
          state.cards={nextId,cards:[...d.cards,removed]};
          cardsResetReview();renderCards();scheduleSave();notify('卡片已恢复，复习进度保留。');
        });
      };
      row.append(t,d,edit,del);return row;
    };
    let shownCount=Math.min(PAGE,shown.length);
    for(const c of shown.slice(0,shownCount))list.append(buildRow(c));
    const moreCards=()=>{
      const next=Math.min(shown.length,shownCount+PAGE);
      const more=list.querySelector('.list-more');if(more)more.remove();
      for(const c of shown.slice(shownCount,next))list.append(buildRow(c));
      shownCount=next;appendMore(list,shown.length,shownCount,moreCards);
    };
    appendMore(list,shown.length,shownCount,moreCards);
    if(!deck.cards.length){list.append(emptyState('🗂','还没有卡片','把要记的做成卡片，到期自动提醒复习。',{label:'添加第一张',onClick:()=>$('cardsToggleAdd').click()}));}
    else if(!shown.length){list.append(emptyState('🔍','没有匹配「'+q+'」的卡片','换个关键词，或清空筛选看看全部。',{label:'清空筛选',onClick:()=>{const f=$('cardsFilter');if(f)f.value='';renderCards();}}));}
  }
  hudMark(document.querySelector('#cardsPanel'));
}
{const cf=$('cardsFilter');if(cf)cf.addEventListener('input',debounce(()=>renderCards(),120));}
on('cardsStart',()=>{cardsQueue=dueCards(state.cards,Date.now());cardsShown=false;cardsCurrent=cardsQueue.shift()||null;renderCards();});
on('cardsFace',()=>{if(!cardsCurrent)return;cardsShown=!cardsShown;renderCards();});
for(const b of document.querySelectorAll('#cardsRate button')){
  b.addEventListener('click',()=>{
    if(!cardsCurrent)return;
    const rated=reviewCard(cardsCurrent,+b.dataset.rate,Date.now());
    if(rated){state.cards={...deckSanitize(state.cards),cards:deckSanitize(state.cards).cards.map(c=>c.id===rated.id?rated:c)};state.studyLog=logStudy(state.studyLog,todayStr(),'cards');tap();}
    cardsShown=false;cardsCurrent=cardsQueue.shift()||null;
    renderCards();scheduleSave();
  });
}
/* 卡片编辑：复用添加表单，改文字不动复习进度。 */
let cardsEditId=null;
function cardsBeginEdit(card){
  cardsEditId=card.id;
  const a=$('cardsAdd');if(a){a.hidden=false;a.classList.add('cards-editing');}
  const l=$('cardsList');if(l)l.hidden=true;
  $('cardsFront').value=card.front;$('cardsBack').value=card.back;
  const save=$('cardsSave');if(save)save.textContent='保存修改';
  const cancel=$('cardsEditCancel');if(cancel)cancel.hidden=false;
  const lab=$('cardsFrontLabel');if(lab)lab.firstChild.textContent='正面（编辑中）';
  $('cardsFront').focus();
}
function cardsEndEdit(){
  cardsEditId=null;
  const a=$('cardsAdd');if(a){a.classList.remove('cards-editing');}
  $('cardsFront').value='';$('cardsBack').value='';
  const save=$('cardsSave');if(save)save.textContent='保存卡片';
  const cancel=$('cardsEditCancel');if(cancel)cancel.hidden=true;
  const lab=$('cardsFrontLabel');if(lab)lab.firstChild.textContent='正面';
}
on('cardsToggleAdd',()=>{const a=$('cardsAdd');const willOpen=a.hidden;cardsEndEdit();a.hidden=!willOpen;const l=$('cardsList');if(l)l.hidden=true;renderCards();});
on('cardsToggleList',()=>{const l=$('cardsList');l.hidden=!l.hidden;const a=$('cardsAdd');if(a)a.hidden=true;cardsEndEdit();renderCards();});
on('cardsEditCancel',()=>{cardsEndEdit();const a=$('cardsAdd');if(a)a.hidden=true;const l=$('cardsList');if(l)l.hidden=false;renderCards();});
on('cardsSave',()=>{
  const f=$('cardsFront').value,b=$('cardsBack').value;
  if(cardsEditId!=null){
    const r=updateCard(state.cards,cardsEditId,f,b);
    if(!r.ok){notify('正面和背面都要填写。');return;}
    state.cards=r.deck;cardsEndEdit();
    const a=$('cardsAdd');if(a)a.hidden=true;
    const l=$('cardsList');if(l)l.hidden=false;
    notify('卡片已修改，复习进度保留');renderCards();scheduleSave();return;
  }
  const r=addCard(state.cards,f,b,Date.now());
  if(!r.ok){notify('正面和背面都要填写。');return;}
  state.cards=r.deck;$('cardsFront').value='';$('cardsBack').value='';
  notify('已添加卡片');renderCards();scheduleSave();
});

/* 错题本：科目/掌握度筛选 + 记错题表单 + 列表(展开/掌握度/编辑/删除)。 */
let mistEditId=null,mistOpen=new Set();
function mistFillSubjects(){
  for(const id of ['mistSubject','mistFormSubject']){
    const sel=$(id);if(!sel||sel.options.length)continue;
    if(id==='mistSubject'){const o=document.createElement('option');o.value='全部';o.textContent='全部科目';sel.append(o);}
    for(const s of SUBJECTS){const o=document.createElement('option');o.value=s;o.textContent=s;sel.append(o);}
  }
}
function mistCloseForm(){mistEditId=null;const f=$('mistForm');if(f)f.hidden=true;}
function mistOpenForm(item){
  mistFillSubjects();
  mistEditId=item?item.id:null;
  $('mistTitle').value=item?item.title:'';
  $('mistFormSubject').value=item?item.subject:'数学';
  $('mistQuestion').value=item?item.question:'';
  $('mistAnswer').value=item?item.answer:'';
  $('mistReason').value=item?item.reason:'';
  const mc=$('mistCause');if(mc)mc.value=item&&item.cause?item.cause:'';
  $('mistForm').hidden=false;
  $('mistTitle').focus();
}
function renderMistakes(){
  mistFillSubjects();
  const book=state.mistakes||bookSanitize(null);
  const st=bookStats(book);
  const stats=$('mistStats');if(stats)stats.textContent='共 '+st.total+' 题 · 已掌握 '+st.mastered+' · 掌握率 '+st.rate+'%';
  if(stats && Object.keys(state.medquiz.wrong).length){
    const pending=unfiledQuizMistakes(book,state.medquiz.wrong,mqBank());
    if(pending.length){
      const recover=document.createElement('button');
      recover.type='button';recover.textContent='收录以往刷错的 '+pending.length+' 道题';
      recover.onclick=()=>{
        let added=0;
        for(const question of pending){
          const result=recordQuizMistake(state.mistakes,question,Date.now());
          if(!result.ok)break;
          state.mistakes=result.book;added++;
        }
        if(added)scheduleSave();
        renderMistakes();notify('已收录 '+added+' 道'+(added<pending.length?'，错题本已满。':'。'));
      };
      stats.append(' ',recover);
    }
  }
  /* 分科条：每科错题数 + 掌握率，点一下按该科筛选（再点取消）。 */
  const subBar=$('mistSubjects');
  if(subBar){
    subBar.replaceChildren();
    const cur=$('mistSubject')?$('mistSubject').value:'全部';
    const subs=Object.keys(st.bySubject).sort((a,b)=>st.bySubject[b]-st.bySubject[a]);
    for(const s of subs){
      const items=book.items.filter(it=>it.subject===s);
      const mastered=items.filter(it=>it.mastery===2).length;
      const rate=items.length?Math.round(mastered/items.length*100):0;
      const chip=document.createElement('button');chip.type='button';
      chip.className='mist-subchip'+(cur===s?' on':'');
      chip.textContent=s+' '+st.bySubject[s]+' · '+rate+'%';
      chip.title=s+'：'+st.bySubject[s]+' 题，已掌握 '+mastered;
      chip.onclick=()=>{const sel=$('mistSubject');if(sel){sel.value=(cur===s?'全部':s);renderMistakes();}};
      subBar.append(chip);
    }
  }
  /* 错因画像：分布 + 最多错因的针对性建议，只统计已标记的题。 */
  const causeBar=$('mistCauses');
  if(causeBar){
    causeBar.replaceChildren();
    const cs=causeStats(book);
    if(cs.tagged>0){
      for(const c of CAUSES){
        if(!cs.byCause[c])continue;
        const chip=document.createElement('span');chip.className='mist-causechip'+(c===cs.top?' top':'');
        chip.textContent=c+' '+cs.byCause[c];
        causeBar.append(chip);
      }
      if(cs.advice){const a=document.createElement('p');a.className='mist-cause-advice';a.textContent='最多「'+cs.top+'」：'+cs.advice;causeBar.append(a);}
    }
  }
  const subject=$('mistSubject')?$('mistSubject').value:'全部';
  const mastery=$('mistMastery')?+$('mistMastery').value:-1;
  const list=$('mistList');if(!list)return;
  let items=filterMistakes(book,subject,mastery);
  const mq=($('mistFilter')?$('mistFilter').value:'').trim().toLowerCase();
  if(mq)items=items.filter(it=>(it.title+' '+it.question+' '+it.answer+' '+it.reason).toLowerCase().includes(mq));
  list.replaceChildren();
  if(!items.length){
    if(!book.items.length)list.append(emptyState('📝','还没有错题','把做错的题记下来，逐个攻克。',{label:'记第一道',onClick:()=>mistOpenForm(null)}));
    else if(mq)list.append(emptyState('🔍','没有匹配「'+mq+'」的错题','换个关键词，或清空筛选看看全部。',{label:'清空筛选',onClick:()=>{const f=$('mistFilter');if(f)f.value='';renderMistakes();}}));
    else list.append(emptyState('✅','这个筛选下没有错题','换个科目或掌握度，或记一道新错题。'));
    return;
  }
  const buildMist=it=>{
    const card=document.createElement('div');card.className='mist-item';
    const head=document.createElement('div');head.className='mist-item-head';
    const t=document.createElement('span');t.className='t';t.textContent=it.title;
    const badge=document.createElement('span');badge.className='mist-badge';badge.textContent=it.subject;
    const mas=document.createElement('span');mas.className='mist-mastery m'+it.mastery;mas.textContent=MASTERY[it.mastery];
    head.append(t,badge,mas);
    if(it.cause){const cc=document.createElement('span');cc.className='mist-causebadge';cc.textContent=it.cause;head.append(cc);}
    head.onclick=()=>{if(mistOpen.has(it.id))mistOpen.delete(it.id);else mistOpen.add(it.id);renderMistakes();};
    card.append(head);
    if(mistOpen.has(it.id)){
      const body=document.createElement('div');body.className='mist-item-body';
      for(const [label,val] of [['题目',it.question],['正解',it.answer],['错因',it.reason]]){
        if(!val)continue;
        const f=document.createElement('div');f.className='mist-field';
        const b=document.createElement('b');b.textContent=label;
        const span=document.createElement('span');span.textContent=val;
        f.append(b,span);body.append(f);
      }
      card.append(body);
      const act=document.createElement('div');act.className='mist-item-actions';
      for(let m=0;m<3;m++){
        const b=document.createElement('button');b.type='button';b.textContent=MASTERY[m];if(it.mastery===m)b.className='on';
        b.onclick=e=>{e.stopPropagation();state.mistakes=setMastery(state.mistakes,it.id,m,Date.now()).book;if(m===2)tap();renderMistakes();scheduleSave();};
        act.append(b);
      }
      const edit=document.createElement('button');edit.type='button';edit.textContent='编辑';
      edit.onclick=e=>{e.stopPropagation();mistOpenForm(it);};
      const del=document.createElement('button');del.type='button';del.className='del';del.textContent='删除';
      del.onclick=e=>{
        e.stopPropagation();
        const removed=it;
        state.mistakes=removeMistake(state.mistakes,it.id);mistOpen.delete(it.id);renderMistakes();scheduleSave();
        notifyUndo('已删除「'+(removed.title||'错题').slice(0,14)+'」',()=>{
          const b=bookSanitize(state.mistakes);
          if(b.items.some(x=>x.id===removed.id))return;
          state.mistakes={nextId:Math.max(b.nextId,removed.id+1),items:[...b.items,removed]};
          renderMistakes();scheduleSave();notify('错题已恢复。');
        });
      };
      const toCard=document.createElement('button');toCard.type='button';
      const hasCard=state.cards.cards.some(c=>c.id===it.reviewCardId);
      toCard.textContent=hasCard?'已制卡':'制成复习卡';toCard.disabled=hasCard;
      toCard.onclick=()=>{
        const result=makeMistakeCard(state.mistakes,state.cards,it.id,Date.now());
        if(!result.ok){notify(result.message);return;}
        state.mistakes=result.book;state.cards=result.deck;
        renderMistakes();scheduleSave();notify('已加入记忆卡片，今天可以复习。');
      };
      act.append(toCard,edit,del);card.append(act);
    }
    return card;
  };
  let shownCount=Math.min(PAGE,items.length);
  for(const it of items.slice(0,shownCount))list.append(buildMist(it));
  const moreMist=()=>{
    const next=Math.min(items.length,shownCount+PAGE);
    const more=list.querySelector('.list-more');if(more)more.remove();
    for(const it of items.slice(shownCount,next))list.append(buildMist(it));
    shownCount=next;appendMore(list,items.length,shownCount,moreMist);
  };
  appendMore(list,items.length,shownCount,moreMist);
  hudMark(document.querySelector('#mistakesPanel'));
}
on('mistAddBtn',()=>mistOpenForm(null));
on('mistCancel',()=>mistCloseForm());
{const ms=$('mistSubject');if(ms)ms.addEventListener('change',()=>renderMistakes());
 const mm=$('mistMastery');if(mm)mm.addEventListener('change',()=>renderMistakes());
 const mf=$('mistFilter');if(mf)mf.addEventListener('input',debounce(()=>renderMistakes(),120));}
on('mistSave',()=>{
  const fields={title:$('mistTitle').value,subject:$('mistFormSubject').value,question:$('mistQuestion').value,answer:$('mistAnswer').value,reason:$('mistReason').value,cause:$('mistCause')?$('mistCause').value:''};
  if(!fields.title.trim()&&!fields.question.trim()){notify('至少填写标题或题目。');return;}
  const now=Date.now();
  if(mistEditId){const r=updateMistake(state.mistakes,mistEditId,fields,now);if(r.ok)state.mistakes=r.book;}
  else{const r=addMistake(state.mistakes,fields,now);if(!r.ok){notify('错题本已满，最多可保存 500 道。');return;}state.mistakes=r.book;}
  mistCloseForm();renderMistakes();scheduleSave();notify('已保存错题');
});

/* 习惯打卡：添加习惯 + 每日打卡 + 连续/最佳天数 + 最近7天点阵。 */
function renderHabits(){
  const book=state.habits||habitsSanitize(null);
  const today=todayStr();
  const st=habitsStats(book,today);
  const stats=$('habitStats');if(stats)stats.textContent='共 '+st.total+' 个 · 今日已打 '+st.doneToday+' · 累计 '+st.totalChecks+' 次';
  const list=$('habitList');if(!list)return;
  list.replaceChildren();
  if(!book.habits.length){list.append(emptyState('🌱','还没有习惯','定一个小习惯，每天打卡攒连续。',{label:'添加第一个',onClick:()=>{const i=$('habitName');if(i)i.focus();}}));return;}
  const buildHabit=h=>{
    const item=document.createElement('div');item.className='habit-item';
    const top=document.createElement('div');top.className='habit-item-top';
    const t=document.createElement('span');t.className='t';t.textContent=h.name;
    const streak=document.createElement('span');streak.className='habit-streak';streak.textContent='🔥 '+currentStreak(h,today)+' 天';
    const best=document.createElement('span');best.className='habit-best';best.textContent='最佳 '+bestStreak(h);
    const done=isChecked(h,today);
    const check=document.createElement('button');check.type='button';check.className='habit-check'+(done?' done':'');check.textContent=done?'已打卡':'打卡';
    check.onclick=()=>{state.habits=toggleCheck(state.habits,h.id,today);if(!done)tap();renderHabits();scheduleSave();};
    top.append(t,streak,best,check);item.append(top);
    /* 28 天热力图（4 行 × 7 列，末格为今天）：点任意格子补卡/取消，未来日禁用。 */
    const week=document.createElement('div');week.className='habit-heat';
    for(const d of lastNDaysChecks(h,28,today)){
      const cell=document.createElement('button');cell.type='button';
      cell.className='hc'+(d.done?' on':'')+(d.date===today?' today':'');
      cell.title=d.date+(d.done?' 已打卡，点击取消':' 未打卡，点击补卡');
      cell.setAttribute('aria-label',cell.title);
      cell.onclick=()=>{state.habits=toggleCheck(state.habits,h.id,d.date);if(!d.done)tap();renderHabits();scheduleSave();};
      week.append(cell);
    }
    item.append(week);
    const foot=document.createElement('div');foot.className='habit-item-foot';
    const del=document.createElement('button');del.type='button';del.textContent='删除';
    del.onclick=()=>{
      const removed=h;
      state.habits=removeHabit(state.habits,h.id);renderHabits();scheduleSave();
      notifyUndo('已删除习惯「'+removed.name.slice(0,12)+'」',()=>{
        const b=habitsSanitize(state.habits);
        if(b.habits.some(x=>x.id===removed.id))return;
        state.habits={nextId:Math.max(b.nextId,removed.id+1),habits:[...b.habits,removed]};
        renderHabits();scheduleSave();notify('习惯已恢复，打卡记录保留。');
      });
    };
    foot.append(del);item.append(foot);
    return item;
  };
  let shownCount=Math.min(PAGE,book.habits.length);
  for(const h of book.habits.slice(0,shownCount))list.append(buildHabit(h));
  const moreHabit=()=>{
    const next=Math.min(book.habits.length,shownCount+PAGE);
    const more=list.querySelector('.list-more');if(more)more.remove();
    for(const h of book.habits.slice(shownCount,next))list.append(buildHabit(h));
    shownCount=next;appendMore(list,book.habits.length,shownCount,moreHabit);
  };
  appendMore(list,book.habits.length,shownCount,moreHabit);
  hudMark(document.querySelector('#habitsPanel'));
}
on('habitAddBtn',()=>{
  const el=$('habitName');const r=addHabit(state.habits,el.value,Date.now());
  if(!r.ok){notify(r.dup?'这个习惯已经有了。':'先输入习惯名称。');return;}
  state.habits=r.book;el.value='';renderHabits();scheduleSave();
});
{const hn=$('habitName');if(hn)hn.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('habitAddBtn').click();}});}

/* 课程表：周网格 + 正在上/下一节 + 冲突检测 + 单双周。 */
let schedEditId=null,schedColor=0;
function schedInfo(){return nowInfo(new Date(),(state.schedule&&state.schedule.termStart)||'');}
function schedCloseForm(){schedEditId=null;const f=$('schedForm');if(f)f.hidden=true;}
function schedFillSelects(){
  const day=$('schedDay');
  if(day&&!day.options.length)DAYS.forEach((d,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=d;day.append(o);});
  const st=$('schedStart');
  if(st&&!st.options.length)PERIODS.forEach((p,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent='第'+(i+1)+'节 '+fmtMin(p[0]);st.append(o);});
  const ln=$('schedLen');
  if(ln&&!ln.options.length)for(let i=1;i<=4;i++){const o=document.createElement('option');o.value=i;o.textContent='连上'+i+'节';ln.append(o);}
  const colors=$('schedColors');
  if(colors&&!colors.children.length){
    COURSE_COLORS.forEach((c,i)=>{
      const b=document.createElement('button');b.type='button';b.style.background=c;b.setAttribute('aria-label','颜色'+(i+1));
      b.onclick=()=>{schedColor=i;[...colors.children].forEach((x,j)=>x.classList.toggle('on',j===i));};
      colors.append(b);
    });
  }
}
function schedOpenForm(course){
  schedFillSelects();
  schedEditId=course?course.id:null;
  $('schedName').value=course?course.name:'';
  $('schedPlace').value=course?course.place:'';
  $('schedTeacher').value=course?course.teacher:'';
  $('schedDay').value=course?course.day:Math.min(7,schedInfo().day);
  $('schedStart').value=course?course.start:1;
  $('schedLen').value=course?course.len:2;
  $('schedWeeks').value=course&&course.weeks.length?course.weeks.join(','):'';
  schedColor=course?course.color:0;
  [...$('schedColors').children].forEach((x,j)=>x.classList.toggle('on',j===schedColor));
  $('schedDelete').hidden=!course;
  $('schedForm').hidden=false;
  $('schedName').focus();
}
function parseWeeks(text){
  const t=String(text||'').trim();
  if(!t)return [];
  const out=new Set();
  for(const part of t.split(/[,，、\s]+/)){
    const m=part.match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if(m){const a=+m[1],b=+m[2];for(let i=Math.min(a,b);i<=Math.max(a,b);i++)out.add(i);}
    else if(/^\d+$/.test(part))out.add(+part);
  }
  return [...out].filter(w=>w>=1&&w<=30).sort((a,b)=>a-b);
}
function renderSchedule(){
  schedFillSelects();
  const sched=state.schedule||scheduleSanitize(null);
  const info=schedInfo();
  const wk=$('schedWeek');if(wk)wk.textContent='第 '+info.week+' 周 · '+DAYS[info.day-1];
  const term=$('schedTermStart');if(term&&document.activeElement!==term)term.value=sched.termStart||'';
  /* 正在上 / 下一节 */
  const st=currentStatus(sched,info);
  const nowBox=$('schedNow');
  if(nowBox){
    if(st.now){
      const c=st.now;
      nowBox.innerHTML='';
      const b=document.createElement('b');b.textContent='正在上 · ';
      nowBox.append(b,document.createTextNode(c.name+(c.place?'（'+c.place+'）':'')));
    }else if(st.next){
      const c=st.next.course;
      const when=st.next.deltaMin!=null?(st.next.deltaMin+'分钟后'):DAYS[st.next.day-1];
      nowBox.innerHTML='';
      const b=document.createElement('b');b.textContent='下一节 · ';
      nowBox.append(b,document.createTextNode(when+' '+c.name+(c.place?'（'+c.place+'）':'')));
    }else{
      nowBox.textContent='这周还没排课，点「＋ 加课」开始。';
    }
  }
  /* 周网格 */
  const grid=$('schedGrid');if(!grid)return;
  grid.replaceChildren();
  grid.append(Object.assign(document.createElement('span'),{className:'sched-corner',textContent:'节'}));
  for(let d=1;d<=7;d++){
    const h=document.createElement('span');h.className='sched-dayhead'+(d===info.day?' today':'');h.textContent=DAYS[d-1];
    h.style.gridColumn=String(d+1);h.style.gridRow='1';grid.append(h);
  }
  for(let p=1;p<=12;p++){
    const cell=document.createElement('span');cell.className='sched-period';cell.textContent=String(p);
    cell.style.gridColumn='1';cell.style.gridRow=String(p+1);grid.append(cell);
  }
  const nowPeriod=(()=>{for(let i=0;i<PERIODS.length;i++){if(info.minutes>=PERIODS[i][0]&&info.minutes<=PERIODS[i][1])return i+1;}return 0;})();
  for(let d=1;d<=7;d++)for(let p=1;p<=12;p++){
    const c=document.createElement('span');c.className='sched-cell'+(d===info.day&&p===nowPeriod?' now':'');
    c.style.gridColumn=String(d+1);c.style.gridRow=String(p+1);grid.append(c);
  }
  for(let d=1;d<=7;d++){
    for(const c of coursesOnDay(sched,d,info.week)){
      const b=document.createElement('button');b.type='button';b.className='sched-course';
      b.style.background=COURSE_COLORS[c.color];
      b.style.gridColumn=String(d+1);b.style.gridRow=(c.start+1)+' / span '+c.len;
      const name=document.createElement('b');name.textContent=c.name;
      const place=document.createElement('small');place.textContent=(c.place||'')+(c.teacher?' · '+c.teacher:'');
      b.append(name,place);
      b.onclick=()=>schedOpenForm(c);
      grid.append(b);
    }
  }
  hudMark(document.querySelector('#schedulePanel'));
}
on('schedAddBtn',()=>schedOpenForm(null));
on('schedCancel',()=>schedCloseForm());
on('schedSave',()=>{
  const fields={name:$('schedName').value,place:$('schedPlace').value,teacher:$('schedTeacher').value,
    day:+$('schedDay').value,start:+$('schedStart').value,len:+$('schedLen').value,
    color:schedColor,weeks:parseWeeks($('schedWeeks').value)};
  if(!fields.name.trim()){notify('先填课名。');return;}
  let r;
  if(schedEditId)r=updateCourse(state.schedule,schedEditId,fields);
  else r=addCourse(state.schedule,fields);
  if(!r.ok){notify(r.conflict?'和已有课撞时间了，换个节次或周次。':'没保存上，检查一下课名。');return;}
  state.schedule=r.sched;schedCloseForm();renderSchedule();scheduleSave();
});
on('schedDelete',()=>{
  if(schedEditId){state.schedule=removeCourse(state.schedule,schedEditId);schedCloseForm();renderSchedule();scheduleSave();}
});
{const ts=$('schedTermStart');if(ts)ts.addEventListener('change',()=>{state.schedule={...scheduleSanitize(state.schedule),termStart:ts.value};renderSchedule();scheduleSave();});}
setInterval(()=>{if(workspaceMode==='schedule')renderSchedule();},30000);

/* 小说阅读器：书架 + 导入TXT + 分章 + 进度记忆 + 主题字号。正文存独立 localStorage 键。 */
let novelChapters=[],novelBookId=null;
const novelTextKey=id=>'ember-novel-text-'+id;
function novelShowShelf(){novelBookId=null;const r=$('novelReaderView');if(r)r.hidden=true;const s=$('novelShelfView');if(s)s.hidden=false;}
function renderNovelShelf(){
  const shelf=state.novel||shelfSanitize(null);
  const list=$('novelShelfList');if(!list)return;
  list.replaceChildren();
  if(!shelf.books.length){list.append(emptyState('📚','书架还空着','导入一本 TXT，随时接着读。',{label:'导入第一本',onClick:()=>$('novelFile').click()}));return;}
  for(const b of shelf.books){
    const row=document.createElement('div');row.className='novel-book';
    const cover=document.createElement('span');cover.className='cover';cover.textContent='📖';
    const info=document.createElement('span');info.className='info';
    const t=document.createElement('b');t.textContent=b.title;
    const meta=document.createElement('small');meta.textContent=(b.author?b.author+' · ':'')+progressText(b);
    info.append(t,meta);
    const open=document.createElement('button');open.type='button';open.className='del';open.style.color='var(--accent)';open.textContent='读';
    open.onclick=()=>novelOpen(b.id);
    const del=document.createElement('button');del.type='button';del.className='del';del.textContent='删';
    del.onclick=()=>{state.novel={...shelfSanitize(state.novel),books:shelfSanitize(state.novel).books.filter(x=>x.id!==b.id)};try{localStorage.removeItem(novelTextKey(b.id));}catch(e){}renderNovelShelf();scheduleSave();};
    row.append(cover,info,open,del);list.append(row);
  }
  hudMark(document.querySelector('#novelPanel'));
}
function novelOpen(id){
  const shelf=state.novel||shelfSanitize(null);
  const book=shelf.books.find(b=>b.id===id);if(!book)return;
  let text='';try{text=localStorage.getItem(novelTextKey(id))||'';}catch(e){}
  novelChapters=splitChapters(text);
  novelBookId=id;
  $('novelShelfView').hidden=true;$('novelReaderView').hidden=false;
  $('novelTitle').textContent=book.title;
  novelRenderChapter(Math.min(book.ch,Math.max(0,novelChapters.length-1)));
}
function novelRenderChapter(ch){
  const body=$('novelBody');if(!body)return;
  const c=novelChapters[ch];
  body.textContent=c?c.body:'（这一章是空的）';
  body.scrollTop=0;
  const shelf=shelfSanitize(state.novel);
  const book=shelf.books.find(b=>b.id===novelBookId);
  if(book){book.ch=ch;state.novel={...shelf,books:shelf.books.map(b=>b.id===novelBookId?book:b)};scheduleSave();}
  $('novelPos').textContent=(ch+1)+' / '+novelChapters.length;
  const npf=$('novelProgressFill');if(npf)npf.style.width=Math.round((ch+1)/Math.max(1,novelChapters.length)*100)+'%';
  $('novelPrev').disabled=ch<=0;
  $('novelNext').disabled=ch>=novelChapters.length-1;
  const s=state.novel.settings;
  body.dataset.theme=s.theme;body.style.fontSize=s.fontSize+'px';body.style.lineHeight=String(s.line);
  for(const [id,th] of [['novelThemePaper','paper'],['novelThemeGreen','green'],['novelThemeNight','night']]){const b=$(id);if(b)b.classList.toggle('on',s.theme===th);}
}
function novelSetTheme(th){state.novel={...shelfSanitize(state.novel),settings:{...state.novel.settings,theme:th}};const body=$('novelBody');if(body)body.dataset.theme=th;for(const [id,t] of [['novelThemePaper','paper'],['novelThemeGreen','green'],['novelThemeNight','night']]){const b=$(id);if(b)b.classList.toggle('on',t===th);}scheduleSave();}
function novelFont(d){const s=novelSettingsSanitize({...state.novel.settings,fontSize:(state.novel.settings.fontSize||18)+d});state.novel={...shelfSanitize(state.novel),settings:s};const body=$('novelBody');if(body)body.style.fontSize=s.fontSize+'px';scheduleSave();}
on('novelImportBtn',()=>$('novelFile').click());
{const f=$('novelFile');if(f)f.addEventListener('change',async()=>{
  const file=f.files&&f.files[0];f.value='';if(!file)return;
  if(file.size>6*1024*1024){notify('文件太大（>6MB），换个小一点的 TXT。');return;}
  let text='';try{text=await file.text();}catch(e){notify('读不了这个文件。');return;}
  const chapters=splitChapters(text);
  if(!chapters.length){notify('文件是空的。');return;}
  const shelf=shelfSanitize(state.novel);
  if(shelf.books.length>=20){notify('书架满了（20 本），先删几本。');return;}
  const id=shelf.nextId;
  const title=(file.name||'未命名').replace(/\.txt$/i,'').slice(0,60);
  const exist=shelf.books.find(b=>b.title===title);
  if(exist){notify('《'+title+'》已在书架，直接打开继续读。');novelOpen(exist.id);return;}
  const book={id,title,author:'',addedAt:Date.now(),chapterCount:chapters.length,chars:text.length,ch:0};
  try{localStorage.setItem(novelTextKey(id),text);}catch(e){notify('本机存储放不下这本书，先删几本。');return;}
  state.novel={...shelf,nextId:id+1,current:id,books:[...shelf.books,book]};
  renderNovelShelf();scheduleSave();novelOpen(id);
});}
on('novelBackShelf',()=>{novelShowShelf();renderNovelShelf();});
on('novelPrev',()=>{const b=shelfSanitize(state.novel).books.find(x=>x.id===novelBookId);if(b&&b.ch>0)novelRenderChapter(b.ch-1);});
on('novelNext',()=>{const b=shelfSanitize(state.novel).books.find(x=>x.id===novelBookId);if(b&&b.ch<novelChapters.length-1)novelRenderChapter(b.ch+1);});
/* 阅读器左右滑动翻页：水平位移明显大于垂直才触发，避免干扰上下滚动阅读。 */
{const nb=$('novelBody');if(nb){let sx=0,sy=0,sw=false;
  nb.addEventListener('touchstart',e=>{if(e.touches.length===1){sx=e.touches[0].clientX;sy=e.touches[0].clientY;sw=true;}},{passive:true});
  nb.addEventListener('touchend',e=>{
    if(!sw)return;sw=false;
    const t=e.changedTouches[0];const dx=t.clientX-sx,dy=t.clientY-sy;
    if(Math.abs(dx)>64&&Math.abs(dx)>Math.abs(dy)*1.6){if(dx<0)$('novelNext').click();else $('novelPrev').click();}
  },{passive:true});
}}
on('novelFontMinus',()=>novelFont(-1));
on('novelFontPlus',()=>novelFont(1));
on('novelThemePaper',()=>novelSetTheme('paper'));
on('novelThemeGreen',()=>novelSetTheme('green'));
on('novelThemeNight',()=>novelSetTheme('night'));
on('novelTocBtn',()=>{
  const toc=$('novelToc');if(!toc)return;
  if(!toc.hidden){toc.hidden=true;return;}
  toc.replaceChildren();
  const cur=shelfSanitize(state.novel).books.find(x=>x.id===novelBookId);
  novelChapters.forEach((c,i)=>{const b=document.createElement('button');b.type='button';b.textContent=c.title;if(cur&&cur.ch===i)b.className='on';b.onclick=()=>{toc.hidden=true;novelRenderChapter(i);};toc.append(b);});
  toc.hidden=false;
});

/* 医学生刷题：内置偏难重点题 + 外部题库导入（去重合并）+ 难度筛选 + 错题本。 */
let mqSession=null;
const MQ_CUSTOM_KEY='ember-medquiz-custom';
function mqLoadCustom(){try{const t=localStorage.getItem(MQ_CUSTOM_KEY);const a=t?JSON.parse(t):[];return Array.isArray(a)?a:[];}catch(e){return [];}}
function mqSaveCustom(list){try{localStorage.setItem(MQ_CUSTOM_KEY,JSON.stringify(list));return true;}catch(e){notify('本机存储放不下这么多题，先清理空间。');return false;}}
function mqBank(){return getBank(mqLoadCustom());}
function mqShowSetup(){$('mqSetup').hidden=false;$('mqRun').hidden=true;$('mqResult').hidden=true;}
/* 会话持久化：作答/翻页后写回 state 并随草稿保存，中断后可续刷。 */
function mqPersist(){state.mqSession=mqSessionSnapshot();scheduleSave();}
function mqClearSession(){mqSession=null;state.mqSession=null;scheduleSave();}
function renderMqSetup(){
  const sel=$('mqSubject');
  if(sel&&!sel.options.length){const all=document.createElement('option');all.value='全部';all.textContent='全部科目';sel.append(all);for(const s of QUIZ_SUBJECTS){const o=document.createElement('option');o.value=s;o.textContent=s;sel.append(o);}}
  if(sel)sel.value=state.medquiz.lastSubject||'全部';
  const md=$('mqMode');if(md)md.value=state.medquiz.lastMode||'order';
  const df=$('mqDifficulty');if(df)df.value=String(state.medquiz.lastDifficulty||0);
  const lm=$('mqLimit');if(lm)lm.value=String(state.medquiz.lastLimit==null?20:state.medquiz.lastLimit);
  const bank=mqBank();
  const st=$('mqStats');if(st)st.textContent='题库 '+bank.length+' 题 · 已答 '+state.medquiz.answered+' · 正确率 '+mqAccuracy(state.medquiz)+'% · 错题 '+Object.keys(state.medquiz.wrong).length+' · 收藏 '+Object.keys(state.medquiz.star).length;
  const imp=$('mqImportInfo');if(imp)imp.textContent='内置偏难重点题 + 你导入的 '+mqLoadCustom().length+' 题（自动去重）。';
  const resume=$('mqResume');
  if(resume){
    const saved=mqSanitizeSession(state.mqSession,bank);
    if(saved&&!saved.finished){resume.hidden=false;resume.textContent='继续上次刷题 · '+(saved.pos+1)+' / '+saved.ids.length;}
    else resume.hidden=true;
  }
  /* 分科正确率：按正确率升序，薄弱科目排前面，一眼看到该补哪科。 */
  const subBox=$('mqSubjects');
  if(subBox){
    subBox.replaceChildren();
    const bs=state.medquiz.bySubject||{};
    const rows=Object.keys(bs).map(k=>({s:k,a:bs[k].answered,r:bs[k].right,rate:bs[k].answered?Math.round(bs[k].right/bs[k].answered*100):0})).filter(x=>x.a>0).sort((a,b)=>a.rate-b.rate);
    if(!rows.length){const e=document.createElement('p');e.className='mq-subjects-empty';e.textContent='刷几道题，这里会显示各科正确率。';subBox.append(e);}
    for(const x of rows){
      const chip=document.createElement('button');chip.type='button';chip.className='mq-subchip'+(x.rate<60?' weak':'');
      chip.textContent=x.s+' '+x.rate+'%';
      chip.title=x.s+'：答 '+x.a+' 题，对 '+x.r+' 题';
      chip.onclick=()=>{const s2=$('mqSubject');if(s2){s2.value=x.s;renderMqSetup();}};
      subBox.append(chip);
    }
  }
}
function mqRenderQuestion(){
  const s=mqSession;if(!s)return;
  const bank=mqBank();
  const qid=s.ids[s.pos];const q=bank.find(x=>x.id===qid);
  if(!q){mqShowSetup();renderMqSetup();return;}
  const sess=mqSummary(s,bank);
  $('mqProgress').textContent=(s.pos+1)+' / '+s.ids.length+' · 对 '+sess.right+' 错 '+sess.wrong+(sess.skipped?' 跳 '+sess.skipped:'')+' · '+q.subject+' · '+(DIFF_LABELS[q.difficulty]||'')+(q.tag?' · '+q.tag:'');
  const barFill=$('mqBarFill');if(barFill)barFill.style.width=Math.round((s.pos+1)/s.ids.length*100)+'%';
  $('mqQuestion').textContent=q.q;
  const opts=$('mqOptions');opts.replaceChildren();
  const answered=s.answers[qid]!=null;
  const disp=displayOptions(s,q);
  /* 已选答案存的是原始下标，必须换算成展示下标再标红，
     否则答对时也会把别的选项误标红。 */
  const chosen=chosenDisplay(s,q);
  disp.options.forEach((opt,i)=>{
    const b=document.createElement('button');b.type='button';
    const k=document.createElement('span');k.className='k';k.textContent='ABCDEF'[i];
    const txt=document.createElement('span');txt.textContent=opt;
    b.append(k,txt);
    if(answered){
      b.disabled=true;
      if(i===disp.answer)b.classList.add('right');
      else if(i===chosen)b.classList.add('wrong');
    }
    else b.onclick=()=>mqAnswer(disp.perm[i]);
    opts.append(b);
  });
  const ex=$('mqExplain');
  if(answered){ex.hidden=false;ex.innerHTML='';const b=document.createElement('b');b.textContent=(s.answers[qid]===q.answer?'答对了 · ':'答错了 · ');ex.append(b,document.createTextNode(q.explain||'（无解析）'));}
  else ex.hidden=true;
  $('mqNext').hidden=!answered;
  $('mqNext').textContent=(s.pos+1>=s.ids.length)?'看结果':'下一题';
  const prevBtn=$('mqPrev');if(prevBtn)prevBtn.disabled=s.pos<=0;
  const skipBtn=$('mqSkip');if(skipBtn){skipBtn.hidden=answered;skipBtn.textContent=(s.pos+1>=s.ids.length)?'跳过并交卷 ›':'跳过这题 ›';}
  const starBtn=$('mqStar');
  if(starBtn){const on=!!state.medquiz.star[qid];starBtn.textContent=on?'★ 已收藏':'☆ 收藏';starBtn.setAttribute('aria-pressed',on?'true':'false');starBtn.classList.toggle('starred',on);}
  hudMark(document.querySelector('#medquizPanel'));
}
function mqAnswer(i){
  const s=mqSession;if(!s)return;
  const bank=mqBank();
  const qid=s.ids[s.pos];
  mqSession=mqAnswerFn(s,qid,i,bank);
  if(mqSession===s)return;
  state.medquiz=mqGrade(state.medquiz,qid,i,bank);
  const question=bank.find(q=>q.id===qid);
  if(question && i!==question.answer){
    const result=recordQuizMistake(state.mistakes,question,Date.now());
    state.mistakes=result.book;
    if(!result.ok)notify('错题本已满，这道题仍可在刷题的「错题重练」里找到。');
  }
  state.studyLog=logStudy(state.studyLog,todayStr(),'quiz');
  mqPersist();mqRenderQuestion();
}
on('mqStar',()=>{
  const s=mqSession;if(!s||!s.ids.length)return;
  const qid=s.ids[s.pos];
  state.medquiz=mqToggleStar(state.medquiz,qid);
  scheduleSave();
  const q=mqBank().find(x=>x.id===qid);
  const starBtn=$('mqStar');
  if(starBtn&&q){const on=!!state.medquiz.star[qid];starBtn.textContent=on?'★ 已收藏':'☆ 收藏';starBtn.setAttribute('aria-pressed',on?'true':'false');starBtn.classList.toggle('starred',on);}
});
on('mqResume',()=>{
  const saved=mqSanitizeSession(state.mqSession,mqBank());
  if(!saved||saved.finished){notify('没有可继续的刷题。');renderMqSetup();return;}
  mqSession=saved;
  $('mqSetup').hidden=true;$('mqResult').hidden=true;$('mqRun').hidden=false;
  mqRenderQuestion();
});
on('mqStart',()=>{
  const subject=$('mqSubject').value,mode=$('mqMode').value,diff=+($('mqDifficulty')?$('mqDifficulty').value:0);
  const limit=+($('mqLimit')?$('mqLimit').value:20);
  state.medquiz={...quizStatsSanitize(state.medquiz),lastSubject:subject,lastMode:mode,lastDifficulty:diff,lastLimit:limit};
  mqSession=mqBuild(state.medquiz,subject,mode,undefined,mqBank(),diff,limit);
  if(!mqSession.ids.length){notify(mode==='wrong'?'没有错题，先刷几道吧。':'这个筛选下暂时没有题。');return;}
  $('mqSetup').hidden=true;$('mqResult').hidden=true;$('mqRun').hidden=false;
  mqRenderQuestion();scheduleSave();
});
function mqShowResult(){
  mqPersist();
  $('mqRun').hidden=true;$('mqResult').hidden=false;
  const sum=mqSummary(mqSession,mqBank());
  const sc=$('mqScore');sc.innerHTML='';
  const b=document.createElement('b');b.textContent=sum.right+' / '+sum.total;
  let txt='答对 '+sum.right+' 题，答错 '+sum.wrong+' 题。';
  if(sum.skipped)txt+='跳过 '+sum.skipped+' 题（不计对错）。';
  if(sum.wrong){
    const recorded=new Set(state.mistakes.items.map(item=>item.quizId));
    const filed=mqWrongList(mqSession,mqBank()).filter(item=>recorded.has(item.id)).length;
    txt+='其中 '+filed+' 道已收进错题本。';
  }
  sc.append(b,document.createTextNode(txt));
  $('mqRetryWrong').hidden=sum.wrong===0;
  const wrong=mqWrongList(mqSession,mqBank());
  $('mqReview').hidden=!wrong.length;
  const rl=$('mqReviewList');rl.hidden=true;rl.replaceChildren();
}
on('mqNext',()=>{
  mqSession=mqNextFn(mqSession);
  if(mqSession.finished)mqShowResult();
  else{mqPersist();mqRenderQuestion();}
});
on('mqPrev',()=>{
  if(!mqSession||mqSession.pos<=0)return;
  mqSession=mqPrevFn(mqSession);
  mqPersist();mqRenderQuestion();
});
on('mqSkip',()=>{
  if(!mqSession||mqSession.finished)return;
  mqSession=mqSkipFn(mqSession);
  if(mqSession.finished)mqShowResult();
  else{mqPersist();mqRenderQuestion();}
});
on('mqQuit',()=>{mqPersist();mqShowSetup();renderMqSetup();});
on('mqBackSetup',()=>{mqClearSession();mqShowSetup();renderMqSetup();});
on('mqReview',()=>{
  const rl=$('mqReviewList');if(!rl)return;
  if(!rl.hidden){rl.hidden=true;return;}
  const wrong=mqWrongList(mqSession,mqBank());
  rl.replaceChildren();
  if(!wrong.length){rl.hidden=true;return;}
  for(const w of wrong){
    const card=document.createElement('div');card.className='mq-review-item';
    const head=document.createElement('p');head.className='mq-review-q';head.textContent=w.subject+' · '+w.q;
    const yours=document.createElement('p');yours.className='mq-review-wrong';yours.textContent='你选：'+'ABCDEF'[w.chosen]+'. '+w.options[w.chosen];
    const right=document.createElement('p');right.className='mq-review-right';right.textContent='正确：'+'ABCDEF'[w.answer]+'. '+w.options[w.answer];
    card.append(head,yours,right);
    if(w.explain){const ex=document.createElement('p');ex.className='mq-review-ex';ex.textContent=w.explain;card.append(ex);}
    rl.append(card);
  }
  rl.hidden=false;
});
on('mqRetryWrong',()=>{
  mqSession=mqBuild(state.medquiz,'全部','wrong',undefined,mqBank(),0);
  if(!mqSession.ids.length){mqShowSetup();renderMqSetup();return;}
  $('mqResult').hidden=true;$('mqRun').hidden=false;mqRenderQuestion();
});
on('mqImportBtn',()=>$('mqImportFile').click());
{const f=$('mqImportFile');if(f)f.addEventListener('change',async()=>{
  const file=f.files&&f.files[0];f.value='';if(!file)return;
  if(file.size>20*1024*1024){notify('文件太大（>20MB）。');return;}
  let text='';try{text=await file.text();}catch(e){notify('读不了这个文件。');return;}
  const {list,errors}=parseBankText(text);
  if(!list.length){notify('没解析出有效题目，需 JSON/JSONL，含 q/options/answer。');return;}
  const custom=mqLoadCustom();
  const merged=getBank(custom.concat(list)); // 去重
  const added=merged.length-getBank(custom).length;
  if(!mqSaveCustom(custom.concat(list)))return;
  renderMqSetup();
  notify('导入 '+list.length+' 条，去重后新增 '+added+' 题，现共 '+merged.length+' 题。'+(errors.length?'（'+errors.length+' 条格式不对已跳过）':''));
});}
on('mqClearCustom',()=>{
  if(!confirm('清空你导入的全部题目？内置题不受影响。'))return;
  try{localStorage.removeItem(MQ_CUSTOM_KEY);}catch(e){}
  renderMqSetup();notify('已清空导入题库。');
});
/* 键盘快捷作答：1-6/A-F 选项，Enter/→ 下一题（未答则跳过），← 上题，S 收藏。仅在刷题作答页生效。 */
document.addEventListener('keydown',e=>{
  if(workspaceMode!=='medquiz')return;
  const run=$('mqRun');if(!run||run.hidden)return;
  const s=mqSession;if(!s||!s.ids.length)return;
  const tag=(e.target&&e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select'||e.ctrlKey||e.metaKey||e.altKey)return;
  const qid=s.ids[s.pos];const q=mqBank().find(x=>x.id===qid);if(!q)return;
  const answered=s.answers[qid]!=null;
  const disp=displayOptions(s,q);
  const k=e.key;
  if(!answered&&/^[1-6]$/.test(k)){const i=+k-1;if(i<disp.options.length){e.preventDefault();mqAnswer(disp.perm[i]);}return;}
  if(!answered&&/^[a-fA-F]$/.test(k)){const i=k.toLowerCase().charCodeAt(0)-97;if(i<disp.options.length){e.preventDefault();mqAnswer(disp.perm[i]);}return;}
  if(k==='ArrowLeft'){e.preventDefault();$('mqPrev').click();return;}
  if(k==='Enter'||k==='ArrowRight'){e.preventDefault();(answered?$('mqNext'):$('mqSkip')).click();return;}
  if(k==='s'||k==='S'){e.preventDefault();$('mqStar').click();}
});

/* 任务 DDL：加任务 + 倒数天数 + 里程碑勾选 + 编辑。 */
let examEditId=null;
function examCloseForm(){const f=$('examForm');if(f)f.hidden=true;examEditId=null;const sb=$('examSave');if(sb)sb.textContent='保存';}
function examOpenForm(ex){
  const f=$('examForm');if(!f)return;
  f.hidden=false;
  examEditId=ex?ex.id:null;
  $('examName').value=ex?ex.name:'';
  $('examDate').value=ex?ex.date:'';
  const q=$('examDateQuick');if(q)for(const x of q.children)x.classList.remove('on');
  const sb=$('examSave');if(sb)sb.textContent=ex?'保存修改':'保存';
  $('examName').focus();
}
function renderExams(){
  const list=$('examList');if(!list)return;
  const now=Date.now();
  const exams=sortExams(state.exams,now);
  const stats=$('examStats');
  if(stats){
    if(!exams.length)stats.textContent='';
    else{
      const soon=exams.filter(e=>{const d=daysUntil(e.date,now);return d>=0&&d<=7;}).length;
      const over=exams.filter(e=>daysUntil(e.date,now)<0).length;
      stats.textContent='共 '+exams.length+' 个任务 · 7 天内 '+soon+' · 已过期 '+over;
    }
  }
  list.replaceChildren();
  if(!exams.length){list.append(emptyState('⏳','还没有任务','作业、考试、报告，排个截止日心里有数。',{label:'加第一个任务',onClick:()=>examOpenForm(null)}));return;}
  for(const ex of exams){
    const d=daysUntil(ex.date,now);
    const card=document.createElement('div');card.className='exam-card'+(d<0?' past':'');
    const top=document.createElement('div');top.className='exam-top';
    const days=document.createElement('span');days.className='exam-days';
    const db=document.createElement('b');db.textContent=d>0?d:(d===0?'0':-d);
    const ds=document.createElement('small');ds.textContent=d>0?'天后':(d===0?'今天':'天前');
    days.append(db,ds);
    const info=document.createElement('span');info.className='exam-info';
    const nb=document.createElement('b');nb.textContent=ex.name;
    const meta=document.createElement('small');meta.textContent=ex.date+' · '+countdownText(ex,now);
    info.append(nb,meta);
    const edit=document.createElement('button');edit.type='button';edit.className='exam-edit';edit.textContent='改';
    edit.onclick=()=>examOpenForm(ex);
    const del=document.createElement('button');del.type='button';del.className='exam-del';del.textContent='删';
    del.onclick=()=>{
      const removed=ex;
      state.exams=removeExam(state.exams,ex.id);renderExams();scheduleSave();
      notifyUndo('已删除任务「'+removed.name.slice(0,12)+'」',()=>{
        const s=examsSanitize(state.exams);
        if(s.exams.some(x=>x.id===removed.id))return;
        state.exams={nextId:Math.max(s.nextId,removed.id+1),exams:[...s.exams,removed]};
        renderExams();scheduleSave();notify('任务已恢复，里程碑保留。');
      });
    };
    top.append(days,info,edit,del);card.append(top);
    const prog=examProgress(ex);
    if(prog.total){
      const bar=document.createElement('div');bar.className='exam-progress';
      const fill=document.createElement('i');fill.style.width=prog.pct+'%';bar.append(fill);card.append(bar);
    }
    const ms=document.createElement('div');ms.className='exam-ms';
    for(const m of ex.milestones){
      const lab=document.createElement('label');lab.className=m.done?'done':'';
      const cb=document.createElement('input');cb.type='checkbox';cb.checked=m.done;
      cb.onchange=()=>{state.exams=toggleMilestone(state.exams,ex.id,m.id);renderExams();scheduleSave();};
      const sp=document.createElement('span');sp.textContent=m.label;
      const md=document.createElement('button');md.type='button';md.className='ms-del';md.textContent='✕';
      md.onclick=()=>{state.exams=removeMilestone(state.exams,ex.id,m.id);renderExams();scheduleSave();};
      lab.append(cb,sp,md);ms.append(lab);
    }
    const add=document.createElement('div');add.className='exam-ms-add';
    const inp=document.createElement('input');inp.type='text';inp.maxLength=60;inp.placeholder='复习里程碑（如：一轮复习）';
    const ab=document.createElement('button');ab.type='button';ab.textContent='＋';
    const doAdd=()=>{const r=addMilestone(state.exams,ex.id,inp.value);if(r.ok){state.exams=r.store;renderExams();scheduleSave();}};
    ab.onclick=doAdd;
    inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();doAdd();}});
    add.append(inp,ab);ms.append(add);
    card.append(ms);
    list.append(card);
  }
  hudMark(document.querySelector('#examsPanel'));
}
on('examAddToggle',()=>{const f=$('examForm');if(f&&!f.hidden){examCloseForm();}else{examOpenForm(null);}});
on('examCancel',()=>examCloseForm());
/* 日期快捷：今天/明天/3天/1周/1月，点一下填好日期。 */
{const q=$('examDateQuick');if(q)q.addEventListener('click',e=>{
  const b=e.target.closest('button[data-days]');if(!b)return;
  const d=new Date();d.setDate(d.getDate()+(+b.dataset.days||0));
  const p=x=>String(x).padStart(2,'0');
  $('examDate').value=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
  for(const x of q.children)x.classList.toggle('on',x===b);
});}
on('examSave',()=>{
  const name=$('examName').value,date=$('examDate').value;
  const r=examEditId!=null?updateExam(state.exams,examEditId,name,date):addExam(state.exams,name,date);
  if(!r.ok){notify(r.dup?'这个任务已经排过了。':'填好任务名和日期。');return;}
  state.exams=r.store;examCloseForm();renderExams();scheduleSave();
});

/* 临床计算：选择公式 + 输入即算 + 参考判读。 */
let mcCurrent=null,mcVals={};
function mcBuildChips(){
  const box=$('mcChips');if(!box||box.children.length)return;
  for(const c of CALCULATORS){
    const b=document.createElement('button');b.type='button';b.textContent=c.name;b.dataset.id=c.id;
    b.onclick=()=>mcSelect(c.id);
    box.append(b);
  }
}
function mcSelect(id){
  const c=calcById(id);if(!c)return;
  mcCurrent=id;mcVals={};
  mcBuildChips();
  for(const b of $('mcChips').children)b.classList.toggle('on',b.dataset.id===id);
  $('mcName').textContent=c.name;
  $('mcDesc').textContent=c.desc;
  $('mcFormula').textContent=c.formula;
  const box=$('mcInputs');box.replaceChildren();
  for(const inp of c.inputs){
    const lab=document.createElement('label');
    const lt=document.createElement('span');lt.className='lab';lt.textContent=inp.label;
    let field;
    if(inp.key==='female'){
      field=document.createElement('input');field.type='checkbox';field.checked=false;
      field.onchange=()=>{mcVals[inp.key]=field.checked?1:0;mcUpdate();};
    }else{
      field=document.createElement('input');field.type='number';field.step=inp.step;field.min=inp.min;field.max=inp.max;field.value=inp.def;field.inputMode='decimal';
      mcVals[inp.key]=inp.def;
      field.oninput=()=>{mcVals[inp.key]=field.value;mcUpdate();};
    }
    const u=document.createElement('span');u.className='u';u.textContent=inp.unit||'';
    lab.append(lt,field,u);box.append(lab);
  }
  mcUpdate();
}
function mcUpdate(){
  const c=calcById(mcCurrent);if(!c)return;
  const r=runCalc(mcCurrent,mcVals);
  const res=$('mcResult');
  if(!r){res.hidden=true;return;}
  res.hidden=false;
  $('mcValue').textContent=r.rounded;
  $('mcUnit').textContent=r.unit;
  const lab=$('mcLabel');lab.textContent=r.label;lab.className='mc-label '+r.tone;
}
on('mcCopy',()=>{
  const c=calcById(mcCurrent);if(!c)return;
  const r=runCalc(mcCurrent,mcVals);if(!r){notify('先填好输入再复制。');return;}
  const txt=c.name+'：'+r.rounded+' '+r.unit+'（'+r.label+'）';
  const done=()=>notify('已复制：'+txt);
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done).catch(()=>fallbackCopy(txt,done));}
  else fallbackCopy(txt,done);
});
function fallbackCopy(txt,done){
  const ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';
  document.body.append(ta);ta.select();
  try{document.execCommand('copy');done();}catch(e){notify('复制失败，请手动选择结果。');}
  ta.remove();
}

/* 潮声 · 白噪音景：混音台 + 预设 + 睡眠定时 + 粒子画布。 */
let ssAudio=null,ssVisual=null,ssTimerInt=0,ssBuilt=false;
function ssState(){return state.soundscape||(state.soundscape=defaultSoundscape());}
function ssEnsureAudio(){if(!ssAudio)ssAudio=createSoundscapeAudio();return ssAudio;}
function ssBuildUI(){
  if(ssBuilt)return;ssBuilt=true;
  const pr=$('ssPresets');
  for(const p of PRESETS){
    const b=document.createElement('button');b.type='button';b.textContent=p.icon+' '+p.name;b.dataset.id=p.id;
    b.onclick=()=>{state.soundscape=applyPreset(ssState(),p.id);ssSync();scheduleSave();};
    pr.append(b);
  }
  const ly=$('ssLayers');
  for(const l of LAYERS){
    const row=document.createElement('div');row.className='ss-layer';row.dataset.id=l.id;
    const ic=document.createElement('span');ic.className='ic';ic.textContent=l.icon;
    const nm=document.createElement('span');nm.className='nm';nm.textContent=l.name;
    const rg=document.createElement('input');rg.type='range';rg.min=0;rg.max=100;rg.value=50;
    rg.oninput=()=>{state.soundscape=setLayer(ssState(),l.id,undefined,+rg.value/100);ssSync();scheduleSave();};
    const tg=document.createElement('button');tg.type='button';tg.className='tg';tg.textContent='关';
    tg.onclick=()=>{const cur=ssState().layers[l.id].on;state.soundscape=setLayer(ssState(),l.id,!cur);ssSync();scheduleSave();};
    row.append(ic,nm,rg,tg);ly.append(row);
  }
  const ms=$('ssMaster');
  ms.oninput=()=>{state.soundscape=setMaster(ssState(),+ms.value/100);ssSync();scheduleSave();};
  for(const b of document.querySelectorAll('.ss-timer button')){
    b.onclick=()=>{const m=+b.dataset.min;state.soundscape=m>0?startTimer(ssState(),m,Date.now()):clearTimer(ssState());ssSync();scheduleSave();};
  }
}
function ssSync(){
  const s=ssState();
  ssBuildUI();
  for(const b of $('ssPresets').children)b.classList.toggle('on',b.dataset.id===s.preset);
  for(const row of $('ssLayers').children){
    const id=row.dataset.id;const L=s.layers[id];
    row.classList.toggle('on',L.on);
    row.querySelector('input').value=Math.round(L.vol*100);
    row.querySelector('.tg').textContent=L.on?'开':'关';
  }
  $('ssMaster').value=Math.round(s.master*100);
  const act=activeLayers(s);
  const names=LAYERS.filter(l=>s.layers[l.id].on).map(l=>l.name);
  $('ssNow').textContent=names.length?('正在播放 · '+names.join(' + ')):'点一个声音开始';
  if(ssVisual)ssVisual.setActive(act);
  /* 音频同步 */
  const a=ssEnsureAudio();
  if(act.length){
    if(!a.ensure()){notify('当前环境不支持音频合成。');}
    else{
      a.resume();
      for(const id of act){const L=s.layers[id];a.startLayer(id,L.vol);a.setLayerVol(id,L.vol);}
      for(const l of LAYERS)if(!s.layers[l.id].on)a.stopLayer(l.id);
      a.setMaster(s.master);
    }
  }else{a.stopAll();}
  ssTickTimer();
}
function ssTickTimer(){
  const s=ssState();
  const rem=timerRemaining(s,Date.now());
  const el=$('ssRemain');
  if(rem>0){
    const m=Math.floor(rem/60),sec=rem%60;
    el.textContent=m+':'+String(sec).padStart(2,'0');
    if(ssAudio)ssAudio.setFade(fadeGain(rem));
  }else{
    el.textContent='';
    if(s.timerEnd){ /* 定时到：停全部 */
      state.soundscape=clearTimer(s);
      for(const id of LAYER_IDS_ON())state.soundscape=setLayer(state.soundscape,id,false);
      if(ssAudio)ssAudio.stopAll();
      ssSync();scheduleSave();
    }else if(ssAudio)ssAudio.setFade(1);
  }
}
function LAYER_IDS_ON(){return LAYERS.map(l=>l.id);}
function ssEnter(){
  ssBuildUI();
  const cv=$('ssCanvas');
  if(cv&&!ssVisual)ssVisual=createSoundscapeVisual(cv);
  if(ssVisual)ssVisual.start();
  ssSync();
  if(!ssTimerInt)ssTimerInt=setInterval(ssTickTimer,1000);
}
function ssStop(){
  if(ssAudio)ssAudio.stopAll();
  if(ssVisual)ssVisual.stop();
  if(ssTimerInt){clearInterval(ssTimerInt);ssTimerInt=0;}
}
/* 切后台/锁屏自动停声音与画布，避免后台偷跑耗电。 */
document.addEventListener('visibilitychange',()=>{if(document.hidden&&workspaceMode==='soundscape')ssStop();});

/* 数据备份/恢复：导出全部草稿+学习记录+小说+导入题库为一个 JSON。 */
function collectNovels(){
  const out={};
  const shelf=shelfSanitize(state.novel);
  for(const b of shelf.books){try{const t=localStorage.getItem(novelTextKey(b.id));if(t)out[novelTextKey(b.id)]=t;}catch(e){}}
  return out;
}
function downloadText(name,text,mime){
  /* CSV 加 BOM，Excel 打开中文不乱码 */
  const type=mime||'application/json';
  const parts=/csv/i.test(type)?['\uFEFF',text]:[text];
  const blob=new Blob(parts,{type:type+';charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
on('backupExport',()=>{
  flush();
  const data=buildBackup(snapshot(),{novels:collectNovels(),medquizCustom:mqLoadCustom()},Date.now());
  const d=new Date();const p=x=>String(x).padStart(2,'0');
  downloadText('tiangong-backup-'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'.json',JSON.stringify(data));
  notify('备份已导出到下载目录。');
});
on('backupImport',()=>$('backupFile').click());
{const f=$('backupFile');if(f)f.addEventListener('change',async()=>{
  const file=f.files&&f.files[0];f.value='';if(!file)return;
  let text='';try{text=await file.text();}catch(e){notify('读不了这个文件。');return;}
  const parsed=parseBackup(text);
  if(!parsed){notify('不是有效的天工备份文件。');return;}
  const s=backupSummary(parsed);
  if(!confirm('导入将覆盖当前全部草稿与学习记录。\n备份含：'+s.files+' 个文件、'+s.cards+' 卡片、'+s.mistakes+' 错题、'+s.habits+' 习惯、'+s.courses+' 课程、'+s.exams+' 任务、'+s.novels+' 小说、'+s.customQuiz+' 导入题。\n确定恢复？'))return;
  try{
    loadState(parsed.snapshot);
    for(const [k,v] of Object.entries(parsed.novels)){try{localStorage.setItem(k,v);}catch(e){}}
    try{localStorage.setItem(MQ_CUSTOM_KEY,JSON.stringify(parsed.medquizCustom));}catch(e){}
    ready=true;renderFiles();openTab(state.active);applySettings();
    $('settingsDialog').close();
    flush();openLanding(true);
    notify('备份已恢复。');
  }catch(e){notify('恢复失败：'+(e.message||e));}
});}

/* 驾驶舱一键直达：切到模块并按建议参数自动开始（复习/刷题/专注）。 */
function runPlanAction(p){
  if(!p||!p.mode)return;
  if(landingOpen){
    enterHomeMode(p.mode);
    if(landingOpen)return;
  }else if(!applyMode(p.mode))return;
  selectedMode=p.mode;
  const a=(p.params||{}).auto;
  setTimeout(()=>{
    if(landingOpen||workspaceMode!==p.mode)return;
    if(a==='review'){const b=$('cardsStart');if(b)b.click();}
    else if(a==='quiz'){
      if(p.params.subject){const s=$('mqSubject');if(s)s.value=p.params.subject;}
      const b=$('mqStart');if(b)b.click();
    }
    else if(a==='focus'){if(!(state.focus&&state.focus.running)){const b=$('focusStart');if(b)b.click();}}
  },80);
}
/* 学科雷达：SVG 同心环+辐条+正确率多边形+旋转扫描线，顶点标签可点直达。 */
function renderRadar(data){
  const wrap=$('ovRadar');if(!wrap)return;
  wrap.replaceChildren();
  if(!data.length)return;
  const NS='http://www.w3.org/2000/svg';
  const S=260,cx=S/2,cy=S/2,R=92;
  const svg=document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox','0 0 '+S+' '+S);svg.setAttribute('class','radar-svg');
  const pts=radarPoints(data,cx,cy,R);
  for(const f of [.25,.5,.75,1]){
    const ring=document.createElementNS(NS,'polygon');
    ring.setAttribute('points',radarPolygon(data.map((d,i)=>{const ang=-Math.PI/2+i*2*Math.PI/data.length;return {x:+(cx+R*f*Math.cos(ang)).toFixed(2),y:+(cy+R*f*Math.sin(ang)).toFixed(2)};})));
    ring.setAttribute('class','radar-ring');svg.append(ring);
  }
  for(const p of pts){const l=document.createElementNS(NS,'line');l.setAttribute('x1',cx);l.setAttribute('y1',cy);l.setAttribute('x2',p.lx);l.setAttribute('y2',p.ly);l.setAttribute('class','radar-spoke');svg.append(l);}
  const sweep=document.createElementNS(NS,'g');sweep.setAttribute('class','radar-sweep');
  const sl=document.createElementNS(NS,'line');sl.setAttribute('x1',cx);sl.setAttribute('y1',cy);sl.setAttribute('x2',cx);sl.setAttribute('y2',cy-R);sl.setAttribute('class','radar-sweepline');
  sweep.append(sl);svg.append(sweep);
  const poly=document.createElementNS(NS,'polygon');poly.setAttribute('points',radarPolygon(pts));poly.setAttribute('class','radar-poly');svg.append(poly);
  for(const p of pts){
    const dot=document.createElementNS(NS,'circle');dot.setAttribute('cx',p.x);dot.setAttribute('cy',p.y);dot.setAttribute('r',3);dot.setAttribute('class','radar-dot'+(p.hasData?'':' nodata'));svg.append(dot);
    const ang=Math.atan2(p.ly-cy,p.lx-cx);
    const tx=cx+(R+16)*Math.cos(ang),ty=cy+(R+16)*Math.sin(ang);
    const t=document.createElementNS(NS,'text');t.setAttribute('x',tx);t.setAttribute('y',ty);
    t.setAttribute('class','radar-label'+(p.hasData?'':' nodata'));
    t.setAttribute('text-anchor',Math.abs(Math.cos(ang))<.3?'middle':(Math.cos(ang)>0?'start':'end'));
    t.setAttribute('dominant-baseline','middle');
    t.textContent=p.subject+(p.hasData?' '+p.rate+'%':'');
    t.addEventListener('click',()=>{runPlanAction({mode:'medquiz',params:{auto:'quiz',subject:p.subject}});});
    svg.append(t);
  }
  wrap.append(svg);
}
/* 学习总览：汇总各模块真实数据，点卡片直达对应模块。 */
function ovTask(label,value,mode,zero){
  const b=document.createElement('button');
  b.type='button';b.className='ov-task'+(zero?' zero':'');
  const n=document.createElement('b');n.textContent=String(value);
  const s=document.createElement('small');s.textContent=label;
  b.append(n,s);
  b.onclick=()=>{if(applyMode(mode))selectedMode=mode;};
  return b;
}
function renderOverview(){
  const panel=$('overviewPanel');if(!panel)return;
  const sum=buildOverview(state,Date.now());
  const st=$('ovStreak');if(st)st.textContent=String(sum.streak);
  const line=$('ovLine');if(line)line.textContent=sum.line;
  /* 今日驾驶舱：可解释建议，一键直达并自动开始。 */
  const pl=$('ovPlanList');
  if(pl){
    pl.replaceChildren();
    (sum.plan||[]).forEach((p,i)=>{
      const row=document.createElement('div');row.className='cockpit-item';
      const ic=document.createElement('span');ic.className='ci-icon';ic.textContent=p.icon;
      const copy=document.createElement('div');copy.className='ci-copy';
      const t=document.createElement('b');t.textContent=p.title;
      const r=document.createElement('small');r.textContent=p.reason;
      copy.append(t,r);
      const go=document.createElement('button');go.type='button';go.className='ci-go';go.textContent=p.cta;
      go.onclick=()=>runPlanAction(p);
      row.append(ic,copy,go);pl.append(row);
    });
  }
  /* 今日复盘 */
  const rc=sum.recap;
  const rt=$('ovRecapTone'),rl=$('ovRecapLine'),rn=$('ovRecapNext');
  if(rc){
    if(rt)rt.textContent=rc.tone==='good'?'状态良好':rc.tone==='light'?'稳步前进':'待启动';
    if(rl)rl.textContent=rc.headline+' · 专注 '+rc.done.focus+' / 卡片 '+rc.done.cards+' / 刷题 '+rc.done.quiz+' / 打卡 '+rc.done.checks+' · 连续 '+rc.streak+' 天';
    if(rn){rn.replaceChildren();
      if(rc.next){const s=document.createElement('span');s.textContent='明天先做：'+rc.next.title;
        const b=document.createElement('button');b.type='button';b.textContent=rc.next.cta;b.onclick=()=>runPlanAction(rc.next);
        rn.append(s,b);}
    }
  }
  /* 今日学习四宫格：专注/卡片/刷题/打卡，点一下跳到对应模块。 */
  const today=$('ovToday');
  if(today){
    today.replaceChildren();
    const ts=sum.todayStudy||{focus:0,cards:0,quiz:0,checks:0};
    const cells=[['🍅','专注',ts.focus,'focus'],['🗂','卡片',ts.cards,'cards'],['✍️','刷题',ts.quiz,'medquiz'],['🌱','打卡',ts.checks,'habits']];
    for(const [icon,label,n,mode] of cells){
      const c=document.createElement('button');c.type='button';c.className='ov-today-cell'+(n?'':' zero');
      const b=document.createElement('b');b.textContent=String(n);
      const s=document.createElement('small');s.textContent=icon+' '+label;
      c.append(b,s);c.title='今日'+label+' '+n+' 次，点击进入';
      c.onclick=()=>{if(applyMode(mode))selectedMode=mode;};
      today.append(c);
    }
  }
  const tasks=$('ovTasks');
  if(tasks){
    tasks.replaceChildren(
      ovTask('张卡片到期',sum.tasks.cardsDue,'cards',sum.tasks.cardsDue===0),
      ovTask('个习惯待打卡',sum.tasks.habitsLeft,'habits',sum.tasks.habitsLeft===0),
      ovTask('道错题没吃透',sum.tasks.mistakesOpen,'mistakes',sum.tasks.mistakesOpen===0),
      ovTask('节今日课程',sum.tasks.coursesToday,'schedule',sum.tasks.coursesToday===0)
    );
  }
  const wt=$('ovWeekTotal');if(wt)wt.textContent='共 '+sum.weekTotal+' 次';
  const chart=$('ovChart');
  if(chart){
    chart.replaceChildren();
    const max=Math.max(1,...sum.week.map(d=>d.total));
    const today=sum.today;
    for(const d of sum.week){
      const col=document.createElement('div');
      col.className='col'+(d.total?'':' empty')+(d.date===today?' today':'');
      const stack=document.createElement('div');stack.className='stack';
      if(d.total){
        /* 列向 flex：先 append 的在上。图例顺序是「专注段 → 打卡」，
           所以专注在上、打卡在下，图例与图形必须一致。 */
        if(d.focus){const i=document.createElement('i');i.className='f';i.style.height=Math.round(d.focus/max*68)+'px';stack.append(i);}
        if(d.checks){const i=document.createElement('i');i.className='c';i.style.height=Math.round(d.checks/max*68)+'px';stack.append(i);}
      }
      const vv=document.createElement('span');vv.className='vv';vv.textContent=d.total?String(d.total):'';
      const lb=document.createElement('b');lb.textContent=d.date.slice(8);
      col.title=d.date+'：专注 '+d.focus+' 段 · 打卡 '+d.checks+' 次';
      col.append(vv,stack,lb);chart.append(col);
    }
  }
  /* 近 28 天学习热力图：4 行 × 7 列，颜色深浅按当日总动作数。 */
  const heat=$('ovHeat');
  if(heat){
    heat.replaceChildren();
    const max=Math.max(1,...(sum.heat||[]).map(d=>d.total));
    for(const d of (sum.heat||[])){
      const cell=document.createElement('button');cell.type='button';
      const lv=d.total===0?0:d.total<=max*.34?1:d.total<=max*.67?2:3;
      cell.className='hcell l'+lv+(d.date===sum.today?' today':'');
      const detail=d.date.slice(5)+'：专注 '+d.focus+' · 卡片 '+d.cards+' · 刷题 '+d.quiz+' · 打卡 '+d.checks;
      cell.title=detail;cell.setAttribute('aria-label',detail);
      /* 触屏没有悬停：点按格子用 toast 显示当日明细。 */
      cell.onclick=()=>notify(detail);
      heat.append(cell);
    }
  }
  /* 本周学习周报：四类计数 + 环比上周。 */
  const rep=$('ovReport'),rd=$('ovReportDelta');
  if(rep){
    rep.replaceChildren();
    const r=sum.report||{cur:{focus:0,cards:0,quiz:0,checks:0,total:0},delta:{total:0},pct:null,activeDays:0};
    const cells=[['🍅','专注',r.cur.focus,'focus'],['🗂','卡片',r.cur.cards,'cards'],['✍️','刷题',r.cur.quiz,'medquiz'],['🌱','打卡',r.cur.checks,'habits']];
    for(const [icon,label,n,mode] of cells){
      const c=document.createElement('button');c.type='button';c.className='ov-report-cell';
      const b=document.createElement('b');b.textContent=String(n);
      const s=document.createElement('small');s.textContent=icon+' '+label;
      c.title='本周'+label+' '+n+' 次，点击进入';
      c.onclick=()=>{if(applyMode(mode))selectedMode=mode;};
      c.append(b,s);rep.append(c);
    }
    const foot=document.createElement('p');foot.className='ov-report-foot';
    foot.textContent='本周共 '+r.cur.total+' 次 · 活跃 '+r.activeDays+' 天';
    rep.append(foot);
    if(rd){
      if(r.pct==null)rd.textContent=r.cur.total>0?'上周无记录':'';
      else rd.textContent=(r.delta.total>=0?'↑ 比上周 +'+r.pct+'%':'↓ 比上周 '+r.pct+'%');
      rd.className=r.delta.total>=0?'up':'down';
    }
  }
  /* 学科雷达：星舰扫描图，顶点=各科正确率，点科目直达刷题。 */
  renderRadar(sum.radar||[]);
  const subs=$('ovSubjects');
  const sm=$('ovSubMeta');
  if(subs){
    subs.replaceChildren();
    if(!sum.subjects.length){
      const e=document.createElement('p');e.className='ov-empty';e.textContent='错题本还没有记录，记几道就有掌握度了。';subs.append(e);
      if(sm)sm.textContent='';
    }else{
      if(sm)sm.textContent=sum.mistakes.mastered+' / '+sum.mistakes.total+' 已掌握';
      for(const s of sum.subjects.slice(0,8)){
        const row=document.createElement('div');row.className='ov-sub';
        const nm=document.createElement('span');nm.className='nm';nm.textContent=s.subject;
        const bar=document.createElement('span');bar.className='bar';
        const fill=document.createElement('i');fill.style.width=s.rate+'%';bar.append(fill);
        const pc=document.createElement('span');pc.className='pc';pc.textContent=s.mastered+'/'+s.total+' · '+s.rate+'%';
        row.append(nm,bar,pc);subs.append(row);
      }
    }
  }
  const ex=$('ovExams');
  if(ex){
    ex.replaceChildren();
    if(!sum.exams.length){
      const e=document.createElement('p');e.className='ov-empty';e.textContent='没有临近的任务，去「任务 DDL」排一个截止日。';ex.append(e);
    }else{
      for(const e of sum.exams){
        const b=document.createElement('button');b.type='button';b.className='ov-exam';
        const dd=document.createElement('span');dd.className='dd';
        const db=document.createElement('b');db.textContent=String(e.days);
        const ds=document.createElement('small');ds.textContent='天后';
        dd.append(db,ds);
        const info=document.createElement('span');info.className='info';
        const nb=document.createElement('b');nb.textContent=e.name;
        const meta=document.createElement('small');
        meta.textContent=e.date+(e.total?(' · 里程碑 '+e.done+'/'+e.total):'');
        info.append(nb,meta);
        b.append(dd,info);
        b.onclick=()=>{if(applyMode('exams'))selectedMode='exams';};
        ex.append(b);
      }
    }
  }
  const stats=$('ovStats');
  if(stats){
    stats.replaceChildren();
    const items=[
      ['记忆卡片 · 已学',sum.cards.total?(sum.cards.learned+' / '+sum.cards.total):'0 张','cards'],
      ['刷题正确率',sum.quiz.answered?(sum.quiz.accuracy+'%'):'—','medquiz'],
      ['错题本 · 掌握',sum.mistakes.total?(sum.mistakes.rate+'%'):'—','mistakes'],
      ['习惯 · 今日',sum.tasks.habitsTotal?(sum.tasks.habitsDone+' / '+sum.tasks.habitsTotal):'0 个','habits']
    ];
    for(const [label,value,mode] of items){
      const b=document.createElement('button');b.type='button';b.className='ov-stat';
      const vb=document.createElement('b');vb.textContent=value;
      const ls=document.createElement('small');ls.textContent=label;
      b.append(vb,ls);
      b.onclick=()=>{if(applyMode(mode))selectedMode=mode;};
      stats.append(b);
    }
  }
  hudMark(panel);
}

/* 批量导入 / 导出：卡片与错题共用一套交互，导入去重、导出可原样导回。 */
function ioReport(id,res,extra){
  const el=$(id);if(!el)return;
  const msg=importSummary(res)+(extra||'');
  el.textContent=msg;
  el.className='io-result '+(res.added>0?(res.errors&&res.errors.length?'warn':'ok'):(res.parsed?'warn':'bad'));
  if(res.errors&&res.errors.length)el.textContent=msg+'：'+res.errors.slice(0,2).join('；');
}
function ioReadFile(input,onText){
  const f=input.files&&input.files[0];input.value='';
  if(!f)return;
  if(f.size>4*1024*1024){notify('文件太大（>4MB），拆分后再导入。');return;}
  f.text().then(onText).catch(()=>notify('读不了这个文件。'));
}
function stampName(prefix,ext){
  const d=new Date(),p=x=>String(x).padStart(2,'0');
  return prefix+'-'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'.'+ext;
}
on('cardsIOInfo',()=>{const h=$('cardsIOHint');if(h)h.hidden=!h.hidden;});
on('mistIOInfo',()=>{const h=$('mistIOHint');if(h)h.hidden=!h.hidden;});
on('cardsImportText',()=>{
  const t=$('cardsIOText').value;
  if(!t.trim()){notify('先把内容粘进文本框，或点「选择文件」。');return;}
  const res=importCards(state.cards,t,Date.now());
  state.cards=res.deck;cardsResetReview();renderCards();scheduleSave();
  ioReport('cardsIOResult',res);
  if(res.added){$('cardsIOText').value='';notify('导入 '+res.added+' 张卡片。');}
});
on('cardsImportFile',()=>$('cardsFile').click());
{const inp=$('cardsFile');if(inp)inp.addEventListener('change',()=>ioReadFile(inp,t=>{
  const res=importCards(state.cards,t,Date.now());
  state.cards=res.deck;cardsResetReview();renderCards();scheduleSave();
  ioReport('cardsIOResult',res);
  if(res.added)notify('从文件导入 '+res.added+' 张卡片。');
}));}
on('cardsExport',()=>{
  const d=deckSanitize(state.cards);
  if(!d.cards.length){notify('还没有卡片可导出。');return;}
  downloadText(stampName('tiangong-cards','csv'),exportCards(d),'text/csv');
  const el=$('cardsIOResult');if(el){el.className='io-result ok';el.textContent='已导出 '+d.cards.length+' 张（含复习进度）到下载目录。';}
});
on('mistImportText',()=>{
  const t=$('mistIOText').value;
  if(!t.trim()){notify('先把内容粘进文本框，或点「选择文件」。');return;}
  const res=importMistakes(state.mistakes,t,Date.now());
  state.mistakes=res.book;renderMistakes();scheduleSave();
  ioReport('mistIOResult',res);
  if(res.added){$('mistIOText').value='';notify('导入 '+res.added+' 道错题。');}
});
on('mistImportFile',()=>$('mistFile').click());
{const inp=$('mistFile');if(inp)inp.addEventListener('change',()=>ioReadFile(inp,t=>{
  const res=importMistakes(state.mistakes,t,Date.now());
  state.mistakes=res.book;renderMistakes();scheduleSave();
  ioReport('mistIOResult',res);
  if(res.added)notify('从文件导入 '+res.added+' 道错题。');
}));}
on('mistExport',()=>{
  const b=bookSanitize(state.mistakes);
  if(!b.items.length){notify('还没有错题可导出。');return;}
  downloadText(stampName('tiangong-mistakes','csv'),exportMistakes(b),'text/csv');
  const el=$('mistIOResult');if(el){el.className='io-result ok';el.textContent='已导出 '+b.items.length+' 道到下载目录。';}
});
/* 导入区支持拖放文件：拖入高亮，落下即解析导入。 */
function bindDrop(boxId,handler){
  const box=$(boxId);if(!box)return;
  const over=e=>{e.preventDefault();box.classList.add('dragover');};
  const leave=()=>box.classList.remove('dragover');
  box.addEventListener('dragover',over);
  box.addEventListener('dragenter',over);
  box.addEventListener('dragleave',leave);
  box.addEventListener('drop',e=>{
    e.preventDefault();leave();
    const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
    if(!f){notify('请拖入 CSV/TSV/TXT 文件。');return;}
    if(f.size>4*1024*1024){notify('文件太大（>4MB）。');return;}
    f.text().then(handler).catch(()=>notify('读不了这个文件。'));
  });
}
bindDrop('cardsIO',t=>{
  const res=importCards(state.cards,t,Date.now());
  state.cards=res.deck;cardsResetReview();renderCards();scheduleSave();
  ioReport('cardsIOResult',res);
  if(res.added)notify('拖入导入 '+res.added+' 张卡片。');
});
bindDrop('mistIO',t=>{
  const res=importMistakes(state.mistakes,t,Date.now());
  state.mistakes=res.book;renderMistakes();scheduleSave();
  ioReport('mistIOResult',res);
  if(res.added)notify('拖入导入 '+res.added+' 道错题。');
});
/* 面板滚动位置记忆：切走再回来不丢阅读/浏览位置。 */
const panelScroll={};
const PANEL_SCROLL_MAP={overview:'overviewPanel',focus:'focusPanel',cards:'cardsPanel',mistakes:'mistakesPanel',habits:'habitsPanel',schedule:'schedulePanel',medquiz:'medquizPanel',exams:'examsPanel',medcalc:'medcalcPanel',novel:'novelPanel',soundscape:'soundscapePanel'};
for(const id of Object.values(PANEL_SCROLL_MAP)){
  const el=$(id);if(!el)continue;
  el.addEventListener('scroll',()=>{panelScroll[id]=el.scrollTop;},{passive:true});
}
function restorePanelScroll(mode){
  const pid=PANEL_SCROLL_MAP[mode];
  if(pid&&panelScroll[pid]!=null){const el=$(pid);if(el)requestAnimationFrame(()=>{el.scrollTop=panelScroll[pid];});}
}
initDraw({
  scheduleSave:()=>{state.drawStrokes=getDrawStrokes();flush();},
  getDrawData:()=>state.drawStrokes||[],
  saveDrawData:(strokes)=>{state.drawStrokes=Array.isArray(strokes)?strokes:[];flush();},
  getDrawView:()=>state.drawView,
  saveDrawView:(v)=>{state.drawView=v;scheduleSave();}
});

/* AI 助手：网络请求走原生桥；设备工具卡由宿主执行并回传结果。 */
const aiToolWaiters=new Map();
function aiTool(tool,args){
 return new Promise(resolve=>{
  if(!native){resolve('此能力需要在天工 APK 中使用，并先授权目录。');return;}
  const id='at-'+Date.now()+'-'+Math.floor(Math.random()*1e6);
  aiToolWaiters.set(id,resolve);send('aiTool',{id,tool,args});
  setTimeout(()=>{if(aiToolWaiters.delete(id))resolve('操作超时，请重试。');},25000);
 });
}
function aiRunSnippet(code,lang){
 return new Promise(resolve=>{
  const l=String(lang||'').toLowerCase();
  const js=/^(js|javascript|mjs)$/.test(l),cpp=/^(c|cc|cpp|cxx|c\+\+)$/.test(l);
  /* C++ 首次要加载本地工具链，准备阶段放宽到 90 秒。 */
  const w=new Worker(js?'javascript-worker.js':cpp?'cpp-worker.js':'python-worker.js');
  let out='';const timer=setTimeout(()=>{try{w.terminate();}catch(e){}resolve(out+'\n[达到运行上限]');},cpp?90000:15000);
  const done=value=>{clearTimeout(timer);try{w.terminate();}catch(e){}resolve(String(value||out||'(无输出)').slice(0,8000));};
  w.onmessage=e=>{const m=e.data||{};if(m.type==='stdout'||m.type==='stderr')out+=m.text;else if(m.type==='done')done();};
  w.onerror=e=>done('运行失败：'+(e.message||'未知错误'));
  try{w.postMessage({code,path:js?'ai_snippet.js':cpp?'ai_snippet.cpp':'ai_snippet.py',stdin:'',files:state.files.map(f=>({path:f.path,text:f.text}))});}catch(e){done('运行环境未能启动：'+e.message);}
 });
}
initAI({
 native,notify,send,scheduleSave,aiTool,
 getActiveText:()=>view?view.state.doc.toString():active().text,
 listFiles:()=>state.files.map(f=>f.path),
 readFile:path=>{const f=state.files.find(x=>x.path===String(path).slice(0,200));return f?f.text:'（文件不存在）';},
 writeFile:(path,text)=>{const p=String(path).slice(0,200);if(!validPath(p))return '路径无效';
   const f=state.files.find(x=>x.path===p);
   if(f){f.text=String(text).slice(0,20000);editorStates.delete(p);}else if(state.files.length<160)state.files.push(makeFile(p,String(text).slice(0,20000)));else return '工作区已满';
    restoring=true;if(state.active===p)createEditor();restoring=false;renderFiles();changed();recordRecent({source:'ai',path:p,title:p.split('/').pop()||p,format:'document',mode:'ai'});scheduleSave();return '已写入草稿：'+p;},
 insertText:text=>{if(!view)return '编辑器未就绪';const at=view.state.selection.main.head,value=String(text).slice(0,20000);
   view.dispatch({changes:{from:at,to:at,insert:value},selection:{anchor:at+value.length}});changed();scheduleSave();return '已插入编辑器';},
 switchFile:path=>{const p=String(path).slice(0,200);if(!state.files.some(f=>f.path===p))return '文件不存在：'+p;switchFile(p);return '已打开：'+p;},
 runSnippet:aiRunSnippet
});
openLanding(false);
window.Studio={getState:()=>({...snapshot(),mode:workspaceMode,home:landingOpen,rootOpen:rootVisible,activeTab:currentTab(),tabDepth:tabDepth(studioTabs),layers:moduleLayers(),resume:rememberedMode(),caps:moduleCaps}),get view(){return view;},run,stop,flush,importFiles,back:handleSystemBack,exitMessage:()=>exitCopy(state.files).message,lecture:lectureDebug,tts:ttsDebug,ai:aiDebug,model:()=>modelApi?modelApi.debug():{objects:0,selected:0,mode:'object',sheet:'',active:false}};
if(native)send('ready');else{let saved=null;try{saved=JSON.parse(localStorage.getItem('ember-studio-v1'));}catch(e){}restore(saved);}
