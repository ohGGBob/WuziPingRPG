import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACK, HOME_ACTIONS, MODULES, GROUPS, modulesInGroup, moduleById, isNativeModule,
  moduleAvailability, returnFromNative, resolveBack, resolveEscapeBack, stepBack, repeatBack,
  unsavedOriginals, leaveWork, exitCopy, resumeCard, canLeaveMode
} from '../src/back.js';

const editor={homeOpen:false,mode:'python',dialogOpen:false,drawerOpen:false,drawing:false,searchOpen:false,loungeOpen:false,lectureTab:'notes'};

test('modules are grouped for the hub and every module has a Chinese name',()=>{
  assert.deepEqual(GROUPS.map(g=>g.id),['study','create','kit','more']);
  assert.deepEqual(modulesInGroup('study').map(item=>item.id),['overview','lecture','focus','cards','mistakes','habits','schedule','medquiz','exams']);
  assert.deepEqual(modulesInGroup('create').map(item=>item.id),['python','notepad','photo','model']);
  assert.deepEqual(modulesInGroup('kit').map(item=>item.id),['tts','scan','medcalc']);
  assert.deepEqual(modulesInGroup('more').map(item=>item.id),['ai']);
  assert.equal(HOME_ACTIONS,MODULES);
  for(const item of MODULES){
    assert.ok(item.title.length>=2,item.id);
    assert.ok(item.resume.startsWith('继续'),item.id);
    assert.ok(GROUPS.some(g=>g.id===item.group),item.id);
    assert.ok(item.kind==='web'||item.kind==='native',item.id);
  }
  assert.deepEqual(MODULES.filter(m=>m.kind==='native').map(m=>m.id),['scan','photo']);
});

test('native modules need the phone shell, a camera and Android 10 for scanning',()=>{
  assert.equal(moduleAvailability('python',{}).ok,true);
  assert.equal(moduleAvailability('scan',{}).ok,false);
  assert.equal(moduleAvailability('scan',{}).reason,'browser');
  assert.equal(moduleAvailability('photo',{browserPhoto:true}).ok,true);
  assert.equal(moduleAvailability('scan',{native:true,sdk:28,scan:true}).reason,'sdk');
  assert.equal(moduleAvailability('scan',{native:true,sdk:34,scan:false}).reason,'missing');
  assert.equal(moduleAvailability('scan',{native:true,sdk:34,scan:true}).ok,true);
  assert.equal(moduleAvailability('photo',{native:true,sdk:23,photo:true}).ok,true);
  assert.equal(moduleAvailability('nope').ok,false);
});

test('module layers peel off before the module root returns home',()=>{
  const run=repeatBack({homeOpen:false,mode:'ai',layers:['aiSettings','aiQueue']},4);
  assert.deepEqual(run.trace,[BACK.LAYER,BACK.LAYER,BACK.HOME,BACK.EXIT]);
  assert.equal(resolveBack({mode:'ai',layers:['aiSettings']}).layer,'aiSettings');
  assert.equal(resolveBack({mode:'ai',drawerOpen:true,layers:['x']}).action,BACK.DRAWER);
});

test('closing a native module lands on home with a resume card for it',()=>{
  const back=returnFromNative({homeOpen:true,mode:'python'},'scan');
  assert.equal(back.homeOpen,true);
  assert.equal(back.resumeMode,'scan');
  assert.equal(back.mode,'python');
  assert.equal(resolveBack(back).action,BACK.EXIT);
  assert.equal(returnFromNative({homeOpen:true,resumeMode:'python'},'bogus').resumeMode,'python');
  const card=resumeCard({mode:'photo'});
  assert.equal(card.kind,'native');
  assert.equal(card.title,'继续修图');
  assert.equal(isNativeModule('photo'),true);
  assert.equal(isNativeModule('python'),false);
  assert.equal(moduleById('scan').minSdk,29);
});

test('dialog, drawer, draw and search peel off before leaving the page',()=>{
  assert.equal(resolveBack({...editor,dialogOpen:true,drawerOpen:true,drawing:true,searchOpen:true,homeOpen:true}).action,BACK.DIALOG);
  assert.equal(resolveBack({...editor,drawerOpen:true,drawing:true,searchOpen:true}).action,BACK.DRAWER);
  assert.equal(resolveBack({...editor,drawing:true,searchOpen:true}).action,BACK.DRAW);
  assert.equal(resolveBack({...editor,searchOpen:true}).action,BACK.SEARCH);
  assert.equal(stepBack({...editor,searchOpen:true}).state.searchOpen,false);
  assert.equal(stepBack({...editor,searchOpen:true}).state.homeOpen,false);
});

