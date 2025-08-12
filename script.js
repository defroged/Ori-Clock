// script.js

/* ===== Utilities ===== */
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const pad2 = n => n.toString().padStart(2,'0');

function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; } // inclusive
function choice(arr){return arr[Math.floor(Math.random()*arr.length)];}
function clamp(v,min,max){return Math.max(min, Math.min(max, v));}

function to12h(h){ const hour = h%12===0?12:h%12; const am = h<12; return {hour, am}; }
function jTime(h24, m, useAMPM=false, useColloquial=true){
  let ampm = '';
  let h = h24;
  if(useAMPM){
    const t = to12h(h24);
    ampm = t.am ? '午前' : '午後';
    h = t.hour;
  }
  let body = '';
  if(useColloquial && m===0) body = `${h}時ちょうど`;
  else if(useColloquial && m===30) body = `${h}時半`;
  else body = `${h}時${m}分`;
  return (ampm? ampm : '') + body;
}
function minuteSnapByLevel(level){
  if(level==1) return 30;
  if(level==2) return 5;
  return 1;
}

/* ===== State ===== */
const state = {
  mode:'read', // 'read' | 'set' | 'elapsed'
  level:1,
  useAmPm:false,
  showNums:true,
  hint5:true,
  target:{h:3, m:30},      // 出題
  targetDelta:0,           // 経過分
  score:0, streak:0, total:0, correct:0,
  clock:{h:3, m:30},       // 表示中の針（setモード）
  dragging:false,
};

/* ===== Build ticks & numbers ===== */
(function buildClockFace(){
  const ticks = $('#ticks');
  const nums  = $('#nums');
  for(let i=0;i<60;i++){
    const angle = i*6*Math.PI/180;
    const cx=160, cy=160;
    const rOuter = 150;
    const isHour = i%5===0;
    const len = isHour? 16 : 8;
    const r1 = rOuter - len;
    const x1 = cx + r1 * Math.sin(angle);
    const y1 = cy - r1 * Math.cos(angle);
    const x2 = cx + rOuter * Math.sin(angle);
    const y2 = cy - rOuter * Math.cos(angle);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x1); line.setAttribute('y1',y1);
    line.setAttribute('x2',x2); line.setAttribute('y2',y2);
    line.setAttribute('class','tick '+(isHour?'hour':'min'));
    ticks.appendChild(line);
  }
  for(let n=1;n<=12;n++){
    const angle = (n%12)*30*Math.PI/180;
    const cx=160, cy=160, r=120;
    const x = cx + r * Math.sin(angle);
    const y = cy - r * Math.cos(angle);
    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x',x); t.setAttribute('y',y); t.setAttribute('class','num');
    t.textContent = n;
    nums.appendChild(t);
  }
})();

/* ===== Clock rendering (SVG transform fix) ===== */
function setHands(h24, m){
  const hourDeg = ((h24%12)*30) + (m*0.5);
  const minDeg  = m*6;
  // Rotate around (160,160) which is the true center inside the <g> group
  $('#hourHand').setAttribute('transform', `rotate(${hourDeg} 160 160)`);
  $('#minHand').setAttribute('transform',  `rotate(${minDeg} 160 160)`);
}
function applyHints(){
  const svg = $('#clockSvg');
  svg.classList.toggle('hint-none', !state.showNums && !state.hint5);
  svg.classList.toggle('hint-nums', state.showNums);
  svg.classList.toggle('hint-5', state.hint5);
}

/* ===== Random time generators by level ===== */
function genTime(level, allowAllHours=true){
  const h = allowAllHours ? randInt(0,23) : randInt(1,12);
  let m=0;
  if(level===1){ m = choice([0,30]); }
  else if(level===2){ m = randInt(0,11)*5; }
  else { m = randInt(0,59); }
  return {h, m};
}
function genDelta(level){
  if(level===1) return choice([30,60,90,120]);
  if(level===2) return choice([5,10,15,20,25,30,35,40,45,50,55,60]);
  return randInt(3,120);
}
function addMinutes(h24,m,delta){
  let total = h24*60 + m + delta;
  total = ((total%1440)+1440)%1440;
  return {h: Math.floor(total/60), m: total%60};
}

