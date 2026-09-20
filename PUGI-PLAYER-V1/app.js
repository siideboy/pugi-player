const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const audio = $('#audio');

const DEFAULT_COVER = 'assets/default-cover.svg';
const DB_NAME = 'pugiPlayerDB';
const STORE = 'tracks';

let state = {
  tracks: [],
  currentId: null,
  queue: [],
  queueIndex: -1,
  shuffle: false,
  repeat: false,
  view: 'home',
  deferredPrompt: null,
  bass: 60,
  treble: 50
};

let audioCtx, sourceNode, bassFilter, trebleFilter, analyser, gainNode, visualFrame;

function toast(msg){
  const el=$('#toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>el.classList.remove('show'),2200);
}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function fmt(sec){if(!isFinite(sec))return '0:00'; sec=Math.max(0,Math.floor(sec)); return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function dbPut(track){
  const db=await openDB();
  return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(track);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
}
async function dbGetAll(){
  const db=await openDB();
  return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly');const r=tx.objectStore(STORE).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
}
async function dbDelete(id){
  const db=await openDB();
  return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
}

function makeTrack(file, cover=DEFAULT_COVER){
  return {
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^/.]+$/,''),
    artist:'Local Artist',
    album:'My Music',
    duration:0,
    cover,
    blob:file,
    favorite:false,
    offline:true,
    addedAt:Date.now()
  };
}
function coverFor(t){return t.cover || DEFAULT_COVER;}

async function addFiles(files){
  let n=0;
  for(const file of files){
    if(!file.type.startsWith('audio/')) continue;
    const t=makeTrack(file); await dbPut(t); n++;
  }
  state.tracks=await dbGetAll();
  render();
  toast(n ? `${n} song${n>1?'s':''} added to PUGI` : 'No audio files selected');
}

function getTrack(id){return state.tracks.find(t=>t.id===id);}
function setCurrent(id, autoplay=true){
  const t=getTrack(id); if(!t)return;
  state.currentId=id;
  if(t.blob) audio.src=URL.createObjectURL(t.blob);
  $('#playerCover').src=coverFor(t); $('#playerTitle').textContent=t.title; $('#playerArtist').textContent=t.artist;
  $('#favoriteBtn').textContent=t.favorite?'♥':'♡';
  if(autoplay){audio.play().catch(()=>{});}
  renderQueue();
}
function currentIndex(){return state.queue.findIndex(id=>id===state.currentId);}

function playNext(){
  if(!state.queue.length)return;
  let idx=currentIndex();
  if(state.shuffle) idx=Math.floor(Math.random()*state.queue.length);
  else idx=(idx+1)%state.queue.length;
  setCurrent(state.queue[idx],true);
}
function playPrev(){
  if(audio.currentTime>3){audio.currentTime=0;return;}
  if(!state.queue.length)return;
  let idx=currentIndex(); idx=(idx-1+state.queue.length)%state.queue.length;
  setCurrent(state.queue[idx],true);
}

function setQueue(list=state.tracks){state.queue=list.map(x=>x.id);state.queueIndex=currentIndex();renderQueue();}
function renderQueue(){
  const q=$('#queueList');
  if(!state.queue.length){q.innerHTML='<div class="empty">Queue is empty</div>';return;}
  q.innerHTML=state.queue.map(id=>{
    const t=getTrack(id); if(!t)return '';
    return `<button class="queue-item ${id===state.currentId?'active':''}" data-id="${id}">
      <img src="${coverFor(t)}"><div><strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span></div></button>`;
  }).join('');
  $$('.queue-item').forEach(b=>b.onclick=()=>setCurrent(b.dataset.id,true));
}

function songCard(t){
  return `<article class="card">
    <div class="cover-wrap"><img src="${coverFor(t)}" alt=""><button class="cover-play" data-play="${t.id}">▶</button></div>
    <div class="card-title">${esc(t.title)}</div><div class="card-artist">${esc(t.artist)}</div>
    <div class="card-actions">
      <button class="tiny" data-play="${t.id}">▶ Play</button>
      <button class="tiny" data-fav="${t.id}">${t.favorite?'♥':'♡'}</button>
      <button class="tiny" data-delete="${t.id}">×</button>
    </div>
  </article>`;
}
function row(t){
  return `<div class="song-row">
    <img src="${coverFor(t)}" alt=""><div class="song-meta"><strong>${esc(t.title)}</strong><span>${esc(t.artist)} • ${esc(t.album)}</span></div>
    <div class="row-actions"><button class="tiny" data-play="${t.id}">▶</button><button class="tiny" data-fav="${t.id}">${t.favorite?'♥':'♡'}</button><button class="tiny" data-delete="${t.id}">Delete</button></div>
  </div>`;
}

