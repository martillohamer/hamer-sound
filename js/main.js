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

// ---------- Hora del sistema, reloj de sesión y contador ----------
const Session = {
  start: Date.now(),
  count: 0,
  _timer: null,

  init() {
    const reset = $('#btn-session-reset');
    if (reset && !reset._wired) {
      reset._wired = true;
      reset.addEventListener('click', () => this.reset());
    }
    if (!this._timer) this._timer = setInterval(() => this.tick(), 250);
    this.tick();
  },

  _hms(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60]
      .map(n => String(n).padStart(2, '0')).join(':');
  },

  tick() {
    const now = new Date();
    const clock = $('.clock-digits');
    if (clock) {
      const s = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map(n => String(n).padStart(2, '0')).join(':');
      if (clock.textContent !== s) clock.textContent = s;
    }
    const el = $('#session-time');
    if (el) el.textContent = this._hms(Date.now() - this.start);
    const c = $('#session-count');
    if (c) c.textContent = String(this.count);
    this._syncFxAvailability();
  },

  countPlay() {
    this.count++;
    const c = $('#session-count');
    if (c) c.textContent = String(this.count);
  },

  reset() {
    this.start = Date.now();
    this.count = 0;
    const mv = $('#mini-viewer');
    if (mv) mv.textContent = '';
    ['A', 'B'].forEach(key => {
      const d = decks[key];
      if (d && d.elStatus) { d.elStatus.style.color = ''; d.elStatus.style.textShadow = ''; }
    });
    this.tick();
    window.setStatus && window.setStatus('Sesión reiniciada · reloj y contador a cero');
  },

  // BRAKE/START se bloquean con AUTO: así el crossfade automático nunca
  // encuentra un deck con velocidad alterada a mitad de transición.
  _syncFxAvailability() {
    const blocked = !!(window.AutoMode && window.AutoMode.active);
    document.querySelectorAll('.fx-motion button').forEach(b => { b.disabled = blocked; });
  }
};

window.Session = Session; // accesible desde la consola para depurar

// Lo llama deck.js cuando una pista empieza a sonar (una vez por carga).
window.onDeckPlay = function (deck) {
  if (typeof Session === 'undefined') return;
  Session.countPlay();
  window.setStatus && window.setStatus('▶ ' + (deck.track ? deck.track.title : '?') +
    ' · pinchados ' + Session.count);
};

