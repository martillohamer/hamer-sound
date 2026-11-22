// main.js — Arranque, mixer, modo AUTO, VU máster y controles generales
'use strict';

if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => {
    const e = r.querySelector(sel);
    if (!e) console.error('Falta elemento en el HTML:', sel);
    return e;
  };
}

let decks = { A: null, B: null };
let library = window.Library || null;

window.setStatus = function (msg) {
  const s = $('#status-msg');
  if (s) s.textContent = msg;
};

// ---------- Máquina de estados (utilidades) ----------
const StateMachine = {
  transition(deck, newState) {
    if (!deck) return false;
    deck.setState(newState);
    return true;
  },
  error(deck, reason) {
    if (!deck) return;
    deck.setState('ERROR');
    deck.showMessage('NOT LOADED! ' + (reason || ''));
  }
};

// ---------- Modo AUTO ----------
const AutoMode = {
  crossfadeSec: 8,
  active: false,
  interval: null,
  transitionTimer: null,
  pendingTransition: null,
  suppressedFor: null,
  blinks: [],

  start(decksRef) {
    this.decks = decksRef || decks;
    this.active = true;
    const btn = $('#btn-auto');
    if (btn) btn.classList.add('active');
    if (!this.interval) this.interval = setInterval(() => this._check(), 250);
    this._check();
  },

  stop() {
    this.active = false;
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.cancelTransition();
    this._clearBlinks();
    const btn = $('#btn-auto');
    if (btn) btn.classList.remove('active');
    if (window.setXf) window.setXf(0);
  },

  cancelTransition() {
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
    if (this.pendingTransition) {
      const sal = this.pendingTransition.saliente;
      this.suppressedFor = sal && sal.track ? sal.track.id : null;
      this.pendingTransition = null;
      this._clearBlinks();
      window.setStatus && window.setStatus('Crossfade cancelado — mueve el fader para reanudar');
    }
  },

  cancelByUser() { this.cancelTransition(); },

  _clearBlinks() {
    this.blinks.forEach(id => clearInterval(id));
    this.blinks = [];
    for (const key of ['A', 'B']) {
      const d = decks[key];
      if (d && d._blinkInterval) {
        clearInterval(d._blinkInterval);
        d._blinkInterval = null;
      }
    }
  },

  _check() {
    if (!this.active || !this.decks) return;
    const A = this.decks.A;
    const B = this.decks.B;
    let saliente = null;
    let entrante = null;

    if (A && A.state === 'PLAYING' && A.track) { saliente = A; entrante = B; }
    else if (B && B.state === 'PLAYING' && B.track) { saliente = B; entrante = A; }
    if (!saliente || !entrante) return;

    const dur = saliente.audio ? saliente.audio.duration : 0;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const remaining = dur - (saliente.audio.currentTime || 0);

    // Precachea (≤20 s) la siguiente pista no reproducida en el deck libre
    if (remaining <= 20 && entrante.state !== 'PLAYING' &&
        entrante._autoPreloadedFor !== saliente.track.id) {
      const next = library && library.nextUnplayed
        ? library.nextUnplayed(saliente.track.id)
        : null;
      if (next) {
        entrante.load(next);
        entrante._autoPreloadedFor = saliente.track.id;
        if (library) library.select(next);
        window.setStatus && window.setStatus('AUTO: precargada «' + next.title + '» en Player ' + entrante.id.toUpperCase());
      }
    }

    // Crossfade de 8 s
    if (remaining <= this.crossfadeSec && entrante.track &&
        entrante.state !== 'PLAYING' && !this.transitionTimer &&
        this.suppressedFor !== saliente.track.id) {
      this._startTransition(saliente, entrante);
    }
  },

  _startTransition(saliente, entrante) {
    this.pendingTransition = { saliente, entrante };
    entrante.play();

    const target = entrante.id === 'b' ? 1 : -1; // -1 = A, +1 = B
    const start = Number($('#crossfader') && $('#crossfader').value) || 0;
    const steps = Math.max(8, Math.round(this.crossfadeSec * 6));
    const stepMs = Math.max(30, (this.crossfadeSec * 1000) / steps);
    let current = start;
    let i = 0;

    window.setStatus && window.setStatus('AUTO: crossfade ' + this.crossfadeSec + ' s → Player ' + entrante.id.toUpperCase());
    this.transitionTimer = setInterval(() => {
      i++;
      current = start + (target - start) * (i / steps);
      window.setXf(current);
      if (i >= steps) {
        window.setXf(target);
        clearInterval(this.transitionTimer);
        this.transitionTimer = null;
        this._finishTransition(saliente, entrante);
      }
    }, stepMs);
  },

  _finishTransition(saliente, entrante) {
    this.pendingTransition = null;
    this.suppressedFor = saliente.track ? saliente.track.id : null;

    saliente.pause();
    saliente.setState('ENDED');
    saliente.leds.forEach(led => { led.style.background = 'var(--led-red)'; });
    if (library && saliente.track) library.markPlayed(saliente.track);

    entrante.setState('PLAYING');
    this._startBlink(entrante, '#2bd13a');
    window.setStatus && window.setStatus('AUTO: ahora suena «' + (entrante.track ? entrante.track.title : '?') + '»');

    const pending = library && library.tracks
      ? library.tracks.filter(t => !t.played).length
      : 0;
    if (pending === 0) {
      const mv = $('#mini-viewer');
      if (mv) mv.textContent = 'FIN DE LISTA';
      window.setStatus && window.setStatus('FIN DE LISTA');
      this.stop();
    }
  },

  _startBlink(deck, color) {
    if (!deck || !deck.elStatus) return;
    const el = deck.elStatus;
    let on = true;
    const id = setInterval(() => {
      on = !on;
      el.style.color = color;
      el.style.textShadow = on ? '0 0 8px ' + color : 'none';
    }, 700);
    deck._blinkInterval = id;
    this.blinks.push(id);
  },

  setCrossfadeSeconds(v) {
    this.crossfadeSec = Math.max(1, Math.min(30, Number(v) || 8));
  }
};