function render(){
  const content=$('#content'), q=$('#searchInput').value.trim().toLowerCase();
  let list=state.tracks.filter(t=>!q || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q));

  if(state.view==='home'){
    content.innerHTML=`<section class="hero"><div class="hero-content"><span class="tag">PUGI PLAYER V1</span><h1>Your music.<br>More bass.</h1><p>Play your own music offline, boost the low end, create a queue and keep your library on your device.</p><button class="primary" id="heroAdd">＋ Add Music</button><button class="secondary" id="heroFx">♫ Open FX</button></div></section>
    <div class="section-head"><h2>Recently added</h2><button data-view="library">View all</button></div>
    ${list.length?`<div class="grid">${list.slice().sort((a,b)=>b.addedAt-a.addedAt).slice(0,8).map(songCard).join('')}</div>`:`<div class="empty"><h2>Your library is ready</h2><p>Add MP3, M4A, WAV or other browser-supported audio files.</p><button class="primary" id="emptyAdd">Add music</button></div>`}`;
    $('#heroAdd')?.addEventListener('click',()=>$('#fileInput').click()); $('#emptyAdd')?.addEventListener('click',()=>$('#fileInput').click()); $('#heroFx')?.addEventListener('click',openFX);
  } else if(state.view==='discover'){
    content.innerHTML=`<div class="section-head"><h2>Discover</h2></div><div class="empty"><h2>Online catalog ready</h2><p>V1 keeps the music engine independent. Add a licensed music API/CDN later and its tracks can use the same player.</p><button class="primary" id="discoverLocal">Play My Library</button></div>`;
    $('#discoverLocal')?.addEventListener('click',()=>{state.view='library';render();});
  } else if(state.view==='library'){
    content.innerHTML=`<div class="section-head"><h2>My Library</h2><button class="primary" id="libraryAdd">＋ Add Music</button></div>${list.length?`<div>${list.map(row).join('')}</div>`:`<div class="empty"><h2>No music yet</h2><p>Choose audio files from your device.</p></div>`}`;
    $('#libraryAdd')?.addEventListener('click',()=>$('#fileInput').click());
  } else if(state.view==='downloads'){
    content.innerHTML=`<div class="section-head"><h2>Offline Music</h2></div>${list.filter(t=>t.offline).length?`<div>${list.filter(t=>t.offline).map(row).join('')}</div>`:`<div class="empty"><h2>No offline music</h2><p>Music you add to this V1 library is stored locally in IndexedDB.</p></div>`}`;
  } else if(state.view==='favorites'){
    const fav=list.filter(t=>t.favorite);
    content.innerHTML=`<div class="section-head"><h2>Favorites</h2></div>${fav.length?`<div>${fav.map(row).join('')}</div>`:`<div class="empty"><h2>No favorites</h2><p>Tap ♡ on a song to save it here.</p></div>`}`;
  } else if(state.view==='playlists'){
    content.innerHTML=`<div class="section-head"><h2>Playlists</h2></div><div class="empty"><h2>Playlist engine</h2><p>V1 player is ready for playlists; create named playlists in the next data layer without changing the audio engine.</p></div>`;
  }
  bindActions(); setQueue(state.view==='favorites'?list.filter(t=>t.favorite):list);
}

function bindActions(){
  $$('[data-play]').forEach(b=>b.onclick=()=>{setQueue(state.tracks);setCurrent(b.dataset.play,true);});
  $$('[data-fav]').forEach(b=>b.onclick=async()=>{const t=getTrack(b.dataset.fav);if(!t)return;t.favorite=!t.favorite;await dbPut(t);state.tracks=await dbGetAll();render();});
  $$('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this song from PUGI?'))return;await dbDelete(b.dataset.delete);if(state.currentId===b.dataset.delete){audio.pause();audio.removeAttribute('src');state.currentId=null;}state.tracks=await dbGetAll();render();});
  $$('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;$$('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.view===state.view));render();});
}

function ensureAudioGraph(){
  if(audioCtx)return;
  audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  sourceNode=audioCtx.createMediaElementSource(audio);
  bassFilter=audioCtx.createBiquadFilter(); bassFilter.type='lowshelf'; bassFilter.frequency.value=120;
  trebleFilter=audioCtx.createBiquadFilter(); trebleFilter.type='highshelf'; trebleFilter.frequency.value=5000;
  analyser=audioCtx.createAnalyser(); analyser.fftSize=256;
  gainNode=audioCtx.createGain(); gainNode.gain.value=.9;
  sourceNode.connect(bassFilter).connect(trebleFilter).connect(gainNode).connect(analyser).connect(audioCtx.destination);
  updateFX();
  drawVisualizer();
}
function updateFX(){
  if(!audioCtx)return;
  bassFilter.gain.value=(state.bass/100)*18;
  trebleFilter.gain.value=((state.treble-50)/50)*8;
}
function openFX(){ensureAudioGraph();$('#fxPanel').classList.add('open');$('#overlay').classList.remove('hidden');}
function closePanels(){$$('.side-panel').forEach(x=>x.classList.remove('open'));$('#overlay').classList.add('hidden');}

