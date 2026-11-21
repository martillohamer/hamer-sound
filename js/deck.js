// deck.js — Clase Deck con máquina de estados y UI física
'use strict';

// Helper $ (debe existir antes; definido en seg7.js o main.js)
if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
}

class Deck {
  constructor(options = {}) {
    this.id = options.id || 'a'; // 'a' o 'b' siempre minúscula
    this.root = options.root; // elemento DOM del player
    this.ctx = options.ctx; // contexto de audio
    this.xfade = options.xfade; // objeto crossfader {A,gain,B,gain}
    this.masterGain = options.masterGain; // nodo gain master

    // Estado de la máquina de estados
    this.state = 'CLOSED'; // CLOSED → LOADING → READY → PLAYING ↔ PAUSED → ENDED
    this.track = null; // {id, name, title, artist, url, dur}
    this.audio = null; // elemento HTMLAudioElement
    this.analyser = null;
    this.lv = 0; // nivel de volumen para el vúmetro
    this.playbackRateBackup = 1; // para pausar sin cambiar rate

    // Referencias a elementos DOM (se poblarán después)
    this.elStatus = null; // "CLOSED", "PLAYING", "PAUSED", "ENDED"
    this.elElapsed = null; // dígitos Elapsed
    this.elRemaining = null; // dígitos Remaining
    this.elMessage = null; // texto de mensaje/título
    this.elVuMeter = null; // canvas vúmetro
    this.elPitchDisplay = null; // display "0.0%"
    this.elPitchFader = null; // input range pitch
    this.elCueBtn = null; // botón CUE
    this.elPlayBtn = null; // botón Play/Pausa
    this.elExpelBtn = null; // botón expulsar
    this.elTrackName = null; // nombre de pista en la lista
    this.elLedStrip = null; // tira de 12 LEDs

    // Inicializar DOM referencias y HTML del player
    this._initDOM();
    this._initAudio();
  }

  _initDOM() {
    // Crear HTML del player si no existe
    if (!this.root || this.root.children.length === 0) {
      this.root.innerHTML = this._playerHTML();
    }

    // Cachear referencias
    this.elStatus = $('#player-' + this.id + '-status');
    this.elElapsed = $('#player-' + this.id + '-elapsed');
    this.elRemaining = $('#player-' + this.id + '-remaining');
    this.elMessage = $('#player-' + this.id + '-msg');
    this.elVuMeter = $('#player-' + this.id + '-vu');
    this.elPitchDisplay = $('#player-' + this.id + '-pitch');
    this.elPitchFader = $('#player-' + this.id + '-pitch-fader');
    this.elCueBtn = $('#player-' + this.id + '-cue');
    this.elPlayBtn = $('#player-' + this.id + '-play');
    this.elExpelBtn = $('#player-' + this.id + '-expel▲');
    this.elLedStrip = $('#player-' + this.id + '-leds');

    // Botones de pista
    this.elTrackPrev = $('#player-' + this.id + '-prev');
    this.elTrackNext = $('#player-' + this.id + '-ff'); // ff es "forward" en el HTML original
    // Note: the HTML uses data-track-rew and data-track-ff, let's map them
    this.elTrackRew = $('#player-' + this.id + '-rew');
    this.elTrackFf = $('#player-' + this.id + '-ff');
  }

  _playerHTML() {
    const ledHTML = Array(12).fill('<div class="led"></div>').join('');
    return `<div class="lcd"><div class="lcd-bar"><i></i></div><div class="lcd-status">CLOSED</div><div class="lcd-timer"><span class="seg7-el">00:00.0</span>/<span class="seg7-re">-00:00.0</span></div><div class="lcd-msg"></div></div>
<button class="lcd-info">INFO</button>
<div class="vu-meter"><div class="vu-segment" data-level="-15"></div><div class="vu-segment" data-level="-13"></div><div class="vu-segment" data-level="-10"></div><div class="vu-segment" data-level="-8"></div><div class="vu-segment" data-level="-5"></div><div class="vu-segment" data-level="-3"></div><div class="vu-segment" data-level="-3"></div><div class="vu-segment" data-level="-8"></div><div class="vu-segment" data-level="-10"></div><div class="vu-segment" data-level="-13"></div><div class="vu-segment" data-level="-15"></div><div class="vu-segment" data-level="-15"></div></div>
<div class="pitch-block"><span class="pitch-label">PITCH</span><span class="pitch-value" id="player-` + this.id + `-pitch">0.0%</span><button data-pitch-minus>−</button><input type="range" class="pitch-fader" min="-24" max="24" step=".5" value="0" data-pitch-fader><button data-pitch-plus>+</button><button data-pitch-default◆>◆</button></div>
<div class="player-footer"><span class="player-label">PLAYER ` + this.id + `</span><div class="led-strip">` + ledHTML + `</div><div class="player-controls"><button data-track-prev>|◀ 0 ▶|</button><button data-cue>CUE</button><button data-play>▶❚❚</button><button data-expel▲ style="background:var(--expel-violet);color:#fff">▲</button><button data-track-eq>=</button><button data-track-rew>«</button><button data-track-ff">»</button></div></div>`;
  }

