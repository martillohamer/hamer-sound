'use strict';
// dj. hammer - motor Web Audio: deck -> fader -> medidor -> crossfader (potencia constante) -> master
const $ = (s, r = document) => { const e = r.querySelector(s); if (!e) console.error('Falta elemento en el HTML:', s); return e; };
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => { const t = Math.floor((Number.isFinite(s) && s > 0 ? s : 0) * 10); return String(Math.floor(t / 600)).padStart(2, '0') + ':' + ((t % 600) / 10).toFixed(1).padStart(4, '0'); };
const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); }); // evita que el navegador abra el MP3
window.addEventListener('drop', e => { if (hasFiles(e)) e.preventDefault(); });

const ctx = new (window.AudioContext || window.webkitAudioContext)();
const master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
const xfade = { A: ctx.createGain(), B: ctx.createGain() };
xfade.A.connect(master); xfade.B.connect(master);
const setXf = v => { const a = (v + 1) / 2 * Math.PI / 2; xfade.A.gain.value = Math.cos(a); xfade.B.gain.value = Math.sin(a); $('#xfv').textContent = Math.round((v + 1) * 50) + '%'; };
document.addEventListener('pointerdown', () => ctx.resume());

const deckHTML = d => `<div class="lcd"><div data-st>CLOSED</div><div class="tm"><label>Elapsed<b data-el>00:00.0</b></label><label>Remaining<b data-re>00:00.0</b></label></div>
<div class="ti" data-ti>— sin pista —</div><div class="bar" data-bar><i></i></div></div>
<canvas data-vu width="14" height="110"></canvas>
<div class="pitch"><button data-pm>−</button><input type="range" class="vf" min="-24" max="24" step=".5" value="0" data-pitch><button data-pp>+</button><small data-pv>0.0%</small></div>
<div class="tp"><small>PLAYER ${d}</small><button class="cue" data-cue>CUE</button><button class="play" data-play>▶❚❚</button><button data-load title="Cargar la pista seleccionada">▲</button><button data-rw>«</button><button data-ff>»</button></div>`;

class Deck {
  constructor(id, root) {
    this.id = id; this.root = root; this.lv = 0; this.state = 'CLOSED'; root.innerHTML = deckHTML(id);
    const q = this.q = k => $(`[data-${k}]`, root), a = this.audio = new Audio();
    a.preload = 'metadata';
    const src = ctx.createMediaElementSource(a); this.vol = ctx.createGain(); this.an = ctx.createAnalyser(); this.an.fftSize = 256;
    src.connect(this.vol); this.vol.connect(this.an); this.an.connect(xfade[id]);
    a.addEventListener('timeupdate', () => this.draw());
    a.addEventListener('loadedmetadata', () => { this.state = 'READY'; this.draw(); });
    a.addEventListener('ended', () => { this.state = 'READY'; a.currentTime = 0; this.draw(); });
    a.addEventListener('error', () => { if (a.src) { this.state = 'ERROR'; this.draw(); } });
    q('play').onclick = () => this.toggle();
    q('cue').onclick = () => { a.pause(); a.currentTime = 0; if (a.src) this.state = 'READY'; this.draw(); };
    q('load').onclick = () => lib.sel && this.load(lib.sel);
    q('rw').onclick = () => { a.currentTime = Math.max(0, a.currentTime - 10); };
    q('ff').onclick = () => { if (Number.isFinite(a.duration)) a.currentTime = Math.min(a.duration, a.currentTime + 10); };
    q('bar').onclick = e => { if (!Number.isFinite(a.duration)) return; const r = e.currentTarget.getBoundingClientRect(); a.currentTime = (e.clientX - r.left) / r.width * a.duration; };
    const p = q('pitch'), setP = v => { p.value = Math.max(-24, Math.min(24, v)); a.playbackRate = 1 + p.value / 100; q('pv').textContent = (p.value > 0 ? '+' : '') + Number(p.value).toFixed(1) + '%'; };
    p.oninput = () => setP(+p.value); q('pm').onclick = () => setP(+p.value - .5); q('pp').onclick = () => setP(+p.value + .5);
    root.addEventListener('dragover', e => { if (!hasFiles(e)) { e.preventDefault(); root.classList.add('over'); } });
    root.addEventListener('dragleave', () => root.classList.remove('over'));
    root.addEventListener('drop', e => { root.classList.remove('over'); const t = lib.byId(+e.dataTransfer.getData('text/track')); if (t) { e.preventDefault(); this.load(t); } });
  }
  load(t) { const a = this.audio; a.pause(); this.track = t; this.state = 'LOADING'; a.src = t.url; a.load(); this.q('ti').textContent = t.name; this.draw(); }
  toggle() {
    const a = this.audio; if (!a.src) return; ctx.resume();
    if (a.paused) { a.play().catch(console.error); this.state = 'PLAYING'; } else { a.pause(); this.state = 'PAUSED'; }
    this.draw();
  }
  draw() {
    const a = this.audio, d = a.duration, ok = Number.isFinite(d) && d > 0;
    this.q('st').textContent = this.state; this.q('el').textContent = fmt(a.currentTime);
    this.q('re').textContent = ok ? '-' + fmt(d - a.currentTime).slice(0) : '00:00.0';
    $('i', this.q('bar')).style.width = ok ? (a.currentTime / d * 100) + '%' : '0%';
  }
}

