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
import {initLecture,lectureExtensions,lectureSerialize,lectureSanitize,lectureAfterRestore,lectureViewCreated,lectureModeEnter,lectureModeLeave,lectureBusy,lectureStatusText,lectureDebug} from './lecture.js';
import {initTTS,ttsSerialize,ttsSanitize,ttsAfterRestore,ttsModeEnter,ttsModeLeave,ttsHideBar,ttsShowBar,ttsDocumentChanged,ttsStatusText,ttsReceive,ttsDebug} from './tts.js';
import {initDraw,ensureDrawUI,enterDrawMode,exitDrawMode,isDrawMode,getDrawStrokes,loadDrawStrokes,getDrawView,loadDrawView} from './draw.js';
import {initAI,aiSerialize,aiSanitize,aiRestore,aiModeEnter,aiModeLeave,aiHidePanel,aiEnterPanel,aiStatusText,aiReceive,aiDebug} from './ai.js';
import {BACK,resolveBack} from './back.js';

const $=id=>document.getElementById(id),native=!!window.StudioBridge,MAX_FILE=2*1024*1024;

/* Light editor surface: calm paper background, quiet gutters, GitHub-like syntax colours. */
const codeTheme=EditorView.theme({
  '&':{backgroundColor:'#ffffff',color:'#1f2937',height:'100%'},
  '.cm-content':{caretColor:'#111827'},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'#111827'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,.cm-content ::selection':{backgroundColor:'#dbeafe'},
  '.cm-gutters':{backgroundColor:'#ffffff',color:'#a7b3c2',border:'none'},
  '.cm-activeLine':{backgroundColor:'#f7f9fc'},
  '.cm-activeLineGutter':{backgroundColor:'#f7f9fc',color:'#5b6b80'},
  '.cm-panels':{backgroundColor:'#f7f9fc',color:'#1f2937'},
  '.cm-searchMatch':{backgroundColor:'#fde68a'},
  '.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#fca5a5'},
  '.cm-tooltip':{backgroundColor:'#ffffff',border:'1px solid #e3e8ef',color:'#1f2937'},
  '.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'#eef4ff',color:'#1d4ed8'}
},{dark:false});
const codeHighlight=HighlightStyle.define([
  {tag:tags.comment,color:'#6b7280',fontStyle:'italic'},
  {tag:[tags.keyword,tags.operatorKeyword,tags.modifier,tags.controlKeyword],color:'#cf222e'},
  {tag:[tags.string,tags.special(tags.string),tags.regexp],color:'#0a3069'},
  {tag:[tags.number,tags.bool,tags.null],color:'#0550ae'},
  {tag:[tags.function(tags.variableName),tags.definition(tags.function(tags.variableName))],color:'#8250df'},
  {tag:[tags.className,tags.typeName,tags.namespace],color:'#953800'},
  {tag:[tags.propertyName,tags.attributeName],color:'#116329'},
  {tag:[tags.tagName],color:'#116329'},
  {tag:tags.heading,color:'#0550ae',fontWeight:'600'},
  {tag:[tags.link,tags.url],color:'#0969da',textDecoration:'underline'},
  {tag:tags.invalid,color:'#b91c1c'}
]);
const langs={py:['Python',python],js:['JavaScript',javascript],mjs:['JavaScript',javascript],ts:['TypeScript',()=>javascript({typescript:true})],html:['HTML',html],htm:['HTML',html],css:['CSS',css],json:['JSON',json],c:['C',cpp],h:['C/C++',cpp],cpp:['C++',cpp],cc:['C++',cpp],java:['Java',java],md:['Markdown',markdown]};
const extension=path=>(path.split('.').pop()||'').toLowerCase();
const validPath=path=>typeof path==='string'&&path.length>0&&path.length<=200&&!path.startsWith('/')&&!path.split('/').some(v=>!v||v==='.'||v==='..')&&!/[\x00-\x1f\\:*?"<>|]/.test(path);
const makeFile=(path,text,uri='',encoding='UTF-8')=>({path,text,uri,encoding,savedText:text});
const defaults=()=>({version:1,files:[makeFile('main.py','# 天工 · 离线 Python\n# 标准输入在下方面板填写，每行一项\nfrom geometry import rectangle_area\nimport json\n\nname = input("你的名字：")\nprint(f"你好，{name}！")\n\nwith open("data.json", encoding="utf-8") as f:\n    shape = json.load(f)\n\narea = rectangle_area(shape["width"], shape["height"])\nprint(f"长方形面积：{area}")\nfor i in range(1, 4):\n    print("让想法运行起来", "✦" * i)\n'),makeFile('geometry.py','def rectangle_area(width, height):\n    """计算长方形面积。"""\n    return width * height\n'),makeFile('data.json','{\n  "width": 8,\n  "height": 5\n}\n'),makeFile('index.html','<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{background:#142330;color:#b2ebda;font:18px system-ui;padding:30px}button{padding:12px;border-radius:8px}</style>\n<h1>你好，天工！</h1>\n<p>这是手机上写出的第一个页面。</p>\n<button onclick="this.textContent=\'想法变成了现实 ✦\'">试着点一下</button>\n</html>\n')],active:'main.py',opened:['main.py','geometry.py'],stdin:'伍子平\n',settings:{fontSize:15,wrap:true,timeLimit:15},drawStrokes:[],drawView:null,tts:{voice:'',locale:'en-US',rate:1},ai:aiSerialize()});
let state=defaults(),view,restoring=false,worker=null,runToken=0,timeout=null,saveTimer=null,revision=0,latestSaved=0,renamePath=null,ready=false,toastTimer,pendingSaves=new Map(),runFiles=[];
const langConfig=new Compartment(),wrapConfig=new Compartment(),editConfig=new Compartment();
let editorStates=new Map();
function active(){return state.files.find(f=>f.path===state.active)||state.files[0];}
function language(path){return langs[extension(path)]||['纯文本',()=>[]];}
function notify(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function send(type,data={}){if(native)window.StudioBridge.postMessage(JSON.stringify({type,...data}));}
function snapshot(){return {version:1,files:state.files,active:state.active,opened:state.opened,stdin:$('stdin').value,settings:state.settings,lecture:lectureSerialize(),tts:ttsSerialize(),drawStrokes:state.drawStrokes||[],drawView:getDrawView(),ai:aiSerialize()};}
function flush(){clearTimeout(saveTimer);if(!ready)return;state.stdin=$('stdin').value;const data=snapshot(),id=++revision;$('saveState').textContent='正在保存草稿…';if(native)send('snapshot',{data,id});else try{localStorage.setItem('ember-studio-v1',JSON.stringify(data));latestSaved=id;$('saveState').textContent='草稿已保存';}catch(e){$('saveState').textContent='草稿保存失败';notify('空间不足，请先另存重要文件。');}}
function scheduleSave(){if(restoring)return;$('saveState').textContent='草稿待保存';clearTimeout(saveTimer);saveTimer=setTimeout(flush,450);}
function changed(){renderFiles();scheduleSave();}
function loadState(data){
  if(!data||data.version!==1||!Array.isArray(data.files)||!data.files.length)throw Error('无有效工作区');
  const unique=new Set();const files=data.files.filter(f=>validPath(f.path)&&typeof f.text==='string'&&f.text.length<=MAX_FILE&&!unique.has(f.path)&&unique.add(f.path)).slice(0,160).map(f=>({...f,uri:typeof f.uri==='string'?f.uri:'',encoding:f.encoding||'UTF-8',savedText:typeof f.savedText==='string'?f.savedText:f.text}));
  if(!files.length)throw Error('工作区文件无法读取');
  state={...defaults(),...data,files,settings:{...defaults().settings,...data.settings}};
  state.lecture=lectureSanitize(data.lecture);
  state.tts=ttsSanitize(data.tts);
  state.ai=(data&&data.ai&&typeof data.ai==='object')?data.ai:aiSerialize();
  state.drawStrokes=Array.isArray(data.drawStrokes)?data.drawStrokes:[];
  state.drawView=(data&&data.drawView&&typeof data.drawView==='object')?data.drawView:null;
  state.settings.fontSize=Math.max(12,Math.min(24,Number(state.settings.fontSize)||15));state.settings.timeLimit=[15,30,60].includes(+state.settings.timeLimit)?+state.settings.timeLimit:15;if(window.innerWidth<700)state.settings.wrap=true;
  state.active=files.some(f=>f.path===state.active)?state.active:files[0].path;state.opened=Array.isArray(state.opened)?state.opened.filter(p=>files.some(f=>f.path===p)):[];if(!state.opened.includes(state.active))state.opened.push(state.active);
}
function restore(data){try{loadState(data);}catch(e){if(data)notify('工作区格式无法读取；原备份未被覆盖，请先导出或检查。');}restoring=true;editorStates.clear();$('stdin').value=state.stdin||'';createEditor();restoring=false;ready=true;renderFiles();applySettings();markLandingReady();lectureAfterRestore();ttsAfterRestore();aiRestore(state.ai);loadDrawView(state.drawView);if(state.drawStrokes&&state.drawStrokes.length)loadDrawStrokes(state.drawStrokes);}
function createEditor(){
 if(view)view.destroy();
 const config={doc:active().text,extensions:[
   basicSetup,
   codeTheme,
   syntaxHighlighting(codeHighlight),
   ...lectureExtensions,
   keymap.of([indentWithTab]),
   langConfig.of(language(active().path)[1]()),
   wrapConfig.of(state.settings.wrap?EditorView.lineWrapping:[]),
   editConfig.of(EditorState.readOnly.of(!!worker)),
   EditorView.contentAttributes.of({autocapitalize:'off',autocorrect:'off',spellcheck:'false',enterkeyhint:'enter',inputmode:'text'}),
   EditorView.updateListener.of(update=>{
     if(update.docChanged&&!restoring){const f=active();f.text=update.state.doc.toString();scheduleSave();refreshBadges();ttsDocumentChanged();}
     if(update.selectionSet||update.docChanged)position();
   })
 ]};
 view=new EditorView({state:EditorState.create(config),parent:$('editor')});view.dom.style.fontSize=state.settings.fontSize+'px';editorStates.set(active().path,view.state);position();lectureViewCreated();
}
function position(){if(!view)return;const pos=view.state.selection.main.head,line=view.state.doc.lineAt(pos);$('position').textContent=`第 ${line.number} 行，第 ${pos-line.from+1} 列`;const note=$('noteCount');if(note&&document.body.classList.contains('notepad'))note.textContent=view.state.doc.length+' 字 · '+view.state.doc.lines+' 行';else if(note&&document.body.classList.contains('lecture'))note.textContent=lectureStatusText();else if(note&&document.body.classList.contains('tts'))note.textContent=ttsStatusText();else if(note&&document.body.classList.contains('aiview'))note.textContent=aiStatusText();const empty=$('noteEmpty');if(empty)empty.classList.toggle('show',document.body.classList.contains('notepad')&&view.state.doc.length===0);}
function renderFiles(){
 const list=$('fileList');list.replaceChildren();for(const f of state.files){const row=document.createElement('div');row.className='fileitem'+(f.path===state.active?' active':'');const b=document.createElement('button');b.className='fileopen';b.title=f.path;b.dataset.path=f.path;const glyph=document.createElement('span');glyph.className='fileglyph';glyph.textContent=extension(f.path).slice(0,3);const name=document.createElement('span');name.textContent=f.path+(f.text!==f.savedText?' •':'');b.append(glyph,name);b.onclick=()=>switchFile(f.path);const menu=document.createElement('button');menu.className='filemenu';menu.textContent='⋯';menu.setAttribute('aria-label','重命名 '+f.path);menu.onclick=()=>nameDialog(f.path);row.append(b,menu);list.append(row);}
 const tabs=$('tabs');tabs.replaceChildren();for(const path of state.opened){const f=state.files.find(f=>f.path===path);if(!f)continue;const b=document.createElement('button');b.role='tab';b.setAttribute('aria-selected',String(path===state.active));b.textContent=path.split('/').pop()+(f.text!==f.savedText?' •':'');b.title=path;b.dataset.path=path;b.className=path===state.active?'active':'';b.onclick=()=>switchFile(path);tabs.append(b);}
 refreshBadges();
}
function refreshBadges(){
 const f=active();if(!f)return;
 $('activePath').textContent=f.path;$('dirtyFlag').textContent=f.uri?(f.text===f.savedText?'已保存到原文件':'有修改 · 保存写回'):'本地草稿 · 自动保存';$('language').textContent=document.body.classList.contains('drawing')?'画画':language(f.path)[0];$('encoding').textContent=f.encoding||'UTF-8';$('runButton').textContent=['html','htm'].includes(extension(f.path))?'↗ 预览':'▶ 运行';
 for(const b of $('tabs').children){const p=b.dataset.path;if(!p)continue;const t=state.files.find(x=>x.path===p);if(!t)continue;const activeNow=p===state.active;b.textContent=p.split('/').pop()+(t.text!==t.savedText?' •':'');b.classList.toggle('active',activeNow);b.setAttribute('aria-selected',String(activeNow));}
 for(const b of $('fileList').querySelectorAll('.fileopen')){const p=b.dataset.path,t=state.files.find(x=>x.path===p);if(!t)continue;const name=b.lastElementChild;if(name)name.textContent=p+(t.text!==t.savedText?' •':'');b.closest('.fileitem').classList.toggle('active',p===state.active);}
}
function switchFile(path){if(worker){notify('请先停止运行，再切换文件。');return;}const f=state.files.find(f=>f.path===path);if(!f)return;if(workspaceMode==='tts')lastTtsPath=path;editorStates.set(state.active,view.state);state.active=path;if(!state.opened.includes(path))state.opened.push(path);restoring=true;const previous=editorStates.get(path);if(previous&&previous.doc.toString()===f.text){view.setState(previous);view.dispatch({effects:[langConfig.reconfigure(language(path)[1]()),wrapConfig.reconfigure(state.settings.wrap?EditorView.lineWrapping:[]),editConfig.reconfigure(EditorState.readOnly.of(false))]});}else createEditor();restoring=false;renderFiles();document.body.classList.remove('drawer');position();scheduleSave();if(workspaceMode==='tts')ttsDocumentChanged();}
function nameDialog(path=null){if(worker)return;renamePath=path;$('nameTitle').textContent=path?'修改工作区路径':'新建文件';$('confirmName').textContent=path?'重命名':'创建';$('fileName').value=path||(workspaceMode==='notepad'?'笔记.txt':workspaceMode==='tts'?'English.txt':'new_file.py');const hint=$('nameHint');if(hint)hint.textContent=workspaceMode==='notepad'?'可带子文件夹；例如 日记/今天.txt。':workspaceMode==='tts'?'可带子文件夹；例如 Articles/chapter-one.txt。':'可带子文件夹；请写扩展名，例如 .py。';$('nameDialog').returnValue='cancel';$('nameDialog').showModal();setTimeout(()=>$('fileName').select(),50);}
$('nameDialog').addEventListener('close',()=>{if($('nameDialog').returnValue!=='default')return;const path=$('fileName').value.trim();if(!validPath(path)){notify('路径无效，请使用文件名或 folder/file.py。');return;}if(state.files.some(f=>f.path===path)&&path!==renamePath){notify('已有同名文件。');return;}if(renamePath){const f=state.files.find(f=>f.path===renamePath);f.path=path;state.opened=state.opened.map(p=>p===renamePath?path:p);if(state.active===renamePath)state.active=path;editorStates.delete(renamePath);}else{if(state.files.length>=160){notify('当前工作区最多 160 个文件。');return;}state.files.push(makeFile(path,''));}switchFile(path);changed();});
function applySettings(){$('fontSize').value=state.settings.fontSize;$('fontSizeValue').textContent=state.settings.fontSize;$('wordWrap').checked=!!state.settings.wrap;$('timeLimit').value=state.settings.timeLimit;if(view){view.dom.style.fontSize=state.settings.fontSize+'px';view.dispatch({effects:[wrapConfig.reconfigure(state.settings.wrap?EditorView.lineWrapping:[])]});}}
for(const id of ['fontSize','wordWrap','timeLimit'])$(id).oninput=()=>{state.settings={fontSize:+$('fontSize').value,wrap:$('wordWrap').checked,timeLimit:+$('timeLimit').value};applySettings();scheduleSave();};
function append(text,error=false){if($('output').textContent.length>=70000)return;const span=document.createElement('span');if(error)span.className='error';span.textContent=String(text).slice(0,70000-$('output').textContent.length);$('output').append(span);$('output').scrollTop=$('output').scrollHeight;}
function setConsole(open){$('consolePanel').classList.toggle('folded',!open);$('foldConsole').setAttribute('aria-expanded',String(open));}
function outputTab(input=false){$('output').hidden=input;$('stdin').hidden=!input;$('inputTab').classList.toggle('active',input);$('outputTab').classList.toggle('active',!input);setConsole(true);}
function setRunning(running){$('runButton').hidden=running;$('stopButton').hidden=!running;for(const id of ['newFile','openFile','openFolder','saveButton','exportButton','gameTab','newTab','menuNew','menuOpen','menuFolder','menuSave','menuGame','menuMode']){const el=$(id);if(el)el.disabled=running;}if(view)view.dispatch({effects:editConfig.reconfigure(EditorState.readOnly.of(running))});}
function stop(reason='已停止运行'){runToken++;if(worker)worker.terminate();worker=null;clearTimeout(timeout);setRunning(false);$('runState').textContent=reason;}
function applyRunFiles(files){let updated=0;for(const f of files||[]){if(!validPath(f.path)||typeof f.text!=='string'||f.text.length>MAX_FILE)continue;const existing=state.files.find(x=>x.path===f.path);if(existing){if(existing.text===f.text)continue;existing.text=f.text;editorStates.delete(f.path);}else if(state.files.length<160)state.files.push(makeFile(f.path,f.text));else continue;updated++;}if(updated){restoring=true;createEditor();restoring=false;changed();append(`\n[工作区] 已保留 ${updated} 个新增或修改的文件，写回手机文件需点击保存。\n`);}}
async function run(){
 if(worker)return;const f=active(),ext=extension(f.path);if(['html','htm'].includes(ext)){preview();return;}if(!['py','js','mjs'].includes(ext)){notify(language(f.path)[0]+' 暂仅支持编辑；请运行 .py、.js 或预览 .html。');return;}
 flush();outputTab(false);$('output').replaceChildren();$('runState').textContent=ext==='py'?'准备 Python…':'运行 JavaScript…';runFiles=state.files.map(f=>({path:f.path,text:f.text}));const token=++runToken;worker=new Worker(ext==='py'?'python-worker.js':'javascript-worker.js');setRunning(true);const started=performance.now();let hasStarted=false;
 timeout=setTimeout(()=>{if(token!==runToken)return;append('\n运行超时，已停止。可以在设置中调整运行上限。\n',true);stop('运行超时');},45000);
 worker.onmessage=event=>{if(token!==runToken)return;const m=event.data||{};if(m.type==='started'&&!hasStarted){hasStarted=true;clearTimeout(timeout);$('runState').textContent='运行中 · 可停止';timeout=setTimeout(()=>{append('\n达到运行上限，已终止工作线程。\n',true);stop('运行超时');},state.settings.timeLimit*1000);}else if(m.type==='stdout'||m.type==='stderr')append(m.text,m.type==='stderr');else if(m.type==='done'){const elapsed=((performance.now()-started)/1000).toFixed(2);stop(m.ok?'执行完成 · '+elapsed+'s':'执行失败 · '+elapsed+'s');applyRunFiles(m.files);flush();}else if(m.type==='error'){append(m.text+'\n',true);stop('运行环境未能启动');}};
 worker.onerror=event=>{if(token!==runToken)return;append('运行环境错误：'+event.message+'\n请确认系统 WebView 支持 WebAssembly。\n',true);stop('运行环境错误');};
 worker.postMessage({path:f.path,code:f.text,files:runFiles,stdin:$('stdin').value});
}
function preview(){flush();if(native){send('preview',{path:active().path,files:state.files.map(f=>({path:f.path,text:f.text}))});return;}const dlg=document.createElement('dialog');dlg.style.cssText='width:96vw;height:90vh;padding:8px;max-width:1100px';const close=document.createElement('button');close.textContent='关闭预览';close.onclick=()=>{dlg.close();dlg.remove();};const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.style.cssText='width:100%;height:90%;background:white;border:0';let content=active().text;content=content.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,(tag,path)=>{const f=state.files.find(f=>f.path===path);return f?'<style>'+f.text+'</style>':tag;}).replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,(tag,path)=>{const f=state.files.find(f=>f.path===path);return f?'<script>'+f.text+'</script>':tag;});frame.srcdoc=content;dlg.append(close,frame);document.body.append(dlg);dlg.showModal();}
function saveFile(as=false){flush();const f=active(),id=String(Date.now())+'-'+Math.random();if(native){pendingSaves.set(id,{path:f.path,text:f.text});send(as||!f.uri?'export':'save',{id,path:f.path,text:f.text,uri:f.uri,encoding:f.encoding});}else{const blob=new Blob([f.text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=f.path.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);f.savedText=f.text;changed();notify('已导出文件。');}}
function importFiles(files){if(worker){notify('请停止运行后再导入。');return null;}let first='',backups=0,accepted=0;for(const file of files){if(!validPath(file.path)||typeof file.text!=='string'||file.text.length>MAX_FILE)continue;let path=file.path;const existing=state.files.find(f=>f.path===path);if(existing&&existing.uri!==file.uri){if(state.files.length>=159){notify('文件过多，请先另存草稿后重试。');break;}const backup='_草稿备份/'+Date.now()+'_'+path.split('/').pop().slice(-140);existing.path=backup;existing.uri='';state.opened=state.opened.map(p=>p===path?backup:p);editorStates.delete(path);backups++;}else if(existing){if(existing.text!==existing.savedText){notify('文件存在未写回的编辑，已保留草稿。');continue;}Object.assign(existing,makeFile(path,file.text,file.uri,file.encoding));accepted++;if(!first)first=path;continue;}if(state.files.length>=160)break;state.files.push(makeFile(path,file.text,file.uri||'',file.encoding||'UTF-8'));accepted++;if(!first)first=path;}if(first)switchFile(first);changed();if(backups)notify('导入文件保留原名；同名旧稿已移到 _草稿备份。');return {accepted,backups};}
async function browserImport(event){const files=[];let skipped=0;for(const f of [...event.target.files].slice(0,160)){if(f.size>MAX_FILE){skipped++;continue;}try{const bytes=new Uint8Array(await f.arrayBuffer());if(bytes.includes(0))throw Error('binary');const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);files.push({path:f.webkitRelativePath||f.name,text,uri:'browser:'+f.name});}catch(e){skipped++;}}const result=importFiles(files);notify(`已接收 ${result?.accepted||0} / ${files.length} 个文本文件${skipped?'，另跳过 '+skipped+' 个非文本或过大文件':''}`);event.target.value='';}
window.StudioNative={receive(m){if(m.type==='aiToolResult'){const r=aiToolWaiters.get(m.id);if(r){aiToolWaiters.delete(m.id);r(m.data||(m.ok?'完成':'操作未完成'));}return;}if(m.type==='restore'){restore(m.data);if(m.error)notify(m.error);}else if(m.type==='snapshotSaved'){if(m.id>=latestSaved){latestSaved=m.id;if(m.id===revision)$('saveState').textContent=m.ok?'草稿已保存':'草稿保存失败';}}else if(m.type==='imported'){const result=importFiles(m.files||[]);if(result&&result.accepted<(m.files||[]).length)notify('工作区接收 '+result.accepted+' / '+m.files.length+' 个文件，其余因容量或未保存草稿冲突未导入；原文件保留。');else notify((m.message||'导入完成')+(result?.backups?'；同名旧稿已备份':''));}else if(m.type==='saved'){const pending=pendingSaves.get(m.id);pendingSaves.delete(m.id);if(m.ok&&pending){const f=state.files.find(f=>f.path===pending.path);if(f){f.savedText=pending.text;f.uri=m.uri||f.uri;f.encoding=m.encoding||f.encoding;changed();}notify('已保存到手机文件。');}else notify(m.message||'保存未完成，草稿仍保留。');}else if(ttsReceive(m)){}else if(aiReceive(m)){}else if(m.type==='notice')notify(m.message);else if(m.type==='gameState')$('gameSaveInfo').textContent=m.exists?'发现游戏存档 · 进入后点击“继续旅程”。':'尚无游戏存档 · 开始后会自动保存。';}};
/* One activation path per control. pointerup used to fire before click and let the
   interface change underneath the finger (drawer opening, Run becoming Stop), which
   made 0.1.7 buttons feel broken on phones. */
