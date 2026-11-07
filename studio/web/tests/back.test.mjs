import test from 'node:test';
import assert from 'node:assert/strict';
import {BACK,resolveBack} from '../src/back.js';

const base={
  dialogOpen:false,
  drawerOpen:false,
  drawing:false,
  searchOpen:false,
  landingOpen:false,
  now:10000
};

test('dialog has priority over every other layer',()=>{
  assert.deepEqual(resolveBack({...base,dialogOpen:true,drawerOpen:true,drawing:true,searchOpen:true,landingOpen:true}),{
    action:BACK.DIALOG,
    nextLastBackAt:0
  });
});

test('drawer has priority over draw, search and landing',()=>{
  assert.deepEqual(resolveBack({...base,drawerOpen:true,drawing:true,searchOpen:true,landingOpen:true}),{
    action:BACK.DRAWER,
    nextLastBackAt:0
  });
});

test('drawing has priority over search and landing',()=>{
  assert.equal(resolveBack({...base,drawing:true,searchOpen:true,landingOpen:true}).action,BACK.DRAW);
});

test('search has priority over landing',()=>{
  assert.equal(resolveBack({...base,searchOpen:true,landingOpen:true}).action,BACK.SEARCH);
});

test('open landing passes control to the native exit prompt',()=>{
  assert.deepEqual(resolveBack({...base,now:10000,landingOpen:true}),{
    action:BACK.PASS,
    nextLastBackAt:0
  });
});

test('editor back opens the landing screen',()=>{
  assert.deepEqual(resolveBack({...base,now:10000}),{
    action:BACK.LANDING,
    nextLastBackAt:10000
  });
});

test('editor then landing requires exactly two backs to request exit',()=>{
  const first=resolveBack({...base,now:10000});
  const second=resolveBack({...base,now:10001,landingOpen:true});
  assert.equal(first.action,BACK.LANDING);
  assert.equal(second.action,BACK.PASS);
});

test('legacy timing fields cannot turn home into a previous-screen pop',()=>{
  assert.deepEqual(resolveBack({...base,now:10000,landingOpen:true,lastBackAt:9000,doubleWindowMs:2000}),{
    action:BACK.PASS,
    nextLastBackAt:0
  });
});

test('missing or undefined context fields do not throw',()=>{
  assert.doesNotThrow(()=>resolveBack());
  assert.doesNotThrow(()=>resolveBack({dialogOpen:undefined,drawerOpen:null,drawing:undefined,searchOpen:null,landingOpen:undefined,now:undefined}));
  assert.equal(typeof resolveBack().action,'string');
});