test('lecture timeline and slides return to notes before home',()=>{
  const first=stepBack({homeOpen:false,mode:'lecture',lectureTab:'slides'});
  assert.equal(first.action,BACK.LECTURE_TAB);
  assert.equal(first.state.lectureTab,'notes');
  assert.equal(first.state.homeOpen,false);
  const second=stepBack(first.state);
  assert.equal(second.action,BACK.HOME);
});

test('the game tab inside the editor returns to the file, not home',()=>{
  const back=stepBack({...editor,loungeOpen:true,mode:'notepad'});
  assert.equal(back.action,BACK.EDITOR);
  assert.equal(back.state.loungeOpen,false);
  assert.equal(back.state.mode,'notepad');
  assert.equal(back.state.homeOpen,false);
});

test('a web module opened from home returns home',()=>{
  assert.equal(stepBack({homeOpen:false,mode:'cards',loungeOpen:false}).action,BACK.HOME);
});

test('repeated back goes home once, then asks to exit, and does not bounce into the editor',()=>{
  const run=repeatBack({...editor,mode:'ai'},5);
  assert.deepEqual(run.trace,['home','exit','exit','exit','exit']);
  assert.equal(run.state.homeOpen,true);
  assert.equal(run.state.exitRequested,true);
  assert.equal(run.state.mode,'ai');
  assert.equal(run.state.resumeMode,'ai');
});

test('cold-start home never falls through into a mode',()=>{
  const run=repeatBack({homeOpen:true,mode:''},3);
  assert.deepEqual(run.trace,['exit','exit','exit']);
  assert.equal(run.state.homeOpen,true);
  assert.equal(run.state.mode,'');
});

test('the tools directory returns to the workspace before exit',()=>{
  const run=repeatBack({homeOpen:true,catalogOpen:true},3);
  assert.deepEqual(run.trace,[BACK.CATALOG,BACK.EXIT,BACK.EXIT]);
  assert.equal(run.state.catalogOpen,false);
});

test('a tool first returns to the directory that opened it',()=>{
  const first=stepBack({homeOpen:false,catalogOpen:true,mode:'python'});
  assert.equal(first.action,BACK.HOME);
  assert.equal(first.state.catalogOpen,true);
  const second=stepBack(first.state);
  assert.equal(second.action,BACK.CATALOG);
  assert.equal(second.state.catalogOpen,false);
});

test('stacked layers dismiss one at a time before home and exit',()=>{
  const run=repeatBack({
    homeOpen:false,
    mode:'lecture',
    lectureTab:'timeline',
    dialogOpen:true,
    drawerOpen:true,
    drawing:true,
    searchOpen:true
  },8);
  assert.deepEqual(run.trace,[
    BACK.DIALOG,BACK.DRAWER,BACK.DRAW,BACK.SEARCH,BACK.LECTURE_TAB,BACK.HOME,BACK.EXIT,BACK.EXIT
  ]);
  assert.equal(run.state.homeOpen,true);
  assert.equal(run.state.lectureTab,'notes');
});

test('leaving for home keeps unsaved drafts and names files not written back',()=>{
  const files=[
    {path:'main.py',uri:'content://phone/main.py',text:'print(2)',savedText:'print(1)'},
    {path:'笔记.txt',uri:'',text:'新笔记',savedText:''},
    {path:'data.json',uri:'content://phone/data.json',text:'{}',savedText:'{}'}
  ];
  assert.deepEqual(unsavedOriginals(files),['main.py']);
  const left=leaveWork({mode:'python',files,activePath:'main.py'});
  assert.equal(left.keepDrafts,true);
  assert.equal(left.discardEdits,false);
  assert.equal(left.flush,true);
  assert.equal(left.files[0].text,'print(2)');
  assert.deepEqual(left.dirty,['main.py']);
  assert.match(exitCopy(files).message,/main\.py/);
  assert.match(exitCopy([]).message,/草稿会留在本机/);
  const card=resumeCard({mode:'python',activePath:'main.py',dirty:1,fromSession:true});
  assert.equal(card.visible,true);
  assert.equal(card.title,'继续写代码');
  assert.match(card.detail,/main\.py/);
  assert.match(card.detail,/还没写回/);
});

