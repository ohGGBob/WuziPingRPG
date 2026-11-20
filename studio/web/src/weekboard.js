import {DAYS,PERIODS,scheduleSanitize,coursesOnDay,nowInfo,currentStatus,fmtMin} from './schedule.js';

export const WEEKBOARD_TIMES=[480,600,840,960,1080,1140,1200];
export const WEEKBOARD_LABELS=['08:00','10:00','14:00','16:00','18:00','19:00','20:00'];

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const minuteOf=course=>{
  const period=PERIODS[clamp(Number(course&&course.start)||1,1,PERIODS.length)-1];
  return period?period[0]:WEEKBOARD_TIMES[0];
};

export function weekSlotForMinute(minute){
  let best=0;
  for(let i=1;i<WEEKBOARD_TIMES.length;i++){
    /* 等距时选择后一个时段，避免 12:00 被误显示成 10:00。 */
    if(Math.abs(WEEKBOARD_TIMES[i]-minute)<=Math.abs(WEEKBOARD_TIMES[best]-minute))best=i;
  }
  return best;
}
function slotFor(course){return weekSlotForMinute(minuteOf(course));}

let activeDetailCleanup=null;

export function weekDates(now,currentWeek=1,week=currentWeek){
  const base=now instanceof Date?new Date(now):new Date(now||Date.now());
  const day=((base.getDay()+6)%7)+1;
  base.setHours(0,0,0,0);
  base.setDate(base.getDate()-day+1+(Number(week)-Number(currentWeek))*7);
  return DAYS.map((name,index)=>{
    const date=new Date(base);
    date.setDate(base.getDate()+index);
    return {
      day:index+1,
      name,
      month:date.getMonth()+1,
      date:date.getDate(),
      key:date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'),
      week
    };
  });
}

export function buildWeekBoard(schedule,{now=Date.now(),weekOffset=0,showWeekend=true,showEvening=true}={}){
  const sched=scheduleSanitize(schedule);
  const info=nowInfo(now,sched.termStart);
  const week=clamp(info.week+(Number(weekOffset)||0),1,30);
  const dates=weekDates(now,info.week,week);
  const days=dates.filter(day=>showWeekend||day.day<=5).map(day=>{
    const courses=coursesOnDay(sched,day.day,week)
      .filter(course=>showEvening||minuteOf(course)<1080)
      .map(course=>({...course,slot:slotFor(course),minute:minuteOf(course)}));
    return {...day,today:day.day===info.day&&week===info.week,courses};
  });
  return {
    week,
    currentWeek:info.week,
    today:info.day,
    days,
    slots:WEEKBOARD_TIMES
      .map((minute,index)=>({minute,label:WEEKBOARD_LABELS[index],evening:minute>=1080,eveningLabel:index===4}))
      .filter(slot=>showEvening||!slot.evening),
    status:currentStatus(sched,info)
  };
}

function el(doc,tag,className,text){
  const node=doc.createElement(tag);
  if(className)node.className=className;
  if(text!=null)node.textContent=text;
  return node;
}

