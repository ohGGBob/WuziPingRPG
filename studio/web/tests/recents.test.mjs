import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENTS_LIMIT,sanitizeRecent,sanitizeRecents,upsertRecent,removeRecent,
  togglePinned,renameRecent,recentGroup,groupRecents,formatForPath
} from '../src/recents.js';

const now=new Date('2026-11-20T12:00:00+08:00').getTime();
const item=(overrides={})=>({source:'code',path:'main.py',title:'main.py',openedAt:now,...overrides});

test('recents dedupe by source and path or uri',()=>{
  const list=sanitizeRecents([item(),item({title:'new'}),item({path:'',uri:'content://a',title:'A'}),item({path:'',uri:'content://a',title:'B'})]);
  assert.equal(list.length,2);
  assert.equal(list[0].title,'main.py');
  assert.equal(list[1].title,'A');
});

test('upsert moves an existing item to the front without duplicating it',()=>{
  const old=[item({title:'old',openedAt:now-1000}),item({path:'other.py'})];
  const next=upsertRecent(old,item({title:'fresh',openedAt:now}),now);
  assert.equal(next.length,2);
  assert.equal(next[0].title,'fresh');
  assert.equal(next.filter(x=>x.path==='main.py').length,1);
});

test('recents cap at 200 newest entries',()=>{
  const rows=Array.from({length:RECENTS_LIMIT+25},(_,i)=>item({path:'f-'+i+'.py',openedAt:now-i}));
  const list=sanitizeRecents(rows);
  assert.equal(list.length,RECENTS_LIMIT);
  assert.equal(list[0].path,'f-0.py');
  assert.equal(list.at(-1).path,'f-199.py');
});

test('pinning rename and removal keep list sanitized',()=>{
  let list=sanitizeRecents([item({title:'a'}),item({path:'b.py',title:'b'})]);
  list=togglePinned(list,list[0].id);
  assert.equal(list[0].pinned,true);
  list=renameRecent(list,list[0].id,'  新标题  ');
  assert.equal(list[0].title,'新标题');
  list=removeRecent(list,list[0].id);
  assert.equal(list.length,1);
});

test('time, source and format grouping use stable labels',()=>{
  const rows=[item({source:'code',format:'note',openedAt:now}),item({source:'scan',path:'a.pdf',format:'document',openedAt:now-86400000})];
  assert.equal(recentGroup(rows[0],now),'today');
  assert.equal(recentGroup(rows[1],now),'yesterday');
  assert.deepEqual(groupRecents(rows,'time',now).map(g=>g.title),['今天','昨天']);
  assert.deepEqual(groupRecents(rows,'source',now).map(g=>g.title),['代码','扫描']);
  assert.deepEqual(groupRecents(rows,'format',now).map(g=>g.title),['笔记','文档']);
});

test('format inference and malformed recents are safe',()=>{
  assert.equal(formatForPath('slides.pptx'),'slides');
  assert.equal(formatForPath('photo.jpg'),'image');
  assert.equal(formatForPath('voice.mp3'),'audio');
  assert.equal(formatForPath('notes.md'),'note');
  assert.equal(sanitizeRecent(null),null);
  assert.deepEqual(sanitizeRecents('bad'),[]);
});

test('pinned entries survive the 200 item cap',()=>{
  const rows=Array.from({length:RECENTS_LIMIT+5},(_,i)=>item({path:'f-'+i+'.py',openedAt:now-i,pinned:i===RECENTS_LIMIT+4}));
  const list=sanitizeRecents(rows);
  assert.equal(list.length,RECENTS_LIMIT);
  assert.equal(list.some(entry=>entry.path==='f-204.py'&&entry.pinned),true);
});

test('all material sources and citation payload survive sanitization',()=>{
  for(const source of ['lecture','scan','photo','ai']){
    const entry=sanitizeRecent(item({source,path:'',uri:source+':1',payload:{kind:'page',value:2.34,label:'第 2 页',slideIndex:1}}));
    assert.equal(entry.source,source);
    assert.deepEqual(entry.payload,{kind:'page',value:2.3,label:'第 2 页',slideIndex:1});
  }
});

test('upsert preserves pinned status and a user renamed title',()=>{
  let list=sanitizeRecents([item({path:'main.py',title:'main.py'})]);
  const id=list[0].id;
  list=togglePinned(list,id);
  list=renameRecent(list,id,'我的入口');
  list=upsertRecent(list,item({path:'main.py',title:'main.py',openedAt:now+10}),now+10);
  assert.equal(list.length,1);
  assert.equal(list[0].pinned,true);
  assert.equal(list[0].title,'我的入口');
  assert.equal(list[0].customTitle,true);
});

test('stable module recents merge without adding duplicate rows',()=>{
  let list=[];
  list=upsertRecent(list,{source:'scan',uri:'module:scan',title:'扫描文档',format:'document'},now);
  list=upsertRecent(list,{source:'scan',uri:'module:scan',title:'扫描文档',format:'document'},now+1);
  assert.equal(list.length,1);
});

test('later empty metadata does not erase a successful recent',()=>{
  let list=upsertRecent([],{source:'scan',uri:'module:scan',title:'扫描.pdf',format:'document',size:2048,pages:3},now);
  list=upsertRecent(list,{source:'scan',uri:'module:scan',title:'扫描.pdf',format:'document',size:0,pages:0},now+1);
  assert.equal(list[0].size,2048);
  assert.equal(list[0].pages,3);
});