/* ===== Challenges ===== */
function newChallenge(){
  $('#choices').innerHTML='';
  $('#tinyMsg').textContent='';
  $('#showAnsBtn').disabled = true;
  $('#replayBtn').disabled = true;

  if(state.mode==='read'){
    state.target = genTime(state.level, true);
    setHands(state.target.h, state.target.m);
    $('#prompt').textContent = 'この とけいは なんじ なんぷん？（正しいよみかたを えらんでね）';
    buildChoicesForRead();
  }else if(state.mode==='set'){
    state.target = genTime(state.level, true);
    const t = jTime(state.target.h, state.target.m, state.useAmPm, true);
    $('#prompt').textContent = `お題： ${t} にぴったり あわせてみよう。分針（長い針）をドラッグしてね。`;
    state.clock = genTime(3,true);
    setHands(state.clock.h, state.clock.m);
    $('#showAnsBtn').disabled = false;
    $('#replayBtn').disabled = false;
  }else if(state.mode==='elapsed'){
    state.target = genTime(state.level, true);
    state.targetDelta = genDelta(state.level);
    const q = state.useAmPm ? jTime(state.target.h,state.target.m,true,true)
                            : jTime(state.target.h,state.target.m,false,true);
    $('#prompt').textContent = `${q} から ${state.targetDelta}分 あと（ご）は なんじなんぷん？`;
    setHands(state.target.h, state.target.m);
    buildChoicesForElapsed();
  }
}

function buildChoicesForRead(){
  const correct = jTime(state.target.h, state.target.m, state.useAmPm, true);
  const set = new Set([correct]);
  while(set.size<4){
    const d = genTime(state.level,true);
    set.add( jTime(d.h,d.m, state.useAmPm, true) );
  }
  const list = Array.from(set).sort(()=>Math.random()-0.5);
  const box = $('#choices');
  for(const label of list){
    const b = document.createElement('button');
    b.className='choice';
    b.textContent = label;
    b.onclick = () => {
      const ok = label===correct;
      onAnswer(ok);
      b.classList.add(ok?'correct':'wrong');
      for(const c of $$('.choice')) if(c.textContent===correct) c.classList.add('correct');
      disableChoices();
    };
    box.appendChild(b);
  }
}
function buildChoicesForElapsed(){
  const ans = addMinutes(state.target.h, state.target.m, state.targetDelta);
  const correct = jTime(ans.h, ans.m, state.useAmPm, true);
  const set = new Set([correct]);
  while(set.size<4){
    const offset = choice([-20,-15,-10,-5,5,10,15,20,25,30]);
    const d = addMinutes(state.target.h, state.target.m, state.targetDelta + offset);
    set.add( jTime(d.h, d.m, state.useAmPm, true) );
  }
  const list = Array.from(set).sort(()=>Math.random()-0.5);
  const box = $('#choices'); box.innerHTML='';
  for(const label of list){
    const b = document.createElement('button');
    b.className='choice';
    b.textContent = label;
    b.onclick = () => {
      const ok = label===correct;
      onAnswer(ok);
      b.classList.add(ok?'correct':'wrong');
      for(const c of $$('.choice')) if(c.textContent===correct) c.classList.add('correct');
      disableChoices();
    };
    box.appendChild(b);
  }
}
function disableChoices(){
  for(const c of $$('.choice')) c.disabled=true;
  $('#replayBtn').disabled = false;
}

/* ===== Scoring & feedback ===== */
function onAnswer(ok){
  state.total++;
  if(ok){ state.score+=10; state.correct++; state.streak++; cheer(); }
  else { state.streak=0; boo(); }
  updateStats();
}
function updateStats(){
  $('#score').textContent = state.score;
  $('#streak').textContent = state.streak;
  const rate = state.total? Math.round(100*state.correct/state.total) : 0;
  $('#rate').textContent = `${rate}%`;
}

/* ===== Confetti ===== */
function cheer(){
  const c = $('#confetti');
  for(let i=0;i<20;i++){
    const p = document.createElement('i');
    p.style.left = Math.random()*100+'vw';
    p.style.color = ['#22c55e','#10b981','#34d399','#a7f3d0','#86efac','#6366f1','#f59e0b'][randInt(0,6)];
    p.style.animationDelay = (Math.random()*0.2)+'s';
    c.appendChild(p);
    setTimeout(()=>p.remove(), 1200);
  }
  tip('やったね！つぎも いってみよう！');
}
function boo(){ tip('おしい！ 針の位置を よく見てみよう。'); }
function tip(msg){ $('#tinyMsg').textContent = msg; }

