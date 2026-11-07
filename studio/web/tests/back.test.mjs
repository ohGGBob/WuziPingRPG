import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACK, HOME_ACTIONS, resolveBack, stepBack, repeatBack,
  unsavedOriginals, leaveWork, exitCopy, resumeCard, canLeaveMode
} from '../src/back.js';

const editor={homeOpen:false,mode:'python',dialogOpen:false,drawerOpen:false,drawing:false,searchOpen:false,loungeOpen:false,lectureTab:'notes'};

test('common actions come before the rest and every mode has a Chinese name',()=>{
  const common=HOME_ACTIONS.filter(item=>item.group==='common').map(item=>item.id);
  assert.deepEqual(common,['python','notepad','ai']);
  assert.deepEqual(HOME_ACTIONS.map(item=>item.id),['python','notepad','ai','lecture','tts','game']);
  for(const item of HOME_ACTIONS){
    assert.ok(item.title.length>=2,item.id);
    assert.ok(item.resume.startsWith('继续'),item.id);
  }
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

test('game opened from home returns home',()=>{
  assert.equal(stepBack({homeOpen:false,mode:'game',loungeOpen:true}).action,BACK.HOME);
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
  assert.equal(card.title,'继续写 Python');
  assert.match(card.detail,/main\.py/);
  assert.match(card.detail,/还没写回/);
});

test('a blank resume is hidden and a saved mode can be continued',()=>{
  assert.equal(resumeCard({mode:''}).visible,false);
  assert.equal(resumeCard({mode:'notepad',activePath:'笔记.txt'}).title,'继续记事本');
});

test('mode changes protect a recording and a running program',()=>{
  assert.equal(canLeaveMode({recording:true,to:'notepad'}).ok,false);
  assert.equal(canLeaveMode({recording:true,to:'home'}).ok,true);
  assert.equal(canLeaveMode({running:true,to:'ai'}).ok,false);
  assert.equal(canLeaveMode({running:true,to:'lecture'}).ok,false);
  assert.equal(canLeaveMode({running:true,to:'game'}).ok,true);
  assert.equal(canLeaveMode({to:'python'}).flush,true);
});

test('missing context does not throw and still resolves to a known action',()=>{
  assert.doesNotThrow(()=>resolveBack());
  assert.doesNotThrow(()=>stepBack());
  assert.equal(resolveBack().action,BACK.HOME);
  assert.equal(resolveBack({homeOpen:true,dialogOpen:undefined,drawerOpen:null}).action,BACK.EXIT);
});
