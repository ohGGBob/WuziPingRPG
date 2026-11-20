import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeekBoard,WEEKBOARD_TIMES,weekDates,weekSlotForMinute} from '../src/weekboard.js';

const date=new Date('2026-11-19T12:00:00+08:00');
const schedule={
  termStart:'2026-09-01',
  nextId:4,
  courses:[
    {id:1,name:'高数',place:'A101',teacher:'张老师',day:4,start:1,len:2,color:0,weeks:[]},
    {id:2,name:'晚课',place:'B202',teacher:'',day:4,start:9,len:1,color:2,weeks:[]},
    {id:3,name:'周六实验',place:'C303',teacher:'',day:6,start:3,len:1,color:3,weeks:[]}
  ]
};

test('weekboard exposes seven fixed display times and seven weekday dates',()=>{
  assert.deepEqual(WEEKBOARD_TIMES,[480,600,840,960,1080,1140,1200]);
  const days=weekDates(date,12);
  assert.equal(days.length,7);
  assert.equal(days[0].day,1);
  assert.equal(days[6].day,7);
});

test('weekboard maps courses to the display row and marks today',()=>{
  const board=buildWeekBoard(schedule,{now:date,weekOffset:0});
  assert.equal(board.week,12);
  assert.equal(board.days.length,7);
  assert.equal(board.days[3].today,true);
  assert.equal(board.days[3].courses.find(c=>c.name==='高数').slot,0);
  assert.equal(board.days[3].courses.find(c=>c.name==='晚课').slot,5);
});

test('weekend and evening settings filter columns and courses',()=>{
  const noWeekend=buildWeekBoard(schedule,{now:date,showWeekend:false});
  assert.equal(noWeekend.days.length,5);
  const noEvening=buildWeekBoard(schedule,{now:date,showEvening:false});
  assert.equal(noEvening.days[3].courses.some(c=>c.name==='晚课'),false);
});

test('week offset changes the week without changing today identity',()=>{
  const next=buildWeekBoard(schedule,{now:date,weekOffset:1});
  assert.equal(next.week,13);
  assert.equal(next.days.some(day=>day.today),false);
  assert.equal(next.days[0].date,23);
  assert.equal(next.days[0].month,11);
  const prev=buildWeekBoard(schedule,{now:date,weekOffset:-1});
  assert.equal(prev.week,11);
  assert.equal(prev.days[0].date,9);
});

test('week offset keeps dates correct across month and year boundaries',()=>{
  const month=buildWeekBoard({...schedule,termStart:'2026-11-01'},{now:new Date('2026-12-30T12:00:00+08:00'),weekOffset:1});
  assert.deepEqual(month.days.slice(0,2).map(day=>[day.month,day.date]),[[1,4],[1,5]]);
  const year=buildWeekBoard({...schedule,termStart:'2026-12-01'},{now:new Date('2026-12-31T12:00:00+08:00'),weekOffset:1});
  assert.deepEqual(year.days.slice(0,2).map(day=>[day.month,day.date]),[[1,4],[1,5]]);
});

test('evening rows and annotation follow the setting',()=>{
  const shown=buildWeekBoard(schedule,{now:date,showEvening:true});
  assert.equal(shown.slots.length,7);
  assert.equal(shown.slots.find(slot=>slot.eveningLabel).label,'18:00');
  const hidden=buildWeekBoard(schedule,{now:date,showEvening:false});
  assert.equal(hidden.slots.length,4);
  assert.equal(hidden.slots.some(slot=>slot.evening),false);
});

test('12:00 ties resolve to the later display slot',()=>{
  assert.equal(weekSlotForMinute(720),2);
  assert.equal(WEEKBOARD_TIMES[weekSlotForMinute(720)],840);
});