window.AutoMode = AutoMode;
window.StateMachine = StateMachine;

// ---------- Arranque ----------
document.addEventListener('DOMContentLoaded', () => {
  // Cada subsistema se aísla: un error puntual no puede dejar la consola "muerta".
  const safe = (label, fn) => {
    try { fn(); } catch (err) { console.error('[hammer] fallo al iniciar ' + label + ':', err); }
  };

  // audio.js (defer) ya ejecutó initAudio(); lo llamamos de nuevo por seguridad (idempotente)
  safe('audio', () => { if (window.initAudio) window.initAudio(); });

  safe('decks', () => {
    decks = {
      A: new Deck({ id: 'a', root: $('#player-a'), ctx: window.ctx, xfade: window.xfade }),
      B: new Deck({ id: 'b', root: $('#player-b'), ctx: window.ctx, xfade: window.xfade })
    };
    window.decks = decks;
  });

  safe('biblioteca', () => {
    library = window.Library;
    if (library) {
      library.decks = decks;
      library.init();
      library.render();
    }
  });

  safe('master', () => {
    if (window.getMaster && window.setMaster) window.setMaster(window.getMaster(), false);
  });
  safe('mixer', wireMixer);
  safe('botones superiores', wireTopButtons);
  safe('botones INFO', wireInfoButtons);
  safe('vúmetro', drawMasterVU);

  // Accesibilidad: si el usuario prefiere menos movimiento, no hay parpadeos
  safe('movimiento reducido', () => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersReduced && prefersReduced.matches) AutoMode._clearBlinks();
  });

  window.setStatus('Listo · arrastra MP3, pulsa «+ Añadir MP3» o usa Ctrl+V');
});

// ---------- Mixer ----------
// La rueda no mueve un <input type=range> de forma nativa en todos los navegadores:
// calculamos el valor y disparamos 'input' para reutilizar el mismo manejador que el arrastre.
function wireWheel(input, step) {
  if (!input) return;
  input.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    const min = Number(input.min);
    const max = Number(input.max);
    let v = (Number(input.value) || 0) + dir * step;
    if (Number.isFinite(min)) v = Math.max(min, v);
    if (Number.isFinite(max)) v = Math.min(max, v);
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, { passive: false });
}

function wireMixer() {
  const volA = $('#vol-a');
  const volB = $('#vol-b');
  const master = $('#master');
  const trimB = $('#vol-b2');
  const cf = $('#crossfader');

  wireWheel(volA, 0.02);
  wireWheel(volB, 0.02);
  wireWheel(master, 0.02);
  wireWheel(trimB, 0.02);
  wireWheel(cf, 0.05);

  if (volA) volA.addEventListener('input', () => decks.A && decks.A.setVolume(volA.value));
  if (volB) volB.addEventListener('input', () => decks.B && decks.B.setVolume(volB.value));
  if (master) master.addEventListener('input', () => window.setMaster(master.value));
  if (trimB) trimB.addEventListener('input', () => decks.B && decks.B.setTrim(trimB.value));
  if (cf) {
    cf.addEventListener('input', () => {
      if (window.setXf) window.setXf(cf.value, { fromSlider: true, user: true });
    });
    if (window.setXf) window.setXf(cf.value, { fromSlider: true });
  }
  if (decks.A) decks.A.setVolume(volA ? volA.value : 0.8);
  if (decks.B) {
    decks.B.setVolume(volB ? volB.value : 0.8);
    decks.B.setTrim(trimB ? trimB.value : 1);
  }
}