const on=(id,fn)=>{const el=$(id);if(el)el.addEventListener('click',fn);};
const closeDrawer=()=>document.body.classList.remove('drawer');
const closeMenu=()=>{const m=$('menuDialog');if(m&&m.open)m.close();};
const menu=(id,fn)=>on(id,()=>{closeMenu();fn();});
function showGame(){flush();closeDrawer();closeMenu();$('workbench').hidden=true;$('lounge').hidden=false;document.body.classList.add('gameview');$('activePath').textContent='游戏';$('dirtyFlag').textContent='伍子平 · 星火远征';$('gameTab').classList.add('selected');$('codeTab').classList.remove('selected');send('gameState');}
function showCode(){closeMenu();$('workbench').hidden=false;$('lounge').hidden=true;document.body.classList.remove('gameview');$('gameTab').classList.remove('selected');$('codeTab').classList.add('selected');renderFiles();if(view)view.requestMeasure();}
function setWorkspaceMode(mode){
  workspaceMode=selectedMode=mode;
  const drawToggle=$('drawToggle');if(drawToggle)drawToggle.hidden=mode!=='notepad';
  if(mode!=='notepad')document.body.classList.remove('notepad');
  if(mode!=='lecture')document.body.classList.remove('lecture');
  if(mode!=='tts')document.body.classList.remove('tts');
  if(mode!=='ai')document.body.classList.remove('aiview');
  if(mode!=='game')document.body.classList.remove('gameview');
}
on('filesToggle',()=>{closeMenu();document.body.classList.toggle('drawer');});on('backdrop',closeDrawer);on('closeExplorer',closeDrawer);on('newFile',()=>nameDialog());on('newTab',()=>nameDialog());menu('menuNew',()=>nameDialog());
menu('findButton',()=>{openSearchPanel(view);view.focus();});menu('settingsButton',()=>$('settingsDialog').showModal());on('saveButton',()=>saveFile());menu('menuSave',()=>saveFile());menu('exportButton',()=>saveFile(true));on('runButton',run);on('stopButton',()=>{append('\n[已手动停止]\n');stop();});on('outputTab',()=>outputTab(false));on('inputTab',()=>outputTab(true));on('clearOutput',()=>$('output').replaceChildren());on('foldConsole',()=>setConsole($('consolePanel').classList.contains('folded')));on('openFile',()=>{flush();closeDrawer();native?send('open'):$('browserFiles').click();});on('openFolder',()=>{flush();closeDrawer();native?send('folder'):$('browserFolder').click();});menu('menuOpen',()=>{flush();native?send('open'):$('browserFiles').click();});menu('menuFolder',()=>{flush();native?send('folder'):$('browserFolder').click();});on('moreButton',()=>$('menuDialog').showModal());$('browserFiles').onchange=browserImport;$('browserFolder').onchange=browserImport;$('stdin').oninput=scheduleSave;
on('codeTab',showCode);on('gameTab',showGame);menu('menuGame',showGame);menu('menuMode',()=>openLanding(true));on('playGame',()=>{flush();if(native)send('play');else notify('此预览仅展示编辑器，安装 APK 后可直接进入原生游戏。');});on('exportGame',()=>native?send('exportGame'):notify('游戏存档备份在 Android APK 中使用。'));on('importGame',()=>native?send('importGame'):notify('安装 APK 后可导入游戏备份。'));
on('drawToggle',()=>{if(workspaceMode!=='notepad')return;if(isDrawMode()){exitDrawMode();}else{enterDrawMode();}});
$('menuDialog').addEventListener('click',event=>{if(event.target===$('menuDialog'))$('menuDialog').close();});
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
document.addEventListener('keydown',event=>{const mod=event.ctrlKey||event.metaKey;if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();if(worker)notify('运行中无法写回文件，请先停止运行');else saveFile(event.shiftKey);}else if(event.key==='F5'||mod&&event.key==='Enter'){event.preventDefault();run();}else if(mod&&event.key.toLowerCase()==='o'){event.preventDefault();$('openFile').click();}else if(mod&&event.key.toLowerCase()==='n'){event.preventDefault();nameDialog();}});
window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();});
const onViewportChange=()=>{if((window.visualViewport?window.visualViewport.height:innerHeight)<520)setConsole(false);};
window.addEventListener('resize',onViewportChange);if(window.visualViewport)window.visualViewport.addEventListener('resize',onViewportChange);
/* Landing: pick today's mode with a three-row selector. */
const landing=$('landing'),wheel=$('modeWheel'),enterMode=$('enterMode'),enterModeLabel=$('enterModeLabel'),landingBack=$('landingBack'),landingStatus=$('landingStatus'),modeIndex=$('modeIndex');
const modeItems=[...wheel.querySelectorAll('.wheel-item')];
const landingLabels={python:'开始写 Python',notepad:'打开记事本',game:'去星火远征',lecture:'开始上课',tts:'开始英文朗读',ai:'打开 AI 助手'};
const MODE_KEY='ember-studio-mode';
let landingOpen=true,landingTimer=0,selectedMode='python',workspaceMode='python',lastCodePath='',lastTtsPath='',wheelSelection=0;
try{const savedMode=localStorage.getItem(MODE_KEY);if(['python','notepad','game','lecture','tts','ai'].includes(savedMode))selectedMode=savedMode;}catch(e){}
function updateEnterLabel(){if(enterModeLabel)enterModeLabel.textContent=ready?landingLabels[selectedMode]:'正在点亮工作台…';}
function syncWheel(){const index=Math.max(0,Math.min(modeItems.length-1,wheelSelection));wheelSelection=index;selectedMode=modeItems[index].dataset.mode;modeItems.forEach((el,n)=>{el.classList.toggle('active',n===index);el.setAttribute('aria-selected',String(n===index));});if(landing){landing.dataset.mode=selectedMode;landing.style.setProperty('--sel',String(index));}if(modeIndex)modeIndex.textContent=String(index+1).padStart(2,'0')+' / '+String(modeItems.length).padStart(2,'0');updateEnterLabel();}
function markLandingReady(){if(!landing)return;landing.dataset.ready='1';if(landingStatus)landingStatus.textContent='工作台已点亮';enterMode.disabled=false;updateEnterLabel();}
function hideLanding(){if(!landingOpen)return;if(workspaceMode==='ai')aiEnterPanel();if(workspaceMode==='tts')ttsShowBar();landingOpen=false;landing.classList.add('landing-out');landing.setAttribute('aria-hidden','true');clearTimeout(landingTimer);landingTimer=setTimeout(()=>{if(landingOpen)return;landing.hidden=true;landing.classList.remove('landing-out');if(view&&!['game','ai'].includes(workspaceMode))view.focus();},420);}
function placeWheel(){const found=modeItems.findIndex(el=>el.dataset.mode===selectedMode);wheelSelection=Math.max(0,found);syncWheel();}
function openLanding(reopen=false){if(reopen&&workspaceMode==='tts')ttsHideBar();if(reopen&&workspaceMode==='ai')aiHidePanel();clearTimeout(landingTimer);landing.hidden=false;if(landingStatus)landingStatus.textContent=ready?'工作台已点亮':'正在点亮工作台';landing.classList.remove('landing-out');landing.removeAttribute('aria-hidden');landingBack.hidden=!reopen;landingOpen=true;if(reopen&&['python','notepad','game','lecture','tts','ai'].includes(workspaceMode))selectedMode=workspaceMode;placeWheel();requestAnimationFrame(()=>{placeWheel();try{wheel.focus({preventScroll:true});}catch(e){}});}
function handleSystemBack(){
  const openDialog=document.querySelector('dialog[open]');
  const loungeOpen=!!$('lounge')&&!$('lounge').hidden;
  try{
    const decision=resolveBack({
      dialogOpen:!!openDialog,
      drawerOpen:document.body.classList.contains('drawer'),
      drawing:isDrawMode()||document.body.classList.contains('drawing')||($('drawLayer')&&!$('drawLayer').hidden),
      searchOpen:!!(view&&view.dom.querySelector('.cm-search')),
      landingOpen,
      now:Date.now()
    });
    switch(decision.action){
      case BACK.DIALOG:
        if(openDialog)openDialog.close('cancel');
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
        view.focus();
        return true;
      case BACK.LANDING:
        if(loungeOpen){showCode();setWorkspaceMode('python');}
        else{flush();openLanding(true);}
        return true;
      case BACK.PASS:return false;
      default:return false;
    }
  }catch(error){
    console.error('[Studio] back handling failed',error);
    return true;
  }
}
function ensureNote(){let note=state.files.find(f=>f.path==='笔记.txt');if(!note){note=makeFile('笔记.txt','');state.files.push(note);}if(!state.opened.includes(note.path))state.opened.push(note.path);return note;}
function ensureLectureNote(){let note=state.files.find(f=>f.path==='课堂笔记.md');if(!note){note=makeFile('课堂笔记.md','');state.files.push(note);changed();}if(!state.opened.includes(note.path))state.opened.push(note.path);return note;}
function ensureEnglishText(){let text=state.files.find(f=>f.path==='English.txt');if(!text){const activeFile=state.files.find(f=>f.path===state.active&&/\.(txt|md)$/i.test(f.path)&&/[A-Za-z]/.test(f.text||''));if(activeFile)text=activeFile;}if(!text){if(state.files.length>=160){notify('工作区已有 160 个文件，请先打开英文文本或腾出一个文件名额。');return null;}text=makeFile('English.txt','Welcome to English Reading.\n\nType or open an English text here. The reader divides long paragraphs at natural sentence boundaries, so you can follow an entire article without losing your place.\n\nChoose an installed English voice, adjust the speaking rate, and use the same controls to pause, continue, or stop at any time.\n');state.files.push(text);changed();}if(!state.opened.includes(text.path))state.opened.push(text.path);lastTtsPath=text.path;return text;}
function applyMode(mode){
  if(workspaceMode==='lecture'&&mode!=='lecture'&&lectureBusy()){notify('正在上课录音，请先点「⏹ 停止」结束录音，再切换模式。');selectedMode='lecture';syncWheel();return false;}
  /* Game is intentionally excluded: it replaces the editor view while the
     worker may keep running in the background. Every editor mode, including
     lecture, stays guarded until the worker is stopped. */
  if(worker&&['python','notepad','lecture','tts','ai'].includes(mode)){notify('Python 或 JavaScript 正在运行，请先停止运行，再切换模式。');return false;}
  const ttsTarget=mode==='tts'?((lastTtsPath&&state.files.find(x=>x.path===lastTtsPath))||state.files.find(x=>x.path==='English.txt')||ensureEnglishText()):null;
  if(mode==='tts'&&!ttsTarget)return false;
  if(workspaceMode==='tts'&&mode!=='tts')ttsModeLeave();
  const leavingAI=workspaceMode==='ai'&&mode!=='ai';
  workspaceMode=mode;
  const drawToggle=$('drawToggle');
  if(leavingAI)aiModeLeave();
  const aiPanel=$('aiPanel');
  if(mode==='ai'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('aiview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=false;
    $('activePath').textContent='AI 助手';$('dirtyFlag').textContent='';
    aiModeEnter();return true;
  }
  if(aiPanel)aiPanel.hidden=true;
  document.body.classList.remove('aiview');$('workbench').hidden=false;
  if(mode==='game'){document.body.classList.remove('notepad');document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();showGame();return true;}
  showCode();
  if(mode==='notepad'){document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(state.active!=='笔记.txt')lastCodePath=state.active;document.body.classList.add('notepad');switchFile(ensureNote().path);if(drawToggle)drawToggle.hidden=false;}
  else if(mode==='lecture'){document.body.classList.remove('notepad');document.body.classList.remove('tts');document.body.classList.add('lecture');if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();const note=ensureLectureNote();switchFile(note.path);lectureModeEnter();}
  else if(mode==='tts'){document.body.classList.remove('notepad');document.body.classList.remove('lecture');lectureModeLeave();document.body.classList.add('tts');if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();switchFile(ttsTarget.path);ttsModeEnter();}
  else{document.body.classList.remove('notepad');document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();const f=(lastCodePath&&state.files.find(x=>x.path===lastCodePath))||state.files.find(x=>x.path==='main.py')||state.files.find(x=>!x.path.endsWith('.txt'))||state.files[0];if(f)switchFile(f.path);}
  setTimeout(()=>{if(view)view.focus();},260);
  return true;
}
function enterSelected(){
  if(!ready||!landingOpen)return;
  const mode=selectedMode;
  /* Re-selecting the current mode is a cancellation, not a mode switch. */
  if(mode===workspaceMode){hideLanding();return;}
  if(!applyMode(mode)){selectedMode=workspaceMode;placeWheel();return;}
  try{localStorage.setItem(MODE_KEY,mode);}catch(e){}
  hideLanding();
}
const moveSelection=step=>{wheelSelection=Math.max(0,Math.min(modeItems.length-1,wheelSelection+step));syncWheel();};
let wheelTouchY=0,wheelSwiped=false,wheelLock=0;
wheel.addEventListener('touchstart',event=>{wheelTouchY=event.touches[0]?.clientY||0;wheelSwiped=false;},{passive:true});
wheel.addEventListener('touchend',event=>{const y=event.changedTouches[0]?.clientY;if(typeof y!=='number')return;const delta=wheelTouchY-y;if(Math.abs(delta)<22)return;wheelSwiped=true;moveSelection(delta>0?1:-1);setTimeout(()=>{wheelSwiped=false;},320);},{passive:true});
wheel.addEventListener('wheel',event=>{if(Math.abs(event.deltaY)<4)return;event.preventDefault();const now=Date.now();if(now<wheelLock)return;wheelLock=now+200;moveSelection(event.deltaY>0?1:-1);},{passive:false});
wheel.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();moveSelection(event.key==='ArrowDown'?1:-1);}else if(event.key==='Enter'){event.preventDefault();enterSelected();}});
modeItems.forEach(item=>item.addEventListener('click',()=>{if(wheelSwiped)return;const index=modeItems.indexOf(item);if(index!==wheelSelection){wheelSelection=index;syncWheel();return;}enterSelected();}));
enterMode.addEventListener('click',enterSelected);
landingBack.addEventListener('click',hideLanding);
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
  saveSettings:scheduleSave
});
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
  const js=/^(js|javascript|mjs)$/i.test(lang||''),w=new Worker(js?'javascript-worker.js':'python-worker.js');
  let out='';const timer=setTimeout(()=>{try{w.terminate();}catch(e){}resolve(out+'\n[达到 15 秒运行上限]');},15000);
  const done=value=>{clearTimeout(timer);try{w.terminate();}catch(e){}resolve(String(value||out||'(无输出)').slice(0,8000));};
  w.onmessage=e=>{const m=e.data||{};if(m.type==='stdout'||m.type==='stderr')out+=m.text;else if(m.type==='done')done();};
  w.onerror=e=>done('运行失败：'+(e.message||'未知错误'));
  try{w.postMessage({code,path:js?'ai_snippet.js':'ai_snippet.py',stdin:'',files:state.files.map(f=>({path:f.path,text:f.text}))});}catch(e){done('运行环境未能启动：'+e.message);}
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
   restoring=true;createEditor();restoring=false;renderFiles();changed();scheduleSave();return '已写入草稿：'+p;},
 insertText:text=>{if(!view)return '编辑器未就绪';const at=view.state.selection.main.head,value=String(text).slice(0,20000);
   view.dispatch({changes:{from:at,to:at,insert:value},selection:{anchor:at+value.length}});changed();scheduleSave();return '已插入编辑器';},
 switchFile:path=>{const p=String(path).slice(0,200);if(!state.files.some(f=>f.path===p))return '文件不存在：'+p;switchFile(p);return '已打开：'+p;},
 runSnippet:aiRunSnippet
});
openLanding(false);
window.Studio={getState:()=>({...snapshot(),mode:workspaceMode}),get view(){return view;},run,stop,flush,importFiles,back:handleSystemBack,lecture:lectureDebug,tts:ttsDebug,ai:aiDebug};
if(native)send('ready');else{let saved=null;try{saved=JSON.parse(localStorage.getItem('ember-studio-v1'));}catch(e){}restore(saved);}