// ---------- Modo AUTO ----------
const AutoMode = {
  crossfadeSec: 8,
  active: false,
  interval: null,
  transitionTimer: null,
  pendingTransition: null,
  suppressedFor: null,
  announcedEnd: false,
  blinks: [],

  start(decksRef) {
    this.decks = decksRef || decks;
    this.active = true;
    this.announcedEnd = false;
    this.suppressedFor = null;
    // Un reinicio no debe heredarse de la sesión anterior: fuerza una
    // precarga nueva y evita que se reutilice una pista ya marcada.
    for (const key of ['A', 'B']) {
      const d = this.decks && this.decks[key];
      if (d) { d._autoPreloadedFor = null; d._autoPreloadedTrack = null; }
    }
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
    // Por si stop() se llama directamente (fin de lista) y no vía Library.
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
      window.setStatus && window.setStatus('Crossfade cancelado — control manual del fader');
    }
  },

  cancelByUser() { this.cancelTransition(); },

  _clearBlinks() {
    this.blinks.forEach(id => clearInterval(id));
    this.blinks = [];
    const list = this.decks || decks;
    for (const key of ['A', 'B']) {
      const d = list && list[key];
      if (!d) continue;
      if (d._blinkInterval) {
        clearInterval(d._blinkInterval);
        d._blinkInterval = null;
      }
      if (d.elStatus) {
        d.elStatus.style.color = '';
        d.elStatus.style.textShadow = '';
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
    if (!saliente || !entrante || !saliente.audio) return;

    const dur = saliente.audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    const remaining = dur - (saliente.audio.currentTime || 0);
    const sid = saliente.track ? saliente.track.id : null;

    // Precachea (≤20 s) la siguiente pista no reproducida en el deck libre.
    // Se calcula una sola vez: con SHUFFLE, nextUnplayed() es aleatorio.
    if (remaining <= 20 && entrante.state !== 'PLAYING' &&
        entrante._autoPreloadedFor !== sid) {
      const next = library && library.nextUnplayed
        ? library.nextUnplayed(sid) : null;
      if (next) {
        entrante.load(next);
        entrante._autoPreloadedFor = sid;
        entrante._autoPreloadedTrack = next.id;
        if (library) library.select(next);
        window.setStatus && window.setStatus('AUTO: precargada «' + next.title + '» en Player ' + entrante.id.toUpperCase());
      }
    }

    if (remaining > this.crossfadeSec || this.transitionTimer ||
        this.suppressedFor === sid) return;

    // Sólo se hace crossfade a la pista que AUTO acaba de precargar para
    // esta saliente. Así nunca se reactiva una pista ya reproducida que
    // hubiera quedado abandonada en el otro deck.
    const validEntrante = entrante.track &&
      entrante._autoPreloadedFor === sid &&
      entrante._autoPreloadedTrack === entrante.track.id &&
      entrante.state !== 'PLAYING';

    if (validEntrante) {
      this.announcedEnd = false;
      this._startTransition(saliente, entrante);
      return;
    }

    if (!this.announcedEnd) {
      const pool = library && typeof library._pool === 'function' ? library._pool() : (library ? library.tracks : []);
      const pending = pool ? pool.filter(t => !t.played && t.id !== sid).length : 0;
      if (pending === 0) this._announceEnd();
    }
  },

  _announceEnd() {
    this.announcedEnd = true;
    // Apaga AUTO por completo (intervalo, transición y blinkers) y
    // deja el botón y el modo de la biblioteca coherentes con el estado.
    // El mensaje va DESPUÉS: setAuto(false) escribe su propio estado.
    if (library && typeof library.setAuto === 'function') library.setAuto(false);
    else this.stop();
    const mv = $('#mini-viewer');
    if (mv) mv.textContent = 'FIN DE LISTA';
    window.setStatus && window.setStatus('FIN DE LISTA · no quedan pistas sin reproducir');
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

    const pool = library && typeof library._pool === 'function' ? library._pool() : (library ? library.tracks : []);
    const pending = pool ? pool.filter(t => !t.played).length : 0;
    if (pending === 0) this._announceEnd();
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
  safe('sesión', () => Session.init());
  safe('fx', wireFxRack);
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

// ---------- Banco de efectos por deck ----------
function wireFxRack() {
  const cutoffToHz = (v) => Math.round(120 * Math.pow(100, Math.max(0, Math.min(1, Number(v) / 100))));
  const fmtHz = (hz) => hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : String(hz);

  document.querySelectorAll('.fx-channel').forEach(ch => {
    const key = ch.getAttribute('data-fx-deck');
    const deck = decks[key];
    if (!deck) return;
    let type = 'off';
    let echo = false;
    const cut = ch.querySelector('[data-cutoff]');
    const cutOut = ch.querySelector('[data-cutoff-val]');
    const echoMix = ch.querySelector('[data-echo-mix]');
    const echoOut = ch.querySelector('[data-echo-val]');
    const echoBtn = ch.querySelector('[data-echo]');
    const filterBtns = Array.from(ch.querySelectorAll('[data-filter]'));

    const applyFilter = () => deck.setFilter(type, cutoffToHz(cut ? cut.value : 100));

    filterBtns.forEach(btn => btn.addEventListener('click', () => {
      type = btn.getAttribute('data-filter');
      filterBtns.forEach(b => b.classList.toggle('active', b === btn));
      applyFilter();
    }));
    if (cut) cut.addEventListener('input', () => {
      if (cutOut) cutOut.textContent = fmtHz(cutoffToHz(cut.value));
      applyFilter();
    });
    if (echoBtn) echoBtn.addEventListener('click', () => {
      echo = !echo;
      echoBtn.setAttribute('aria-pressed', echo ? 'true' : 'false');
      echoBtn.textContent = echo ? 'ON' : 'OFF';
      deck.setEcho(echo, echoMix ? echoMix.value : 0.35);
    });
    if (echoMix) echoMix.addEventListener('input', () => {
      const v = Number(echoMix.value) || 0;
      if (echoOut) echoOut.textContent = Math.round(v * 100) + '%';
      if (echo) deck.setEcho(true, v);
    });

    const guarded = (fn, label) => () => {
      if (window.AutoMode && window.AutoMode.active) {
        window.setStatus && window.setStatus('FX de plato desactivados con AUTO activo');
        return;
      }
      if (fn.call(deck)) window.setStatus && window.setStatus('Player ' + key + ': ' + label);
    };
    const brake = ch.querySelector('[data-brake]');
    const start = ch.querySelector('[data-start]');
    if (brake) brake.addEventListener('click', guarded(deck.brake, 'BRAKE'));
    if (start) start.addEventListener('click', guarded(deck.start, 'START'));
  });
}

// ---------- Vúmetro máster ----------
function drawMasterVU() {
  const canvas = $('#vu-meter');
  if (!canvas || !canvas.getContext) return;
  const g = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  let lv = 0; // nivel suavizado del máster

  function frame() {
    g.clearRect(0, 0, w, h);
    const m = window.masterGain ? window.masterGain.gain.value : 0.8;
    // lv de cada deck YA incluye su ganancia del crossfader (ver deck.js).
    // La mezcla es la SUMA de canales, no el máximo: al mover el fader a A
    // el canal B debe desaparecer del vúmetro central.
    const a = decks.A ? decks.A.lv : 0;
    const b = decks.B ? decks.B.lv : 0;
    const target = Math.min(1, a + b) * m;
    // Ataque rápido, caída suave: respuesta fluida sin saltos bruscos.
    lv += (target - lv) * (target > lv ? 0.6 : 0.12);
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

  const openDlg = (d) => {
    if (d && !d.open && typeof d.showModal === 'function') d.showModal();
  };
  if (cfg) cfg.addEventListener('click', () => openDlg(dlgCfg));
  if (info) info.addEventListener('click', () => openDlg(dlgInfo));

  document.querySelectorAll('[data-close-dialog]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.closest('dialog');
      if (d && d.open && typeof d.close === 'function') d.close();
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
  // setMaster() ya sincroniza #master y #cfg-master (audio.js).
  const cfgMaster = $('#cfg-master');
  if (cfgMaster) cfgMaster.addEventListener('input', () => window.setMaster(cfgMaster.value));

  let lastMaster = window.getMaster ? window.getMaster() : 0.8;
  const masterSlider = $('#master');
  // Si el usuario mueve el master mientras está en STANDBY, ese nuevo valor
  // es el que hay que restaurar al salir (no el de antes de entrar).
  const onMasterTouched = () => {
    if (!stby || !stby.classList.contains('active') || !masterSlider) return;
    const v = Number(masterSlider.value);
    if (Number.isFinite(v)) lastMaster = Math.max(0, Math.min(1, v));
  };
  if (masterSlider) masterSlider.addEventListener('input', onMasterTouched);
  if (cfgMaster) cfgMaster.addEventListener('input', onMasterTouched);

  if (stby) stby.addEventListener('click', () => {
    const on = stby.classList.toggle('active');
    if (on) {
      lastMaster = window.getMaster ? window.getMaster() : 0.8;
      window.setMaster(0, false); // no persistimos el silencio
      window.setStatus('STANDBY · master silenciado');
    } else {
      window.setMaster(lastMaster);
      window.setStatus('STANDBY desactivado');
    }
  });

  if (exit) exit.addEventListener('click', () => {
    if (dlgCfg && dlgCfg.open) dlgCfg.close();
    if (dlgInfo && dlgInfo.open) dlgInfo.close();

    // ORDEN: primero AUTO (intervalo, crossfade y blinkers), luego audio.
    AutoMode.stop();
    if (library && typeof library.setAuto === 'function') library.setAuto(false);
    ['A', 'B'].forEach(key => {
      const d = decks[key];
      if (!d) return;
      d.eject();                 // stop + quitar src + limpiar LEDs/vúmetro
      if (d._blinkInterval) { clearInterval(d._blinkInterval); d._blinkInterval = null; }
      if (d.elStatus) { d.elStatus.style.color = ''; d.elStatus.style.textShadow = ''; }
    });

    // Salir de STANDBY restaurando el volumen, sin dejar el botón encendido.
    if (stby && stby.classList.contains('active')) {
      stby.classList.remove('active');
      window.setMaster(lastMaster);
    }
    if (window.setXf) window.setXf(0);
    const mv = $('#mini-viewer');
    if (mv) mv.textContent = '';
    window.setStatus('Sistema detenido · decks expulsados, AUTO apagado');
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
