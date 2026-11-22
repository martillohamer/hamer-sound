// audio.js — Motor Web Audio API: contexto, master, crossfader y volúmenes
'use strict';

// Helper $ global (seg7.js suele cargar primero, pero nos defendemos)
if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => {
    const e = r.querySelector(sel);
    if (!e) console.error('Falta elemento en el HTML:', sel);
    return e;
  };
}

let ctx = null;
let master = null;

// Objeto único y unificado. A/B en mayúsculas son canónicos;
// a/b son alias para que cualquier código (deck.js incluido) pueda usarlos.
const xfade = {
  A: { gain: null, node: null },
  B: { gain: null, node: null }
};
xfade.a = xfade.A;
xfade.b = xfade.B;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function initAudio() {
  if (ctx) return ctx; // idempotente

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    console.warn('Web Audio no disponible: se usará el volumen nativo de <audio>.');
    window.xfade = xfade;
    window.setXf = setXf;
    return null;
  }

  try {
    ctx = new AC();
  } catch (err) {
    console.error('No se pudo crear AudioContext:', err);
    window.xfade = xfade;
    window.setXf = setXf;
    return null;
  }

  master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  xfade.A.gain = ctx.createGain();
  xfade.B.gain = ctx.createGain();
  xfade.A.gain.gain.value = 1;
  xfade.B.gain.gain.value = 0;
  xfade.A.gain.connect(master);
  xfade.B.gain.connect(master);

  window.ctx = ctx;
  window.masterGain = master;
  window.xfade = xfade;
  window.setXf = setXf;
  window.setMaster = setMaster;

  const resume = () => { if (ctx && ctx.state === 'suspended') ctx.resume(); };
  document.addEventListener('pointerdown', resume);
  document.addEventListener('keydown', resume);

  setXf(0);
  return ctx;
}

/**
 * Fija el crossfader con curva de potencia constante (cos/sin).
 * @param {number} v -1 = A, 0 = centro, +1 = B
 * @param {object} opts fromSlider: no reescribe el input; user: cancela AUTO
 */
function setXf(v, opts = {}) {
  v = clamp(Number(v) || 0, -1, 1);

  if (xfade.A.gain && xfade.B.gain) {
    const a = ((v + 1) / 2) * Math.PI / 2;
    xfade.A.gain.gain.value = Math.cos(a);
    xfade.B.gain.gain.value = Math.sin(a);
  }

  const cf = $('#crossfader');
  if (cf && !opts.fromSlider) cf.value = String(v);

  const out = $('#cf-value');
  if (out) out.textContent = Math.round(((v + 1) / 2) * 100) + '%';

  if (opts.user && window.AutoMode && typeof window.AutoMode.cancelByUser === 'function') {
    window.AutoMode.cancelByUser();
  }
}

function setMaster(v, store = true) {
  v = clamp(Number(v) || 0, 0, 1);
  if (master) master.gain.value = v;
  const m = $('#master');
  if (m && String(m.value) !== String(v)) m.value = String(v);
  if (store) {
    try { localStorage.setItem('hammer:master', String(v)); } catch (_) { /* ignore */ }
  }
}

function getMaster() {
  try {
    const s = localStorage.getItem('hammer:master');
    if (s !== null && !Number.isNaN(Number(s))) return clamp(Number(s), 0, 1);
  } catch (_) { /* ignore */ }
  return 0.8;
}

// Exponer antes de que deck.js intente usarlo
window.xfade = xfade;
window.setXf = setXf;
window.setMaster = setMaster;
window.getMaster = getMaster;
window.initAudio = initAudio;

initAudio();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initAudio, get ctx() { return ctx; }, xfade, setXf, setMaster, getMaster };
}