  _initAudio() {
    const a = this.audio = new Audio();
    a.preload = 'metadata';
    a.loop = false;

    // Connect to Web Audio graph
    const src = this.ctx.createMediaElementSource(a);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;

    // Connect: audio → vol → an → crossfader
    const vol = this.ctx.createGain();
    vol.gain.value = 0.8;
    src.connect(vol);
    vol.connect(this.analyser);
    this.analyser.connect(this.xfade[this.id]); // conecta al crossfader A o B

    // Event listeners
    a.addEventListener('canplay', () => { this.state = 'READY'; this.draw(); });
    a.addEventListener('playing', () => { this.state = 'PLAYING'; this.draw(); });
    a.addEventListener('pause', () => { this.state = 'PAUSED'; this.draw(); });
    a.addEventListener('ended', () => { this.state = 'ENDED'; a.currentTime = 0; this.draw(); });
    a.addEventListener('error', () => { this.state = 'ERROR'; this.draw(); });

    // Pitch fader
    if (this.elPitchFader) {
      this.elPitchFader.addEventListener('input', () => {
        const v = +this.elPitchFader.value;
        this.audio.playbackRate = 1 + v / 100;
        this.elPitchDisplay.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
      });
    }

    // CUE button
    if (this.elCueBtn) {
      this.elCueBtn.addEventListener('click', () => this._cueAction());
    }

    // Play/Pausa
    if (this.elPlayBtn) {
      this.elPlayBtn.addEventListener('click', () => this._playToggle());
    }

    // Expel button (eject)
    if (this.elExpelBtn) {
      this.elExpelBtn.addEventListener('click', () => this._eject());
    }

    // Track prev/next
    if (this.elTrackPrev) {
      this.elTrackPrev.addEventListener('click', () => this._trackPrev());
    }
    if (this.elTrackFf) {
      this.elTrackFf.addEventListener('click', () => this._trackNext());
    }
    if (this.elTrackRew) {
      this.elTrackRew.addEventListener('click', () => this._trackRewind());
    }
    if (this.elTrackNext) {
      this.elTrackNext.addEventListener('click', () => this._trackForward());
    }
  }

  _cueAction() {
    const a = this.audio;
    if (!a.src) return;

    // Si está en pausa y lejos del punto cue, fija el cue en la posición actual
    if (this.state === 'PAUSED' && a.currentTime > 0) {
      // Preescucha: marcar posición actual como cue
      this._cuePosition = a.currentTime;
    }

    // Si se mantiene pulsado (pointerdown) hace preescucha y al soltar vuelve al cue
    // Simplificado: en click, si hay cue marcado, volver a él
    if (this._cuePosition && a.currentTime !== this._cuePosition) {
      a.currentTime = this._cuePosition;
      this._cuePosition = null;
    }

    // Si se mantiene pulsado durante >5s no marca como reproducida
    // (handled by library state machine)
  }

  _playToggle() {
    const a = this.audio;
    if (!a.src) {
      // Try to play the current track
      if (this.track && this.track.url) {
        this.load(this.track);
      }
      return;
    }

    if (this.state === 'PLAYING') {
      a.pause();
      this.state = 'PAUSED';
    } else if (this.state === 'PAUSED') {
      a.play().then(() => { this.state = 'PLAYING'; });
    } else if (this.state === 'ENDED') {
      // Reiniciar y jugar
      a.currentTime = 0;
      a.play();
      this.state = 'PLAYING';
    } else if (this.state === 'CLOSED' || this.state === 'LOADING') {
      // Cargar y jugar
      if (this.track && this.track.url) {
        this.load(this.track);
        a.play().then(() => { this.state = 'PLAYING'; });
      }
    }
    this.draw();
  }

