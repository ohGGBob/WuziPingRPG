import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultUi,sanitizeUi} from '../src/state.js';

test('timetable default remains unchecked unless explicitly true',()=>{
  assert.equal(defaultUi().homeSettings.timetableDefaultOpen,false);
  assert.equal(sanitizeUi({}).homeSettings.timetableDefaultOpen,false);
  assert.equal(sanitizeUi({homeSettings:{}}).timetableOpen,false);
});

test('AI handle enabled state has a single source in home settings',()=>{
  const off=sanitizeUi({homeSettings:{aiHandle:false},aiHandle:{enabled:true,yRatio:.5}});
  assert.equal(off.homeSettings.aiHandle,false);
  assert.equal('enabled' in off.aiHandle,false);
  assert.equal(off.aiHandle.yRatio,.5);
  const on=sanitizeUi({homeSettings:{aiHandle:true},aiHandle:{enabled:false,yRatio:99}});
  assert.equal(on.homeSettings.aiHandle,true);
  assert.equal(on.aiHandle.yRatio,.9);
});