export function renderWeekBoard(container,{
  state,open,weekOffset=0,onToggle,onWeekOffset,onOpenCourse,onEdit
}){
  if(activeDetailCleanup){activeDetailCleanup();activeDetailCleanup=null;}
  const doc=container.ownerDocument;
  const ui=state&&state.ui?state.ui:{};
  const settings=ui.homeSettings||{};
  const model=buildWeekBoard(state&&state.schedule,{
    weekOffset,
    showWeekend:settings.showWeekend!==false,
    showEvening:settings.showEvening!==false
  });
  const board=el(doc,'section','weekboard');
  board.id='weekBoard';
  board.dataset.open=open?'1':'0';
  const head=el(doc,'div','weekboard-head');
  const toggle=el(doc,'button','weekboard-title');
  toggle.type='button';
  toggle.setAttribute('aria-expanded',open?'true':'false');
  toggle.setAttribute('aria-controls','weekBoardBody');
  toggle.append(el(doc,'strong','','本周课表'),el(doc,'small','','第 '+model.week+' 周 · '+(model.status.now?model.status.now.name:model.status.next?'下一节 '+model.status.next.course.name:'暂无课程')));
  const arrow=el(doc,'button','weekboard-arrow',open?'⌃':'⌄');
  arrow.type='button';
  arrow.setAttribute('aria-label',open?'收起本周课表':'展开本周课表');
  const flip=()=>onToggle&&onToggle(!open);
  toggle.onclick=flip;arrow.onclick=flip;
  head.append(toggle,arrow);
  board.append(head);

  const mini=el(doc,'div','weekboard-mini');
  mini.setAttribute('aria-label','本周每天课程数量');
  for(const day of model.days){
    const item=el(doc,'span','weekboard-mini-day'+(day.today?' today':''));
    item.append(el(doc,'b','',day.name.slice(-1)),el(doc,'small','',String(day.courses.length)));
    item.setAttribute('aria-label',day.name+' '+day.courses.length+' 节课');
    mini.append(item);
  }
  board.append(mini);

  const body=el(doc,'div','weekboard-body');
  body.id='weekBoardBody';
  const nav=el(doc,'div','weekboard-nav');
  const prev=el(doc,'button','','‹ 上一周');prev.type='button';prev.onclick=()=>onWeekOffset&&onWeekOffset(-1);
  const current=el(doc,'button','current','回到本周');current.type='button';current.onclick=()=>onWeekOffset&&onWeekOffset(0);
  const next=el(doc,'button','','下一周 ›');next.type='button';next.onclick=()=>onWeekOffset&&onWeekOffset(1);
  nav.append(prev,el(doc,'strong','','第 '+model.week+' 周'),next,current);
  body.append(nav);

  const grid=el(doc,'div','weekboard-grid');
  grid.style.setProperty('--week-cols',String(model.days.length));
  const corner=el(doc,'span','weekboard-corner','时间');
  corner.style.gridColumn='1';corner.style.gridRow='1';grid.append(corner);
  model.days.forEach((day,index)=>{
    const headCell=el(doc,'span','weekboard-dayhead'+(day.today?' today':''));
    headCell.style.gridColumn=String(index+2);headCell.style.gridRow='1';
    headCell.setAttribute('aria-label',day.name+' '+day.month+'月'+day.date+'日');
    headCell.append(el(doc,'b','',day.today?day.name.slice(-1)+' '+day.date:day.name.slice(-1)),el(doc,'small','',day.month+'/'+day.date));
    grid.append(headCell);
  });
  model.slots.forEach((slot,row)=>{
    const label=el(doc,'span','weekboard-time'+(slot.evening?' evening':''));
    label.append(el(doc,'span','',slot.label));
    if(slot.eveningLabel)label.append(el(doc,'small','weekboard-evening-label','晚间'));
    label.style.gridColumn='1';label.style.gridRow=String(row+2);grid.append(label);
    model.days.forEach((day,col)=>{
      const cell=el(doc,'span','weekboard-cell'+(day.today?' today':'')+(slot.evening?' evening':''));
      cell.style.gridColumn=String(col+2);cell.style.gridRow=String(row+2);grid.append(cell);
    });
    for(const day of model.days){
      const col=model.days.indexOf(day);
      for(const course of day.courses.filter(c=>c.slot===row)){
        const block=el(doc,'button','weekboard-course'+(day.today?' today':''));
        block.type='button';
        block.style.gridColumn=String(col+2);block.style.gridRow=String(row+2);
        block.style.setProperty('--course-color',['#e05545','#f6a13c','#c7a24b','#4f8f7b','#2fd4bf','#5b8cff','#8a6fc0','#ff5dc8'][course.color]||'#4f8f7b');
        block.setAttribute('aria-label',day.name+' '+WEEKBOARD_LABELS[row]+' '+course.name+(course.place?' '+course.place:''));
        block.append(el(doc,'small','',WEEKBOARD_LABELS[row]),el(doc,'strong','',course.name),el(doc,'span','',course.place||course.teacher||''));
        block.onclick=()=>{
          const detail=el(doc,'div','weekboard-detail');
          detail.setAttribute('role','region');
          detail.setAttribute('aria-label',course.name+'课程详情');
          detail.append(el(doc,'strong','',course.name),el(doc,'span','',fmtMin(minuteOf(course))+' · '+(course.place||'地点待定')+' · '+(course.teacher||'教师待定')));
          if(course.note)detail.append(el(doc,'small','',course.note));
          const actions=el(doc,'div','weekboard-detail-actions');
          const dayBtn=el(doc,'button','','查看当天');dayBtn.type='button';dayBtn.onclick=()=>onOpenCourse&&onOpenCourse(day.day);
          const editBtn=el(doc,'button','primary','编辑课表');editBtn.type='button';editBtn.onclick=()=>onEdit&&onEdit(course.id);
          if(activeDetailCleanup){activeDetailCleanup();activeDetailCleanup=null;}
          const close=el(doc,'button','weekboard-detail-close','✕');
          close.type='button';close.setAttribute('aria-label','关闭课程详情');
          const clearDetail=()=>{
            if(activeDetailCleanup===clearDetail)activeDetailCleanup=null;
            doc.removeEventListener('pointerdown',outside,true);
            detail.remove();
          };
          const outside=e=>{if(!detail.contains(e.target))clearDetail();};
          close.onclick=clearDetail;
          actions.append(dayBtn,editBtn,close);detail.append(actions);
          const old=board.querySelector('.weekboard-detail');if(old)old.remove();board.append(detail);
          doc.addEventListener('pointerdown',outside,true);
          activeDetailCleanup=clearDetail;
        };
        grid.append(block);
      }
    }
  });
  body.append(grid);
  board.append(body);
  return board;
}