test('a blank resume is hidden and a saved mode can be continued',()=>{
  assert.equal(resumeCard({mode:''}).visible,false);
  assert.equal(resumeCard({mode:'notepad',activePath:'笔记.txt'}).title,'继续记事本');
  assert.equal(resumeCard({mode:'model'}).title,'继续 3D 建模');
  assert.equal(moduleAvailability('model',{}).ok,true);
});

test('the 3D model panel is a layer that closes before leaving the mode',()=>{
  const run=repeatBack({homeOpen:false,mode:'model',layers:['modelPanel']},3);
  assert.deepEqual(run.trace,[BACK.LAYER,BACK.HOME,BACK.EXIT]);
});

test('a dialog on top of the directory closes before the directory',()=>{
  const dialog=stepBack({dialogOpen:true,homeOpen:true,catalogOpen:true});
  assert.equal(dialog.action,BACK.DIALOG);
  assert.equal(dialog.state.dialogOpen,false);
  assert.equal(dialog.state.catalogOpen,true);
  const catalog=stepBack(dialog.state);
  assert.equal(catalog.action,BACK.CATALOG);
  assert.equal(catalog.state.catalogOpen,false);
  assert.equal(catalog.state.homeOpen,true);
});

test('Escape closes overlays but never navigates or exits',()=>{
  const cases=[
    {dialogOpen:true},
    {drawerOpen:true},
    {drawing:true},
    {searchOpen:true},
    {layers:['aiSettings'],mode:'ai'},
    {mode:'lecture',lectureTab:'timeline'},
    {homeOpen:true,catalogOpen:true}
  ];
  for(const ctx of cases)assert.equal(resolveEscapeBack(ctx).action,resolveBack(ctx).action);
  assert.deepEqual(resolveEscapeBack({homeOpen:true}),{action:null,decision:{action:BACK.EXIT}});
  assert.deepEqual(resolveEscapeBack({homeOpen:false,mode:'python'}),{action:null,decision:{action:BACK.HOME}});
  assert.deepEqual(resolveEscapeBack({homeOpen:false,mode:'python',loungeOpen:true}),{action:null,decision:{action:BACK.EDITOR}});
  assert.deepEqual(resolveEscapeBack({homeOpen:true,activeTab:'recent',tabDepth:1}),{action:null,decision:{action:BACK.TAB_PAGE}});
  assert.deepEqual(resolveEscapeBack({homeOpen:true,catalogOpen:true}),{action:BACK.CATALOG});
});

test('tab pages close before switching home and asking to exit',()=>{
  const run=repeatBack({homeOpen:true,activeTab:'recent',tabDepth:1},4);
  assert.deepEqual(run.trace.slice(0,3),[BACK.TAB_PAGE,BACK.TAB_HOME,BACK.EXIT]);
  assert.equal(run.state.activeTab,'home');
  assert.equal(run.state.tabDepth,0);
});

test('an open module uses the real tab stack before falling back home',()=>{
  assert.equal(resolveBack({moduleOpen:true,tabDepth:1,mode:'python'}).action,BACK.TAB_PAGE);
  assert.equal(resolveBack({moduleOpen:true,tabDepth:0,mode:'python'}).action,BACK.HOME);
});

test('mode changes protect a recording and a running program',()=>{
  assert.equal(canLeaveMode({recording:true,to:'notepad'}).ok,false);
  assert.equal(canLeaveMode({recording:true,to:'home'}).ok,true);
  assert.equal(canLeaveMode({running:true,to:'ai'}).ok,false);
  assert.equal(canLeaveMode({running:true,to:'lecture'}).ok,false);
  assert.equal(canLeaveMode({running:true,to:'game'}).ok,true);
  assert.equal(canLeaveMode({to:'python'}).flush,true);
  assert.equal(canLeaveMode({running:true,to:'scan'}).ok,false);
  assert.equal(canLeaveMode({running:true,to:'model'}).ok,false);
  assert.equal(canLeaveMode({recording:true,to:'photo'}).ok,false);
});

test('missing context does not throw and still resolves to a known action',()=>{
  assert.doesNotThrow(()=>resolveBack());
  assert.doesNotThrow(()=>stepBack());
  assert.equal(resolveBack().action,BACK.HOME);
  assert.equal(resolveBack({homeOpen:true,dialogOpen:undefined,drawerOpen:null}).action,BACK.EXIT);
});