/* ===== Drag to set clock (minutes) ===== */
(function initDrag(){
  const svg = $('#clockSvg');
  function getAngle(ev){
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width/2;
    const cy = r.top + r.height/2;
    const x = (ev.touches? ev.touches[0].clientX : ev.clientX) - cx;
    const y = (ev.touches? ev.touches[0].clientY : ev.clientY) - cy;
    // 12時=0°, 時計回りで増える角度
    const deg = (Math.atan2(y,x)*180/Math.PI + 90 + 360) % 360;
    return deg;
  }
  function handleMove(ev){
    if(!state.dragging || state.mode!=='set') return;
    ev.preventDefault();
    let deg = getAngle(ev);
    const snap = minuteSnapByLevel(state.level);
    let minute = Math.round(deg/6);
    minute = Math.round(minute / snap) * snap;
    minute = (minute+60)%60;

    const prev = state.clock.m;
    state.clock.m = minute;
    let h = state.clock.h;
    if(prev>=45 && minute<=15) h = (h+1)%24;
    if(prev<=15 && minute>=45) h = (h+23)%24;
    state.clock.h = h;
    setHands(state.clock.h, state.clock.m);
    maybeAutoCheck();
  }
  function down(ev){ if(state.mode==='set'){ state.dragging=true; handleMove(ev);} }
  function up(){ state.dragging=false; }
  ['pointerdown','mousedown','touchstart'].forEach(e=>svg.addEventListener(e,down,{passive:false}));
  ['pointermove','mousemove','touchmove'].forEach(e=>window.addEventListener(e,handleMove,{passive:false}));
  ['pointerup','mouseup','mouseleave','touchend','touchcancel'].forEach(e=>window.addEventListener(e,up));
})();

function maybeAutoCheck(){
  if(state.mode!=='set') return;
  const a = state.clock;
  const b = state.target;
  const tol = state.level===3?1 : state.level===2?2 : 3;
  const diff = Math.abs((a.h*60+a.m) - (b.h*60+b.m));
  const wrapped = Math.min(diff, 1440-diff);
  if(wrapped<=tol){
    tip('ぴったり！すごい！');
    onAnswer(true);
    $('#showAnsBtn').disabled = true;
    $('#replayBtn').disabled = false;
  }
}

/* ===== UI wiring ===== */
for(const t of $$('.tab')){
  t.addEventListener('click', ()=>{
    $$('.tab').forEach(el=>el.setAttribute('aria-selected','false'));
    t.setAttribute('aria-selected','true');
    state.mode = t.dataset.mode;
    $('#choices').innerHTML='';
    $('#prompt').textContent = 'スタート をおしてね。';
    $('#tinyMsg').textContent='';
    $('#showAnsBtn').disabled = state.mode!=='set';
    $('#replayBtn').disabled = true;
  });
}
$('#levelSel').addEventListener('change', e=>{ state.level = +e.target.value; });
$('#ampm').addEventListener('change', e=>{ state.useAmPm = e.target.checked; });
$('#showNums').addEventListener('change', e=>{ state.showNums = e.target.checked; applyHints(); });
$('#hint5').addEventListener('change', e=>{ state.hint5 = e.target.checked; applyHints(); });
$('#nextBtn').addEventListener('click', newChallenge);
$('#replayBtn').addEventListener('click', ()=>{
  if(state.mode==='read' || state.mode==='elapsed') newChallenge();
  else{
    state.clock = genTime(3,true);
    setHands(state.clock.h, state.clock.m);
    $('#tinyMsg').textContent='もういっかい やってみよう！';
  }
});
$('#showAnsBtn').addEventListener('click', ()=>{
  if(state.mode!=='set') return;
  const t = jTime(state.target.h, state.target.m, state.useAmPm, true);
  tip('こたえは → ' + t);
  setHands(state.target.h, state.target.m); // 学びのために正解を表示
});
$('#openHelp').addEventListener('click', ()=>$('#helpDlg').showModal());
$('#closeHelp').addEventListener('click', ()=>$('#helpDlg').close());

/* Initial render */
applyHints();
setHands(state.clock.h, state.clock.m);
(function updateStatsInit(){ $('#score').textContent='0'; $('#streak').textContent='0'; $('#rate').textContent='0%'; })();