const decks = { A: new Deck('A', $('#players').appendChild(Object.assign(document.createElement('section'), { className: 'player' }))),
                B: new Deck('B', $('#players').appendChild(Object.assign(document.createElement('section'), { className: 'player' }))) };

const lib = {
  tracks: [], sel: null, seq: 0, byId(id) { return this.tracks.find(t => t.id === id); },
  add(files) {
    [...files].filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i.test(f.name)).forEach(f => {
      const name = f.name.replace(/\.[^.]+$/, '').replace(/^SpotiDown\.App\s*-\s*/i, ''), i = name.lastIndexOf(' - ');
      const t = { id: ++this.seq, name, title: i > 0 ? name.slice(0, i) : name, artist: i > 0 ? name.slice(i + 3) : '', url: URL.createObjectURL(f), dur: null };
      const p = new Audio(); p.preload = 'metadata'; p.src = t.url; p.onloadedmetadata = () => { t.dur = p.duration; this.render(); };
      this.tracks.push(t);
    });
    this.render();
  },
  clear() {
    const used = Object.values(decks).map(d => d.track);
    this.tracks.forEach(t => { if (!used.includes(t)) URL.revokeObjectURL(t.url); });
    this.tracks = []; this.sel = null; this.render();
  },
  render() {
    $('#rows').innerHTML = this.tracks.map((t, i) => `<tr draggable="true" data-id="${t.id}" class="${t === this.sel ? 'sel' : ''}"><td>${i + 1}</td><td>${esc(t.artist)}</td><td>${esc(t.title)}</td><td>${t.dur ? fmt(t.dur).slice(0, 5) : '--:--'}</td></tr>`).join('');
    $('#count').textContent = this.tracks.length; $('#empty').style.display = this.tracks.length ? 'none' : 'grid';
  }
};
const rows = $('#rows');
rows.addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr) { lib.sel = lib.byId(+tr.dataset.id); lib.render(); } });
rows.addEventListener('dblclick', e => { const tr = e.target.closest('tr'); if (!tr) return; const t = lib.byId(+tr.dataset.id), A = decks.A.audio; (!A.src || A.paused ? decks.A : decks.B).load(t); });
rows.addEventListener('dragstart', e => { const tr = e.target.closest('tr'); if (tr) e.dataTransfer.setData('text/track', tr.dataset.id); });
const zone = $('#lib'); let depth = 0;
zone.addEventListener('dragenter', e => { if (hasFiles(e)) { e.preventDefault(); depth++; zone.classList.add('over'); } });
zone.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
zone.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; zone.classList.remove('over'); } });
zone.addEventListener('drop', e => { if (hasFiles(e)) { e.preventDefault(); depth = 0; zone.classList.remove('over'); lib.add(e.dataTransfer.files); } });
document.addEventListener('paste', e => { if (e.clipboardData && e.clipboardData.files.length) lib.add(e.clipboardData.files); });
const fileIn = $('#file');
$('#add').onclick = () => fileIn.click();
fileIn.onchange = e => { lib.add(e.target.files); e.target.value = ''; };
$('#clear').onclick = () => lib.clear();
$('#volA').oninput = e => { decks.A.vol.gain.value = +e.target.value; };
$('#volB').oninput = e => { decks.B.vol.gain.value = +e.target.value; };
decks.A.vol.gain.value = decks.B.vol.gain.value = 0.8;
$('#xf').oninput = e => setXf(+e.target.value); setXf(0);
$('#master').oninput = e => { master.gain.value = +e.target.value; };

const level = an => { const b = new Uint8Array(an.fftSize); an.getByteTimeDomainData(b); let m = 0; for (const v of b) m = Math.max(m, Math.abs(v - 128)); return m / 128; };
const meter = (g, x, w, H, v, n = 12) => { const h = H / n; for (let i = 0; i < n; i++) { g.fillStyle = v * n <= i ? '#1d2a1d' : i >= n - 2 ? '#e33' : i >= n - 4 ? '#ec3' : '#3d3'; g.fillRect(x, H - (i + 1) * h + 1, w, h - 2); } };
const vu = $('#vu'), vg = vu.getContext('2d');
(function loop() {
  vg.clearRect(0, 0, vu.width, vu.height);
  Object.values(decks).forEach((d, k) => {
    d.lv = Math.max(level(d.an), d.lv * 0.9);
    const c = d.q('vu'), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    meter(g, 0, c.width, c.height, d.lv); meter(vg, 10 + k * 40, 30, vu.height, d.lv);
  });
  requestAnimationFrame(loop);
})();
const tick = () => { $('#clock').textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); };
tick(); setInterval(tick, 1000); lib.render();
window.pcdj = { ctx, decks, lib };