function drawVisualizer(){
  const c=$('#visualizerCanvas'),ctx=c.getContext('2d');
  function frame(){
    visualFrame=requestAnimationFrame(frame);
    if(!analyser)return;
    const d=new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(d);
    const w=c.width=c.clientWidth*devicePixelRatio,h=c.height=c.clientHeight*devicePixelRatio;
    ctx.clearRect(0,0,w,h); const bars=32,bw=w/bars;
    for(let i=0;i<bars;i++){const v=d[i*2]||0;const bh=(v/255)*h*.85;ctx.fillStyle=i%2?'#8b5cf6':'#ff3d81';ctx.fillRect(i*bw,h-bh,Math.max(2,bw-3),bh);}
  } frame();
}
function applyPreset(p){
  const presets={normal:[35,50],bass:[95,50],rock:[75,75],hiphop:[100,65]};
  [state.bass,state.treble]=presets[p]||presets.normal;
  $('#bassRange').value=state.bass;$('#trebleRange').value=state.treble;$('#bassValue').textContent=state.bass+'%';$('#trebleValue').textContent=state.treble+'%';updateFX();
}

audio.addEventListener('play',()=>{ensureAudioGraph(); if(audioCtx.state==='suspended')audioCtx.resume();$('#playBtn').textContent='Ⅱ';});
audio.addEventListener('pause',()=>$('#playBtn').textContent='▶');
audio.addEventListener('loadedmetadata',()=>$('#duration').textContent=fmt(audio.duration));
audio.addEventListener('timeupdate',()=>{$('#currentTime').textContent=fmt(audio.currentTime);$('#seekBar').value=audio.duration?(audio.currentTime/audio.duration)*100:0;});
audio.addEventListener('ended',()=>state.repeat?setCurrent(state.currentId,true):playNext());

$('#playBtn').onclick=()=>{if(!state.currentId){if(state.tracks[0]){setQueue(state.tracks);setCurrent(state.tracks[0].id,true);}return;} if(audio.paused){ensureAudioGraph();audio.play();}else audio.pause();};
$('#prevBtn').onclick=playPrev; $('#nextBtn').onclick=playNext;
$('#shuffleBtn').onclick=()=>{state.shuffle=!state.shuffle;$('#shuffleBtn').style.color=state.shuffle?'var(--accent)':'';};
$('#repeatBtn').onclick=()=>{state.repeat=!state.repeat;$('#repeatBtn').style.color=state.repeat?'var(--accent)':'';};
$('#seekBar').oninput=e=>{if(audio.duration)audio.currentTime=(e.target.value/100)*audio.duration;};
$('#volumeBar').oninput=e=>{audio.volume=e.target.value;$('#fxVolumeRange').value=e.target.value*100;$('#fxVolumeValue').textContent=Math.round(e.target.value*100)+'%';};
$('#fxVolumeRange').oninput=e=>{audio.volume=e.target.value/100;$('#volumeBar').value=audio.volume;$('#fxVolumeValue').textContent=e.target.value+'%';};
$('#bassRange').oninput=e=>{state.bass=+e.target.value;$('#bassValue').textContent=e.target.value+'%';updateFX();};
$('#trebleRange').oninput=e=>{state.treble=+e.target.value;$('#trebleValue').textContent=e.target.value+'%';updateFX();};
$$('[data-preset]').forEach(b=>b.onclick=()=>applyPreset(b.dataset.preset));
$('#favoriteBtn').onclick=async()=>{if(!state.currentId)return;const t=getTrack(state.currentId);t.favorite=!t.favorite;await dbPut(t);state.tracks=await dbGetAll();$('#favoriteBtn').textContent=t.favorite?'♥':'♡';render();};
$('#fxBtn').onclick=openFX; $('#queueBtn').onclick=()=>{$('#queuePanel').classList.add('open');$('#overlay').classList.remove('hidden');renderQueue();};
$('.close-panel').onclick=closePanels; $$('.close-panel').forEach(b=>b.onclick=closePanels); $('#overlay').onclick=closePanels;
$('#volumeBtn').onclick=()=>audio.muted=!audio.muted;
$('#addMusicBtn').onclick=()=>$('#fileInput').click();
$('#fileInput').onchange=e=>addFiles(e.target.files);
$('#searchInput').oninput=()=>{ $('#clearSearch').classList.toggle('hidden',!$('#searchInput').value); render();};
$('#clearSearch').onclick=()=>{$('#searchInput').value='';$('#clearSearch').classList.add('hidden');render();};
$('#mobileMenu').onclick=()=>$('.sidebar').classList.toggle('open');

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;$('#installBtn').classList.remove('hidden');});
$('#installBtn').onclick=async()=>{if(!state.deferredPrompt)return;state.deferredPrompt.prompt();state.deferredPrompt=null;$('#installBtn').classList.add('hidden');};

navigator.serviceWorker?.register('sw.js').catch(()=>{});

(async()=>{
  state.tracks=await dbGetAll();
  audio.volume=.9;
  render();
  $('#bassRange').value=state.bass;$('#trebleRange').value=state.treble;
  $('#bassValue').textContent=state.bass+'%';$('#trebleValue').textContent=state.treble+'%';
})();
