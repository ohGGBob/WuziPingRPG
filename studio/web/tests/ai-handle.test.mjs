import test from 'node:test';
import assert from 'node:assert/strict';
import {AI_HANDLE_HEIGHT,handleTop,handleRatio,handleOffset,planHandleGesture,bindAiHandle} from '../src/ai-handle.js';

test('handle position clamps inside the usable right edge range',()=>{
  assert.equal(handleTop(0,844),140);
  assert.equal(handleTop(1,844),682);
  assert.equal(handleTop(0.43,844),293.26);
  assert.ok(handleTop(1,400)+AI_HANDLE_HEIGHT<=400);
});

test('handle ratio round-trips within bounds',()=>{
  const top=handleTop(0.6,844);
  assert.ok(Math.abs(handleTop(handleRatio(top,844),844)-top)<0.01);
  assert.ok(handleRatio(-2,844)>=0);
  assert.ok(handleRatio(9999,844)<=1);
});

test('gesture locks axis and opens only after left drag threshold',()=>{
  assert.equal(planHandleGesture({dx:-72,dy:10}).action,'open');
  assert.equal(planHandleGesture({dx:-71,dy:10}).action,'cancel');
  assert.equal(planHandleGesture({dx:80,dy:5}).action,'cancel');
  assert.equal(planHandleGesture({dx:-30,dy:80}).action,'drag');
  assert.equal(planHandleGesture({dx:2,dy:2}).action,'open');
});

test('handle follows left drag and clamps before release',()=>{
  assert.equal(handleOffset(-30),-30);
  assert.equal(handleOffset(20),0);
  assert.equal(handleOffset(-200),-96);
  assert.equal(handleOffset('bad'),0);
});

test('Enter and Space activate the focused handle',()=>{
  const listeners=new Map(),hint={hidden:true,textContent:'',style:{}};
  const label={textContent:'AI'};
  const element={
    style:{},dataset:{},
    ownerDocument:{getElementById:()=>hint},
    querySelector:()=>label,
    addEventListener(type,fn){listeners.set(type,fn);},
    setPointerCapture(){}
  };
  let opened=0;
  bindAiHandle(element,{getViewportHeight:()=>844,onOpen:()=>opened++});
  listeners.get('keydown')({key:'Enter',preventDefault(){}});
  listeners.get('keydown')({key:' ',preventDefault(){}});
  assert.equal(opened,2);
});
