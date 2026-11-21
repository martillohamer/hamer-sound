// audio.js — Motor Web Audio API y gestión de decks
'use strict';

// Helper $ (debe existir antes de usarse; definido en seg7.js o main.js)
if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
}

// Contexto de audio global
let ctx = null;

// Crossfader nodes (potencia constante)
const xfade = {
  A: { gain: null, node: null },
  B: { gain: null, node: null }
};

function initAudio() {
  if (ctx) return; // ya inicializado
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Master gain
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  // Crossfader gains
  xfade.A.gain = ctx.createGain();
  xfade.B.gain = ctx.createGain();
  xfade.A.gain.value = 1;
  xfade.B.gain.value = 0;
  xfade.A.gain.connect(master);
  xfade.B.gain.connect(master);

  // Function to set crossfader with curva cos/sin (potencia constante)
  window.setXf = function(v) {
    v = Math.max(-1, Math.min(1, v));
    const a = (v + 1) / 2 * Math.PI / 2;
    xfade.A.gain.gain.value = Math.cos(a);
    xfade.B.gain.gain.value = Math.sin(a);
    const percent = Math.round(((v + 1) / 2) * 100);
    $('#cf-value').textContent = percent + '%';
  };

  setXf(0);

  // Reanudar contexto al interactuar
  const resumeOnInteraction = () => {
    if (ctx.state === 'suspended') ctx.resume();
  };
  document.addEventListener('pointerdown', resumeOnInteraction);
  document.addEventListener('keydown', resumeOnInteraction);

  window.ctx = ctx;
  window.xfade = xfade;
  window.setXf = setXf;
}

initAudio();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initAudio, ctx, xfade, setXf };
}