  _eject() {
    this.state = 'CLOSED';
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.elStatus.textContent = 'CLOSED';
    this.elMessage.textContent = '-- sin pista --';
    this.elElapsed.textContent = '00:00.0';
    this.elRemaining.textContent = '-00:00.0';
    // Apagar LEDs
    if (this.elLedStrip) {
      Array.from(this.elLedStrip.children).forEach(led => led.style.background = 'var(--led-off)');
    }
    this.draw();
  }

  load(track) {
    if (!track || !track.url) return;
    this.track = track;
    this.audio.src = track.url;
    this.audio.load();
    this.state = 'LOADING';
    this.draw();

    // Actualizar UI
    this.elMessage.textContent = track.name || '-- cargando --';
    this.elStatus.textContent = 'LOADING';
  }

  play() {
    const a = this.audio;
    if (!a.src) return;
    if (this.state === 'READY' || this.state === 'PAUSED' || this.state === 'ENDED') {
      a.play().then(() => { this.state = 'PLAYING'; this.draw(); });
    }
  }

  pause() {
    const a = this.audio;
    if (a && !a.paused) a.pause();
    this.state = 'PAUSED';
    this.draw();
  }

  stop() {
    const a = this.audio;
    if (a) {
      a.currentTime = 0;
      a.pause();
    }
    this.state = 'CLOSED';
    this.draw();
  }

  // Actualizar display cada frame
  draw() {
    const a = this.audio;
    const d = a.duration || 0;
    const ok = Number.isFinite(d) && d > 0;

    // Elapsed time
    this.elElapsed.textContent = ok ? this._formatTime(a.currentTime) : '00:00.0';

    // Remaining time
    this.elRemaining.textContent = ok ? '-' + this._formatTime(d - a.currentTime).slice(0) : '-00:00.0';

    // Progress bar width
    $('i', this.elElapsed.parentNode).style.width = ok ? (a.currentTime / d * 100) + '%' : '0%';

    // Vúmetro
    this._updateVuMeter();

    // LEDs - encender los últimos 36 segundos (un LED cada 3s)
    this._updateLEDs();

    // Estado de texto
    this.elStatus.textContent = this.state;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  _updateVuMeter() {
    if (!this.analyser) return;
    const b = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(b);

    let m = 0;
    for (const v of b) m = Math.max(m, Math.abs(v - 128));
    const level = m / 128; // -1 a 1

    this.lv = Math.max(this.lv * 0.9, level); // caída suave

    // Dibujar en el vúmetro del player
    const segs = $('#player-' + this.id + '-vu .vu-segment');
    if (!segs) return;

    // 12 segmentos, cada uno cubre un rango
    const segmentCount = segs.length;
    for (let i = 0; i < segmentCount; i++) {
      const threshold = (i + 1) / segmentCount; // de 1/12 a 12/12
      const isLit = this.lv >= threshold;

      const seg = segs[i];
      seg.style.background = isLit
        ? (i >= segmentCount - 2 ? '#ff2a2a' : i >= segmentCount - 4 ? '#ec3' : '#2bd13a')
        : 'var(--vu-off)';
    }

    // LEDs verdes junto a faders de canal siguen el mismo nivel (handled en main.js)
  }

  _updateLEDs() {
    if (!this.track || !this.audio || !this.elLedStrip) return;

    const d = this.audio.duration || 0;
    const current = this.audio.currentTime || 0;
    const remaining = Math.max(0, d - current);

    // Encender LEDs en los últimos 36 segundos (un LED cada 3s)
    // 36s / 3s = 12 LEDs máximo, pero solo encendemos los correspondientes
    const ledsToLight = Math.min(12, Math.floor(remaining / 3));

    Array.from(this.elLedStrip.children).forEach((led, i) => {
      if (i < ledsToLight) {
        led.style.background = 'var(--led-red)';
      } else {
        led.style.background = 'var(--led-off)';
      }
    });
  }
}

// Exportar clase global y helper $
if (typeof module === 'undefined') {
  window.Deck = Deck;
}

// Helper $
if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
}