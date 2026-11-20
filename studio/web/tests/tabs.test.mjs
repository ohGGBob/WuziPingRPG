import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTabState,sanitizeTabState,selectTab,openTabPage,closeTabPage,
  rememberTabScroll,resolveTabBack,reselectTab,tabDepth
} from '../src/tabs.js';

test('tabs keep independent stacks and scroll positions',()=>{
  let state=defaultTabState();
  state=openTabPage(state,'recent-detail','recent');
  state=openTabPage(state,'profile-settings','profile');
  state=rememberTabScroll(state,320,'recent');
  state=rememberTabScroll(state,90,'profile');
  assert.equal(tabDepth(state,'recent'),1);
  assert.equal(tabDepth(state,'profile'),1);
  assert.equal(state.scroll.recent,320);
  assert.equal(state.scroll.profile,90);
  assert.equal(tabDepth(state,'home'),0);
});

test('switching tabs preserves each stack',()=>{
  let state=defaultTabState();
  state=openTabPage(state,'recent-detail','recent');
  state=selectTab(state,'home');
  assert.equal(state.activeTab,'home');
  assert.equal(tabDepth(state,'recent'),1);
  state=selectTab(state,'recent');
  assert.equal(tabDepth(state,'recent'),1);
});

test('back closes page, then moves non-home tab to home, then exits',()=>{
  let state=defaultTabState('recent');
  state=openTabPage(state,'detail','recent');
  const page=resolveTabBack(state);
  assert.equal(page.action,'page');
  assert.equal(page.page,'');
  const home=resolveTabBack(page.state);
  assert.equal(home.action,'home');
  assert.equal(home.state.activeTab,'home');
  assert.equal(resolveTabBack(home.state).action,'exit');
});

test('reselect returns a tab to its root and reports top on a second tap',()=>{
  let state=defaultTabState('recent');
  state=openTabPage(state,'detail','recent');
  const root=reselectTab(state,'recent');
  assert.equal(root.action,'root');
  assert.equal(tabDepth(root.state,'recent'),0);
  assert.equal(reselectTab(root.state,'recent').action,'top');
});

test('tab state sanitizes missing and malformed fields',()=>{
  const state=sanitizeTabState({activeTab:'bad',stacks:{home:['a','a',null,7]},scroll:{home:-4,recent:'12px'}});
  assert.equal(state.activeTab,'home');
  assert.deepEqual(state.stacks.home,['a','a']);
  assert.equal(state.scroll.home,0);
  assert.equal(state.scroll.recent,0);
  assert.doesNotThrow(()=>closeTabPage(null,'recent'));
});
