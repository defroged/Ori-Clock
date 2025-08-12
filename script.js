/* ===== Utilities ===== */
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const pad2 = n => n.toString().padStart(2,'0');
const randInt = (min,max)=> Math.floor(Math.random()*(max-min+1))+min;
const choice = arr => arr[Math.floor(Math.random()*arr.length)];
const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));

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
function minuteSnapByLevel(level){ return level==1 ? 30 : level==2 ? 5 : 1; }

/* ===== State ===== */
const state = {
  mode:'read', // 'read' | 'set' | 'elapsed'
  level:1,
  useAmPm:false,
  showNums:true,
  hint5:true,
  target:{h:3, m:30},
  targetDelta:0,
  score:0, streak:0, total:0, correct:0,
  clock:{h:3, m:30},
  dragging:false,
};

/* ===== Web Audio (instant feedback) ===== */
const Snd = {
  ctx:null, gain:null, buffers:{}, primed:false, loading:false,
  async init(){
    if(this.primed || this.loading) return;
    try{
      this.loading = true;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if(this.ctx.state === 'suspended') await this.ctx.resume();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.6; // comfortable volume
      this.gain.connect(this.ctx.destination);
      const files = { correct:'correct.mp3', wrong:'oops.mp3' };
      await Promise.all(Object.entries(files).map(async ([key, url])=>{
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        this.buffers[key] = await this.ctx.decodeAudioData(buf);
      }));
      this.primed = true;
    } catch(e){
      console.warn('Audio init failed:', e);
    } finally{
      this.loading = false;
    }
  },
  async ensure(){
    if(!this.ctx){
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.6;
      this.gain.connect(this.ctx.destination);
    }
    if(this.ctx.state === 'suspended') await this.ctx.resume();
    if(!this.primed && !this.loading) this.init();
  },
  play(name){
    if(!this.ctx || !this.buffers[name]){
      // fallback tiny beep so feedback feels instant even if mp3 still decoding
      try{
        this.ensure();
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = name==='correct' ? 'triangle' : 'sawtooth';
        o.frequency.value = name==='correct' ? 880 : 180;
        g.gain.value = .0001;
        o.connect(g).connect(this.ctx.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(.25, this.ctx.currentTime + 0.005);
        g.gain.exponentialRampToValueAtTime(.0001, this.ctx.currentTime + 0.12);
        o.stop(this.ctx.currentTime + 0.12);
      }catch{}
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.connect(this.gain);
    src.start();
  }
};
// Prime audio on first gesture to guarantee instant playback on mobile
function primeOnFirstGesture(){
  const kick = async ()=>{ await Snd.ensure(); window.removeEventListener('pointerdown', kick); window.removeEventListener('touchstart', kick); };
  window.addEventListener('pointerdown', kick, {passive:true});
  window.addEventListener('touchstart', kick, {passive:true});
}
primeOnFirstGesture();

/* ===== Build clock face ===== */
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

/* ===== Render hands ===== */
function setHands(h24, m){
  const hourDeg = ((h24%12)*30) + (m*0.5);
  const minDeg  = m*6;
  $('#hourHand').setAttribute('transform', `rotate(${hourDeg} 160 160)`);
  $('#minHand').setAttribute('transform',  `rotate(${minDeg} 160 160)`);
}
function applyHints(){
  const svg = $('#clockSvg');
  svg.classList.toggle('hint-none', !state.showNums && !state.hint5);
  svg.classList.toggle('hint-nums', state.showNums);
  svg.classList.toggle('hint-5', state.hint5);
}

/* ===== Time helpers ===== */
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
    $('#prompt').textContent = `お題： ${t} にぴったり あわせよう。分しんをドラッグ！`;
    state.clock = genTime(3,true);
    setHands(state.clock.h, state.clock.m);
    $('#showAnsBtn').disabled = false;
    $('#replayBtn').disabled = false;
  }else if(state.mode==='elapsed'){
    state.target = genTime(state.level, true);
    state.targetDelta = genDelta(state.level);
    const q = state.useAmPm ? jTime(state.target.h,state.target.m,true,true)
                            : jTime(state.target.h,state.target.m,false,true);
    $('#prompt').textContent = `${q} から ${state.targetDelta}分 あとは？`;
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
  if(ok){
    state.score+=10; state.correct++; state.streak++; cheer(); Snd.play('correct');
  } else {
    state.streak=0; boo(); Snd.play('wrong');
  }
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
    p.style.color = ['#22c55e','#10b981','#34d399','#a7f3d0','#86efac','#f59e0b','#6366f1'][randInt(0,6)];
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
for(const t of $$('.seg__btn')){
  t.addEventListener('click', ()=>{
    $$('.seg__btn').forEach(el=>el.setAttribute('aria-selected','false'));
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
$('#nextBtn').addEventListener('click', async ()=>{
  await Snd.ensure(); // make sure audio is ready before play feedback for first answer
  newChallenge();
});
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
  setHands(state.target.h, state.target.m); // 正解を表示
});
$('#openHelp').addEventListener('click', ()=>$('#helpDlg').showModal());
$('#closeHelp').addEventListener('click', ()=>$('#helpDlg').close());

/* Initial render */
applyHints();
setHands(state.clock.h, state.clock.m);
(function updateStatsInit(){ $('#score').textContent='0'; $('#streak').textContent='0'; $('#rate').textContent='0%'; })();
