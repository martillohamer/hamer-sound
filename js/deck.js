// deck.js — Clase Deck: audio real, máquina de estados y UI física
'use strict';

if (typeof $ === 'undefined') {
  window.$ = (sel, r = document) => {
    const e = r.querySelector(sel);
    if (!e) console.error('Falta elemento en el HTML:', sel);
    return e;
  };
}

const EQ_PRESETS = [
  { name: 'FLAT', low: 0, mid: 0, high: 0 },
  { name: 'BASS', low: 6, mid: -2, high: -2 },
  { name: 'TREBLE', low: -2, mid: 0, high: 6 },
  { name: 'VOCAL', low: -3, mid: 3, high: 3 }
];
const EQ_BANDS = ['low', 'mid', 'high'];
const EQ_RANGE = 12; // dB
const dbToGain = (db) => Math.pow(10, (Number(db) || 0) / 20);

class Deck {
  constructor(options = {}) {
    this.id = (options.id || 'a').toLowerCase(); // 'a' | 'b'
    this.root = options.root || null;
    this.ctx = options.ctx || window.ctx || null;
    this.xfade = options.xfade || window.xfade || null;

    this.state = 'CLOSED';
    this.track = null;
    this.audio = null;

    this.analyser = null;
    this.srcNode = null;
    this.inputGain = null;   // TRIM en dB (por deck, guardado por pista)
    this.trimGain = null;    // trim lineal heredado (#vol-b2, solo B)
    this.chGain = null;
    this.eqLow = null;
    this.eqMid = null;
    this.eqHigh = null;
    this.fxFilter = null;
    this.fxDry = null;
    this.fxDelay = null;
    this.fxFeedback = null;
    this.fxWet = null;
    this.usingGraph = false;
    this.fxType = 'off';
    this.fxEcho = false;
    this.fxEchoMix = 0.35;

    this._playCounted = false;
    this._brakeRaf = null;
    this._startRaf = null;

    this.volume = 0.8;
    this.trim = 1;           // trim lineal heredado (0-1)
    this.trimDb = 0;         // TRIM profesional (-12 .. +12 dB)
    this.eq = { low: 0, mid: 0, high: 0 }; // ganancias dB de LOW/MID/HIGH
    this.pitch = 0;          // -24 .. +24 (%)
    this.cuePoint = 0;
    this.lv = 0;
    this.eqIndex = 0;
    this.autoplayAfterLoad = false;

    this._initDOM();
    this._initAudio();
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  // ---------- DOM ----------
  _initDOM() {
    const r = this.root;
    if (!r) return;
    const q = (sel) => r.querySelector(sel);

    this.elStatus = q('#player-' + this.id + '-status');
    this.elElapsed = q('#player-' + this.id + '-elapsed');
    this.elRemaining = q('#player-' + this.id + '-remaining');
    this.elMessage = q('#player-' + this.id + '-msg');
    this.elVuMeter = q('.player-vu');
    this.elPitchDisplay = q('#player-' + this.id + '-pitch');
    this.elPitchFader = q('#player-' + this.id + '-pitch-fader');
    this.elCueBtn = q('[data-cue]');
    this.elPlayBtn = q('[data-play]');
    this.elExpelBtn = q('[data-expel]');
    this.elLedStrip = q('.led-strip');
    this.elProgress = q('.lcd-progress');
    this.elDetail = {
      title: q('#detail-' + this.id + '-title'),
      artist: q('#detail-' + this.id + '-artist'),
      folder: q('#detail-' + this.id + '-folder'),
      duration: q('#detail-' + this.id + '-duration'),
      left: q('#detail-' + this.id + '-left'),
      bpm: q('#detail-' + this.id + '-bpm'),
      pitch: q('#detail-' + this.id + '-pitch'),
      state: q('#detail-' + this.id + '-state')
    };

    this.btnPitchMinus = q('[data-pitch-minus]');
    this.btnPitchPlus = q('[data-pitch-plus]');
    this.btnPitchDefault = q('[data-pitch-default]');
    this.elTrackPrev = q('[data-track-prev]');
    this.elTrackEq = q('[data-track-eq]');
    this.elTrackRew = q('[data-track-rew]');
    this.elTrackFf = q('[data-track-ff]');

    // TRIM y EQ de 3 bandas (IDs por deck, ver index.html)
    const pid = (suffix) => '#player-' + this.id + '-' + suffix;
    this.elTrim = q(pid('trim'));
    this.elTrimOut = q(pid('trim-val'));
    this.elTrimReset = q(pid('trim-reset'));
    this.elEqReset = q(pid('eq-reset'));
    this.elEqBands = {};
    this.elEqOuts = {};
    EQ_BANDS.forEach(b => {
      this.elEqBands[b] = q(pid(b));
      this.elEqOuts[b] = q(pid(b + '-val'));
    });

    this.vuSegments = this.elVuMeter
      ? Array.from(this.elVuMeter.querySelectorAll('.vu-segment'))
      : [];
    this.leds = this.elLedStrip
      ? Array.from(this.elLedStrip.querySelectorAll('.led'))
      : [];
  }

  // ---------- Audio ----------
  _initAudio() {
    const a = this.audio = new Audio();
    a.preload = 'metadata';
    a.loop = false;
    // Con grafo Web Audio el volumen se controla en chGain; sin grafo, en el elemento.
    a.volume = 1;

    const xfGain = this._xfadeGain();
    const Ctx = window.initAudio ? window.initAudio() : (window.ctx || this.ctx);
    if (Ctx) this.ctx = Ctx;

    if (this.ctx && xfGain && typeof this.ctx.createMediaElementSource === 'function') {
      try {
        this.srcNode = this.ctx.createMediaElementSource(a);
        this.inputGain = this.ctx.createGain();
        this.trimGain = this.ctx.createGain();
        this.chGain = this.ctx.createGain();
        this.eqLow = this.ctx.createBiquadFilter();
        this.eqMid = this.ctx.createBiquadFilter();
        this.eqHigh = this.ctx.createBiquadFilter();
        this.analyser = this.ctx.createAnalyser();

        // Cadena de efectos: filtro (LP/HP) + eco en paralelo, TODO antes del
        // analizador y del crossfader para no romper vúmetros ni AUTO.
        this.fxFilter = this.ctx.createBiquadFilter();
        this.fxDry = this.ctx.createGain();
        this.fxDelay = this.ctx.createDelay(1.0);
        this.fxFeedback = this.ctx.createGain();
        this.fxWet = this.ctx.createGain();

        this.inputGain.gain.value = dbToGain(this.trimDb);
        this.trimGain.gain.value = this.trim;
        this.chGain.gain.value = this.volume;
        this.eqLow.type = 'lowshelf';
        this.eqLow.frequency.value = 200;
        this.eqLow.gain.value = this.eq.low;
        this.eqMid.type = 'peaking';
        this.eqMid.frequency.value = 1000;
        this.eqMid.Q.value = 1;
        this.eqMid.gain.value = this.eq.mid;
        this.eqHigh.type = 'highshelf';
        this.eqHigh.frequency.value = 3200;
        this.eqHigh.gain.value = this.eq.high;
        this.fxFilter.type = 'allpass';           // transparente mientras OFF
        this.fxFilter.frequency.value = 20000;
        this.fxDry.gain.value = 1;
        this.fxDelay.delayTime.value = 0.28;
        this.fxFeedback.gain.value = 0;
        this.fxWet.gain.value = 0;
        this.analyser.fftSize = 256;
        // Reutilizar el búfer evita allocar 60 veces por segundo por deck.
        this._vuBuf = new Uint8Array(this.analyser.frequencyBinCount);

        // TRIM → LOW → MID → HIGH → FX → chGain → analyser → crossfader.
        // El analizador sigue detrás de chGain y delante del crossfader
        // (invariante de vúmetros): los vúmetros y AUTO no cambian.
        this.srcNode.connect(this.inputGain);
        this.inputGain.connect(this.trimGain);
        this.trimGain.connect(this.eqLow);
        this.eqLow.connect(this.eqMid);
        this.eqMid.connect(this.eqHigh);
        this.eqHigh.connect(this.fxFilter);
        this.fxFilter.connect(this.fxDry);
        this.fxDry.connect(this.chGain);
        // Send de eco: filtro → delay → (realimentación + wet) → canal
        this.fxFilter.connect(this.fxDelay);
        this.fxDelay.connect(this.fxFeedback);
        this.fxFeedback.connect(this.fxDelay);
        this.fxDelay.connect(this.fxWet);
        this.fxWet.connect(this.chGain);
        this.chGain.connect(this.analyser);
        this.analyser.connect(xfGain || window.masterGain || this.ctx.destination);

        this.usingGraph = true;
      } catch (err) {
        console.warn('Deck ' + this.id + ': no se pudo montar el grafo Web Audio', err);
        this.usingGraph = false;
      }
    }

    if (!this.usingGraph) {
      console.warn('Deck ' + this.id + ': audio sin grafo (crossfader no aplicable al sonido).');
    }

    // Eventos del elemento de audio
    a.addEventListener('loadedmetadata', () => { this.applyPitch(); this.draw(); });
    a.addEventListener('canplay', () => { if (this.state === 'LOADING') this.setState('READY'); });
    a.addEventListener('play', () => {
      this.setState('PLAYING');
      // Un tema cuenta una sola vez por carga: reanudar tras pausa no suma.
      if (!this._playCounted && this.track) {
        this._playCounted = true;
        if (typeof window.onDeckPlay === 'function') window.onDeckPlay(this);
      }
    });
    a.addEventListener('playing', () => { this.setState('PLAYING'); });
    a.addEventListener('pause', () => { if (this.state === 'PLAYING') this.setState('PAUSED'); });
    a.addEventListener('timeupdate', () => this.draw());
    a.addEventListener('ended', () => this._onEnded());
    a.addEventListener('error', () => {
      if (!a.src) return;
      this.setState('ERROR');
      this.showMessage('NOT LOADED! No se pudo decodificar el archivo');
    });

    // Pitch
    if (this.elPitchFader) {
      this.pitch = Number(this.elPitchFader.value) || 0;
      this.elPitchFader.addEventListener('input', () => this.setPitch(Number(this.elPitchFader.value)));
    }
    if (this.btnPitchMinus) this.btnPitchMinus.addEventListener('click', () => this.nudgePitch(-1));
    if (this.btnPitchPlus) this.btnPitchPlus.addEventListener('click', () => this.nudgePitch(1));
    if (this.btnPitchDefault) this.btnPitchDefault.addEventListener('click', () => this.setPitch(0));

    // Transporte
    if (this.elCueBtn) this.elCueBtn.addEventListener('click', () => this.cue());
    if (this.elPlayBtn) this.elPlayBtn.addEventListener('click', () => this._playToggle());
    if (this.elExpelBtn) this.elExpelBtn.addEventListener('click', () => this.eject());
    if (this.elTrackPrev) this.elTrackPrev.addEventListener('click', () => this._adjacent(-1));
    if (this.elTrackEq) this.elTrackEq.addEventListener('click', () => this._cycleEq());

    // TRIM / EQ: arrastre, rueda, doble clic y botones de reinicio
    this._bindEqUI();

    // Ratón: drag & drop, LCD, barra de progreso, rueda de pitch y «/» con mantenido
    this._bindPointerUI();
  }

  // ---------- Interacción con el ratón ----------
  _bindPointerUI() {
    const r = this.root;
    if (!r) return;
    r.classList.add('drop-target');

    const dragTypes = (e) => {
      const dt = e.dataTransfer;
      const types = dt ? Array.from(dt.types || []) : [];
      return {
        files: types.includes('Files') || !!(dt && dt.files && dt.files.length),
        row: types.includes('text/plain')
      };
    };

    // Un archivo del explorador o una fila de la biblioteca pueden caer en este deck.
    // stopPropagation() evita que el manejador global de la app vuelva a añadir el archivo.
    const acceptDrag = (e) => {
      const t = dragTypes(e);
      if (!t.files && !t.row) return false;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      r.classList.add('drag-over');
      return true;
    };
    r.addEventListener('dragenter', acceptDrag);
    r.addEventListener('dragover', acceptDrag);
    r.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !r.contains(e.relatedTarget)) r.classList.remove('drag-over');
    });
    r.addEventListener('drop', (e) => {
      const t = dragTypes(e);
      if (!t.files && !t.row) return;
      e.preventDefault();
      e.stopPropagation();
      r.classList.remove('drag-over');

      // Archivos: se añaden a la biblioteca y el primero se carga en este deck.
      if (t.files && e.dataTransfer.files && e.dataTransfer.files.length) {
        const lib = window.Library;
        const tracks = lib && typeof lib.addFiles === 'function'
          ? lib.addFiles(e.dataTransfer.files) : [];
        if (tracks.length) {
          if (typeof lib.select === 'function') lib.select(tracks[0]);
          this.load(tracks[0]);
          this.showMessage(tracks[0].name);
          window.setStatus && window.setStatus('Player ' + this.id.toUpperCase() + ' ← ' + tracks[0].title);
        }
        return;
      }

      // Fila de la biblioteca: arrastrar y soltar también carga en este deck.
      const id = e.dataTransfer && e.dataTransfer.getData('text/plain');
      if (!id || !window.Library) return;
      const track = window.Library.tracks.find(t => String(t.id) === String(id));
      if (track) {
        window.Library.select(track);
        this.load(track);
        this.showMessage(track.name);
        window.setStatus && window.setStatus(track.title + ' → Player ' + this.id.toUpperCase());
      }
    });

    // Clic en una LCD vacía (CLOSED): selector de archivos directo para este deck.
    const lcd = r.querySelector('.lcd');
    this.elLcd = lcd;
    if (lcd) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.opus';
      input.multiple = true;
      input.hidden = true;
      input.className = 'deck-file-input';
      r.appendChild(input);
      this.elFileInput = input;

      input.addEventListener('change', () => {
        const lib = window.Library;
        const tracks = lib && typeof lib.addFiles === 'function'
          ? lib.addFiles(input.files) : [];
        if (tracks.length) {
          if (typeof lib.select === 'function') lib.select(tracks[0]);
          this.load(tracks[0]);
          this.showMessage(tracks[0].name);
        }
        input.value = '';
      });

      lcd.addEventListener('click', (e) => {
        if (e.target.closest('.lcd-info')) return;              // INFO tiene su propio listener
        if (this.track && e.target.closest('.lcd-timer')) return; // el timer es zona de seek
        if (this.track) return;                                 // LCD ocupada: no se recarga
        e.preventDefault();
        input.click();
      });

      const timer = r.querySelector('.lcd-timer');
      if (timer) this._bindLcdSeek(timer);
    }

    // Rueda del ratón sobre el fader de pitch (y sobre todo el bloque PITCH).
    if (this.elPitchFader) {
      const onPitchWheel = (e) => {
        e.preventDefault();
        const step = Number(this.elPitchFader.step) || 0.5;
        this.nudgePitch((e.deltaY > 0 ? -1 : 1) * step);
      };
      this.elPitchFader.addEventListener('wheel', onPitchWheel, { passive: false });
      const pitchBlock = r.querySelector('.pitch-block');
      if (pitchBlock) {
        pitchBlock.addEventListener('wheel', (e) => {
          if (e.target !== this.elPitchFader) onPitchWheel(e);
        }, { passive: false });
      }
    }

    // « y »: clic = ±10 s; mantener pulsado = saltos cada vez mayores.
    this._bindSeekHold(this.elTrackRew, -1);
    this._bindSeekHold(this.elTrackFf, 1);
  }

  _bindLcdSeek(timer) {
    let dragging = false;
    const seekFromEvent = (e) => {
      const a = this.audio;
      if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
      const box = timer.getBoundingClientRect();
      if (!box || !box.width) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      this._seekTo(ratio * a.duration);
    };
    timer.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!this.track || !Number.isFinite(this.audio.duration)) return;
      dragging = true;
      try { timer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      seekFromEvent(e);
      e.preventDefault();
    });
    timer.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
    const stop = (e) => {
      dragging = false;
      try { timer.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    timer.addEventListener('pointerup', stop);
    timer.addEventListener('pointercancel', stop);
  }

  _bindSeekHold(btn, dir) {
    if (!btn) return;
    let delayTimer = null, repeatTimer = null, step = 10, repeated = false;

    const stop = () => {
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
      if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
    };
    const start = (e) => {
      if (e.type === 'mousedown' && e.button !== 0) return;
      stop();
      step = 10;
      repeated = false;
      delayTimer = setTimeout(() => {
        const tick = () => {
          this.seek(dir * step);
          step = Math.min(120, step * 1.6);
          repeated = true;
          repeatTimer = setTimeout(tick, 90);
        };
        tick();
      }, 250);
    };

    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('mouseleave', stop);
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
    btn.addEventListener('click', () => {
      stop();
      if (!repeated) this.seek(dir * 10);
      repeated = false;
    });
  }

  _xfadeGain() {
    if (!this.xfade) return null;
    const key = this.id.toUpperCase();
    const slot = this.xfade[key] || this.xfade[this.id];
    return slot ? slot.gain : null;
  }

  // ---------- Estados ----------
  setState(s) {
    this.state = s;
    if (this.elStatus) this.elStatus.textContent = s;
    this.draw();
  }

  showMessage(text) {
    if (this.elMessage) this.elMessage.textContent = text;
  }

  get info() {
    if (!this.track) return '';
    const d = this.audio && Number.isFinite(this.audio.duration) ? this._formatTime(this.audio.duration) : '--:--.-';
    return [this.track.artist, this.track.title, d].filter(Boolean).join(' · ');
  }

  // ---------- Carga y reproducción ----------
  load(track, autoplay = false) {
    if (!track || !track.url) return Promise.resolve(false);
    this._cancelMotion();
    this.track = track;
    this.autoplayAfterLoad = autoplay;
    this._playCounted = false;
    this.cuePoint = 0;
    // TRIM guardado por pista (solo metadatos; la URL blob: nunca se persiste).
    if (typeof track.trimDb === 'number' && Number.isFinite(track.trimDb)) {
      this.setTrimDb(track.trimDb);
    }
    this.setState('LOADING');
    this.showMessage(track.name || '-- cargando --');
    this.audio.src = track.url;
    this.audio.load();
    this.applyPitch();

    return new Promise((resolve) => {
      const done = (ok) => {
        this.audio.removeEventListener('canplay', onReady);
        this.audio.removeEventListener('error', onErr);
        if (ok && this.autoplayAfterLoad) {
          this.autoplayAfterLoad = false;
          this.play();
        }
        resolve(ok);
      };
      const onReady = () => done(true);
      const onErr = () => done(false);
      this.audio.addEventListener('canplay', onReady);
      this.audio.addEventListener('error', onErr);
    });
  }

  play() {
    // Si el usuario pulsa PLAY durante un frenado, se cancela el freno y se
    // devuelve la velocidad a la base antes de reanudar.
    if (this._brakeRaf) {
      cancelAnimationFrame(this._brakeRaf);
      this._brakeRaf = null;
      try { this.audio.playbackRate = this._baseRate(); } catch (_) { /* ignore */ }
    }
    if (!this.audio.src) {
      if (this.track && this.track.url) return this.load(this.track, true);
      return Promise.resolve(false);
    }
    const p = this.audio.play();
    if (!p) { this.setState('PLAYING'); return Promise.resolve(true); }
    return p.then(() => { this.setState('PLAYING'); return true; })
      .catch((err) => {
        // Autoplay bloqueado o archivo no reproducible
        this.showMessage('PLAY ERROR: ' + (err && err.name ? err.name : 'desconocido'));
        return false;
      });
  }

  pause() {
    if (this.audio && !this.audio.paused) this.audio.pause();
    if (this.state === 'PLAYING') this.setState('PAUSED');
  }

  stop() {
    if (this.audio) {
      this.audio.pause();
      try { this.audio.currentTime = 0; } catch (_) { /* ignore */ }
    }
    this.setState('CLOSED');
  }

  eject() {
    this._cancelMotion();
    this.stop();
    if (this.audio) {
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.track = null;
    this.cuePoint = 0;
    this.lv = 0;
    this.showMessage('-- sin pista --');
    if (this.elMessage) this.elMessage.textContent = '-- sin pista --';
    this.leds.forEach(led => { led.style.background = 'var(--led-off)'; });
  }

  _playToggle() {
    if (!this.audio.src) { this.play(); return; }
    if (this.state === 'PLAYING') this.pause();
    else this.play();
  }

  _onEnded() {
    this.setState('ENDED');
    this.leds.forEach(led => { led.style.background = 'var(--led-red)'; });
    if (window.Library) window.Library.markPlayed(this.track);
    if (typeof window.onDeckEnded === 'function') window.onDeckEnded(this);
  }

  // ---------- CUE ----------
  cue() {
    if (!this.audio.src || !this.track) {
      this.showMessage('NOT LOADED! Invalid floating point operation');
      return;
    }
    const t = this.audio.currentTime || 0;
    const atCue = Math.abs(t - this.cuePoint) < 0.2;

    if (!atCue) {
      // Volver al punto cue
      this._seekTo(this.cuePoint);
      this.showMessage('CUE  ' + this._formatTime(this.cuePoint));
    } else if (this.state === 'PLAYING') {
      // En el punto cue y sonando: pausar (comportamiento clásico de deck)
      this.pause();
      this.showMessage('CUE  ' + this._formatTime(this.cuePoint) + '  (PAUSA)');
    } else {
      // En el punto cue y parado: marcar aquí el nuevo punto cue
      this.cuePoint = t;
      this.showMessage('CUE SET  ' + this._formatTime(t));
    }
  }

  // ---------- Pitch ----------
  setPitch(v) {
    v = Math.max(-24, Math.min(24, Number(v) || 0));
    this.pitch = v;
    if (this.elPitchFader) this.elPitchFader.value = String(v);
    if (this.elPitchDisplay) {
      this.elPitchDisplay.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    }
    this.applyPitch();
    return v;
  }

  _baseRate() {
    // playbackRate de <audio> es un número (no AudioParam): el freno/arranque
    // se hace con requestAnimationFrame, sin tocar el grafo de audio.
    return Math.max(0.1, 1 + this.pitch / 100);
  }

  applyPitch() {
    if (this.audio && !this._brakeRaf && !this._startRaf) {
      this.audio.playbackRate = this._baseRate();
    }
  }

  nudgePitch(delta) { this.setPitch(this.pitch + delta); }
  resetPitch() { this.setPitch(0); }

  // ---------- Efectos (Web Audio API) ----------
  setFilter(type, freq) {
    this.fxType = (type === 'lp' || type === 'hp') ? type : 'off';
    if (!this.fxFilter || !this.ctx) return;
    const target = Number.isFinite(freq) ? Math.max(40, Math.min(20000, freq)) : 20000;
    this.fxFilter.type = this.fxType === 'off' ? 'allpass'
      : (this.fxType === 'lp' ? 'lowpass' : 'highpass');
    this.fxFilter.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.012);
    this.showMessage('FILTER  ' + (this.fxType === 'off' ? 'OFF' : this.fxType.toUpperCase()) +
      '  ' + Math.round(target) + ' Hz');
  }

  setEcho(on, mix) {
    this.fxEcho = !!on;
    this.fxEchoMix = Math.max(0, Math.min(1, Number(mix) || 0));
    if (!this.fxWet || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.fxWet.gain.setTargetAtTime(this.fxEcho ? this.fxEchoMix : 0, t, 0.02);
    this.fxFeedback.gain.setTargetAtTime(
      this.fxEcho ? Math.min(0.45, 0.2 + this.fxEchoMix * 0.25) : 0, t, 0.02);
    this.showMessage('ECHO  ' + (this.fxEcho ? Math.round(this.fxEchoMix * 100) + '%' : 'OFF'));
  }

  // ---------- Frenado / arranque de plato ----------
  _cancelMotion() {
    if (this._brakeRaf) { cancelAnimationFrame(this._brakeRaf); this._brakeRaf = null; }
    if (this._startRaf) { cancelAnimationFrame(this._startRaf); this._startRaf = null; }
    if (this.audio) {
      try { this.audio.playbackRate = this._baseRate(); } catch (_) { /* ignore */ }
    }
  }

  brake(seconds = 1.4) {
    if (!this.track || !this.audio.src) { this.showMessage('BRAKE: sin pista cargada'); return false; }
    if (this._brakeRaf || this._startRaf) return false;
    const a = this.audio;
    if (a.paused) { this.showMessage('BRAKE: plato ya parado'); return false; }
    this._cancelMotion();
    const from = a.playbackRate || 1;
    const t0 = performance.now();
    const ms = Math.max(200, Number(seconds) * 1000);
    this.setState('BRAKING');
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.playbackRate = Math.max(0.1, from * (1 - k));
      if (k < 1) {
        this._brakeRaf = requestAnimationFrame(tick);
      } else {
        this._brakeRaf = null;
        try { a.pause(); } catch (_) { /* ignore */ }
        a.playbackRate = this._baseRate();
        this.setState('PAUSED');
        this.showMessage('BRAKE  ' + this._formatTime(a.currentTime || 0));
      }
    };
    this._brakeRaf = requestAnimationFrame(tick);
    return true;
  }

  start(seconds = 0.9) {
    if (!this.track || !this.audio.src) { this.showMessage('START: sin pista cargada'); return false; }
    if (this._brakeRaf || this._startRaf) return false;
    this._cancelMotion();
    const a = this.audio;
    a.playbackRate = 0.1;
    const t0 = performance.now();
    const ms = Math.max(200, Number(seconds) * 1000);
    this.play();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      a.playbackRate = 0.1 + (this._baseRate() - 0.1) * k;
      if (k < 1) {
        this._startRaf = requestAnimationFrame(tick);
      } else {
        this._startRaf = null;
        a.playbackRate = this._baseRate();
        this.showMessage('START  ' + this._formatTime(a.currentTime || 0));
      }
    };
    this._startRaf = requestAnimationFrame(tick);
    return true;
  }

  // ---------- Volumen / trim / EQ ----------
  _applyNativeVolume() {
    if (!this.usingGraph && this.audio) {
      // Sin Web Audio todo se aplica en el elemento <audio>.
      this.audio.volume = Math.max(0, Math.min(1,
        this.volume * this.trim * dbToGain(this.trimDb)));
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.usingGraph && this.chGain) this.chGain.gain.value = this.volume;
    else this._applyNativeVolume();
  }

  // Trim lineal heredado del mezclador (#vol-b2). Se conserva tal cual.
  setTrim(v) {
    this.trim = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.usingGraph && this.trimGain) this.trimGain.gain.value = this.trim;
    else this._applyNativeVolume();
  }

  // TRIM profesional en dB (-12 .. +12), guardado por pista si procede.
  setTrimDb(db) {
    const v = Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Number(db) || 0));
    this.trimDb = v;
    const gain = dbToGain(v);
    if (this.usingGraph && this.inputGain) {
      try { this.inputGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.01); }
      catch (_) { this.inputGain.gain.value = gain; }
    } else {
      this._applyNativeVolume();
    }
    this._syncEqUI();
    return v;
  }

  resetTrim() {
    this.setTrimDb(0);
    this._persistTrim();
    this.showMessage('TRIM  0.0 dB');
  }

  _persistTrim() {
    const lib = window.Library;
    if (this.track && lib && typeof lib.setTrackTrim === 'function') {
      lib.setTrackTrim(this.track, this.trimDb);
    }
  }

  _setBand(band, db) {
    if (EQ_BANDS.indexOf(band) < 0) return 0;
    const v = Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Number(db) || 0));
    this.eq[band] = v;
    const node = band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh;
    if (node) {
      try { node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.012); }
      catch (_) { node.gain.value = v; }
    }
    return v;
  }

  // Un ajuste manual rompe el preset; el botón «=» vuelve a recorrerlos.
  setEqBand(band, db) {
    const v = this._setBand(band, db);
    this.eqIndex = 0;
    if (this.elTrackEq) this.elTrackEq.classList.remove('active');
    this._syncEqUI();
    this.showMessage('EQ ' + band.toUpperCase() + '  ' + this._fmtDb(v));
    return v;
  }

  _cycleEq() {
    this.eqIndex = (this.eqIndex + 1) % EQ_PRESETS.length;
    const p = EQ_PRESETS[this.eqIndex];
    EQ_BANDS.forEach(b => this._setBand(b, p[b] || 0));
    if (this.elTrackEq) this.elTrackEq.classList.toggle('active', this.eqIndex !== 0);
    this._syncEqUI();
    this.showMessage('EQ  ' + p.name);
  }

  resetEq() {
    EQ_BANDS.forEach(b => this._setBand(b, 0));
    this.eqIndex = 0;
    if (this.elTrackEq) this.elTrackEq.classList.remove('active');
    this._syncEqUI();
    this.showMessage('EQ  FLAT  (0 dB)');
  }

  _fmtDb(db) {
    const v = Number(db) || 0;
    return (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
  }

  _syncEqUI() {
    if (this.elTrim) this.elTrim.value = String(this.trimDb);
    if (this.elTrimOut) this.elTrimOut.textContent = this._fmtDb(this.trimDb);
    EQ_BANDS.forEach(b => {
      const input = this.elEqBands[b];
      if (input) input.value = String(this.eq[b]);
      const out = this.elEqOuts[b];
      if (out) out.textContent = this._fmtDb(this.eq[b]);
    });
  }

  _bindEqUI() {
    // Arrastre nativo del range + rueda; doble clic y botón = vuelta a 0 dB.
    const bindFader = (input, apply, onCommit) => {
      if (!input) return;
      input.addEventListener('input', () => apply(Number(input.value)));
      input.addEventListener('change', () => { if (onCommit) onCommit(); });
      input.addEventListener('dblclick', (e) => {
        e.preventDefault();
        apply(0);
        if (onCommit) onCommit();
      });
      input.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = Number(input.step) || 0.5;
        apply(Number(input.value) + (e.deltaY > 0 ? -step : step));
        if (onCommit) onCommit();
      }, { passive: false });
    };

    const trimCommit = () => this._persistTrim();
    bindFader(this.elTrim, (v) => this.setTrimDb(v), trimCommit);
    EQ_BANDS.forEach(b => bindFader(this.elEqBands[b], (v) => this.setEqBand(b, v)));
    if (this.elTrimReset) this.elTrimReset.addEventListener('click', () => this.resetTrim());
    if (this.elEqReset) this.elEqReset.addEventListener('click', () => this.resetEq());
    this._syncEqUI();
  }

  // ---------- Navegación / seek ----------
  seek(delta) {
    if (!this.audio.src || !Number.isFinite(this.audio.duration)) return;
    this._seekTo(this.audio.currentTime + delta);
  }

  _seekTo(t) {
    if (!Number.isFinite(this.audio.duration)) return;
    const d = this.audio.duration;
    try { this.audio.currentTime = Math.max(0, Math.min(d - 0.05, t)); } catch (_) { /* ignore */ }
    this.draw();
  }

  _adjacent(dir) {
    if (window.Library && typeof window.Library.loadAdjacent === 'function') {
      window.Library.loadAdjacent(this.id, dir);
    }
  }

  // ---------- Bucle de dibujo ----------
  _tick() {
    this.draw();
    this._raf = requestAnimationFrame(this._tick);
  }

  draw() {
    const a = this.audio;
    if (!a) return;
    const d = a.duration;
    const ok = Number.isFinite(d) && d > 0;
    const cur = a.currentTime || 0;

    if (this.elElapsed) this.elElapsed.textContent = ok ? this._formatTime(cur) : '00:00.0';
    if (this.elRemaining) this.elRemaining.textContent = ok ? '-' + this._formatTime(d - cur) : '-00:00.0';
    if (this.elProgress) this.elProgress.style.width = ok ? (cur / d * 100).toFixed(2) + '%' : '0%';
    if (this.elStatus) this.elStatus.textContent = this.state;
    if (this.elLcd) this.elLcd.classList.toggle('lcd-loadable', !this.track);

    this._drawDetail(ok, d, cur);
    this._drawConsoleButtons(cur);
    this._updateVu();
    this._updateLEDs();
  }

  // LCD ampliada: título, artista, carpeta, duración, resto, BPM, pitch y estado.
  _drawDetail(ok, d, cur) {
    const det = this.elDetail;
    if (!det) return;
    const set = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
    const t = this.track;
    set(det.title, t ? (t.title || t.name) : '—');
    set(det.artist, t ? (t.artist || '—') : '—');
    set(det.folder, t && window.Library ? window.Library.folderName(t.folder) : '—');
    set(det.duration, ok ? this._formatShort(d) : '--:--');
    set(det.left, ok ? this._formatShort(Math.max(0, d - cur)) : '--:--');
    set(det.bpm, t ? String(t.bpm || '---') : '---');
    set(det.pitch, (this.pitch > 0 ? '+' : '') + this.pitch.toFixed(1) + '%');
    set(det.state, this.state);
    const cell = det.state && det.state.parentElement;
    if (cell) {
      cell.classList.toggle('live', this.state === 'PLAYING' || this.state === 'BRAKING');
      cell.classList.toggle('warn', this.state === 'ERROR' || this.state === 'ENDED');
    }
  }

  // Botones de consola con respuesta visual: PLAY/PAUSA, CUE en punto, EJECT inactivo.
  _drawConsoleButtons(cur) {
    const playing = this.state === 'PLAYING' || this.state === 'BRAKING';
    if (this.elPlayBtn) {
      const label = playing ? '❚❚' : '▶';
      if (this.elPlayBtn.textContent !== label) this.elPlayBtn.textContent = label;
      this.elPlayBtn.classList.toggle('active', playing);
      this.elPlayBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    }
    if (this.elCueBtn) {
      this.elCueBtn.classList.toggle('active', !!this.track && Math.abs(cur - this.cuePoint) < 0.2);
    }
    if (this.elExpelBtn) this.elExpelBtn.disabled = !this.track;
    if (this.elTrackEq) this.elTrackEq.classList.toggle('active', this.eqIndex !== 0);
  }

  _formatShort(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  _formatTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const tenth = Math.floor((s % 1) * 10);
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + tenth;
  }

  _updateVu() {
    let level = 0;
    if (this.analyser && this.usingGraph) {
      const buf = this._vuBuf;
      this.analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      level = peak / 128;
    } else if (this.state === 'PLAYING') {
      // Vúmetro visual aunque no haya Web Audio
      level = 0.35 + 0.22 * Math.abs(Math.sin(performance.now() / 130 + (this.id === 'b' ? 1 : 0)));
    }

    // El analizador está después de VOL/TRIM/EQ pero antes del crossfader.
    // Aplicamos su ganancia para que el vúmetro del player baje al mover
    // el crossfader con ratón o rueda, igual que el sonido que se escucha.
    if (level > 0 && window.getXfGain) level *= window.getXfGain(this.id);

    // Ataque rápido / caída suave: lectura fluida sin parpadeos.
    this.lv = Math.max(this.lv * 0.86, Math.min(1, level));

    const n = this.vuSegments.length;
    for (let i = 0; i < n; i++) {
      const lit = this.lv >= (i + 1) / n;
      const seg = this.vuSegments[i];
      seg.style.background = lit
        ? (i >= n - 2 ? 'var(--led-rojo)' : i >= n - 4 ? '#ec3' : 'var(--led-verde)')
        : 'var(--vu-off)';
    }
  }

  _updateLEDs() {
    if (!this.track || !this.audio || !this.leds.length) return;
    const d = this.audio.duration || 0;
    const cur = this.audio.currentTime || 0;
    const remaining = Math.max(0, d - cur);
    const lit = Math.min(this.leds.length, Math.floor(remaining / 3));
    this.leds.forEach((led, i) => {
      led.style.background = i < lit ? 'var(--led-rojo)' : 'var(--led-off)';
    });
  }
}

window.Deck = Deck;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Deck };
}