// ---------- Vúmetro máster ----------
function drawMasterVU() {
  const canvas = $('#vu-meter');
  if (!canvas || !canvas.getContext) return;
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  function frame() {
    g.clearRect(0, 0, w, h);
    const m = window.masterGain ? window.masterGain.gain.value : 0.8;
    const lv = Math.max(
      decks.A ? decks.A.lv : 0,
      decks.B ? decks.B.lv : 0
    ) * m;
    const bars = 12;
    const gap = 3;
    const bh = (h - gap * (bars + 1)) / bars;
    for (let i = 0; i < bars; i++) {
      const lit = lv >= (i + 1) / bars;
      const y = h - gap - i * (bh + gap);
      g.fillStyle = i >= bars - 2
        ? (lit ? 'rgba(255,42,42,.95)' : 'rgba(255,42,42,.10)')
        : i >= bars - 4
          ? (lit ? 'rgba(238,238,51,.95)' : 'rgba(238,238,51,.10)')
          : (lit ? 'rgba(43,209,58,.95)' : 'rgba(43,209,58,.10)');
      g.fillRect(6, y, w - 12, bh);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---------- Botones superiores ----------
function wireTopButtons() {
  const cfg = $('#btn-cfg');
  const info = $('#btn-info');
  const stby = $('#btn-stby');
  const exit = $('#btn-exit');
  const dlgCfg = $('#dlg-cfg');
  const dlgInfo = $('#dlg-info');

  if (cfg && dlgCfg && dlgCfg.showModal) cfg.addEventListener('click', () => dlgCfg.showModal());
  if (info && dlgInfo && dlgInfo.showModal) info.addEventListener('click', () => dlgInfo.showModal());

  document.querySelectorAll('[data-close-dialog]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.closest('dialog');
      if (d && d.close) d.close();
    });
  });

  const cfgCf = $('#cfg-crossfade');
  if (cfgCf) {
    cfgCf.value = String(AutoMode.crossfadeSec);
    const cfgOut = $('#cfg-crossfade-value');
    if (cfgOut) cfgOut.textContent = cfgCf.value;
    cfgCf.addEventListener('input', () => {
      AutoMode.setCrossfadeSeconds(cfgCf.value);
      if (cfgOut) cfgOut.textContent = String(AutoMode.crossfadeSec);
    });
  }
  const cfgMaster = $('#cfg-master');
  if (cfgMaster) {
    cfgMaster.value = String(window.getMaster ? window.getMaster() : 0.8);
    cfgMaster.addEventListener('input', () => window.setMaster(cfgMaster.value));
  }
  const syncMaster = $('#master');
  if (syncMaster) syncMaster.addEventListener('input', () => {
    if (cfgMaster) cfgMaster.value = syncMaster.value;
  });

  let lastMaster = window.getMaster ? window.getMaster() : 0.8;
  if (stby) stby.addEventListener('click', () => {
    const on = stby.classList.toggle('active');
    if (on) {
      lastMaster = window.getMaster ? window.getMaster() : 0.8;
      window.setMaster(0, false);
      window.setStatus('STANDBY · master silenciado');
    } else {
      window.setMaster(lastMaster);
      window.setStatus('STANDBY desactivado');
    }
  });

  if (exit) exit.addEventListener('click', () => {
    if (dlgCfg && dlgCfg.open) dlgCfg.close();
    if (dlgInfo && dlgInfo.open) dlgInfo.close();
    if (decks.A) decks.A.stop();
    if (decks.B) decks.B.stop();
    if (library) library.setAuto(false);
    else AutoMode.stop();
    if (window.setXf) window.setXf(0);
    window.setStatus('Sistema detenido');
  });
}

function wireInfoButtons() {
  document.querySelectorAll('.player').forEach(player => {
    const btn = player.querySelector('.lcd-info');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const id = player.id === 'player-b' ? 'B' : 'A';
      const deck = decks[id];
      if (!deck) return;
      deck.showMessage(deck.info || 'NOT LOADED! Invalid floating point operation');
    });
  });
}

// ---------- Fin natural de pista ----------
window.onDeckEnded = function (deck) {
  if (!AutoMode.active || AutoMode.transitionTimer) return;
  const other = deck.id === 'a' ? decks.B : decks.A;
  if (!other || !other.track || other.state === 'PLAYING') return;
  other.play();
  if (window.setXf) window.setXf(other.id === 'b' ? 1 : -1);
};
