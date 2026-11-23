// controls.js — Clase Fader reutilizable (vertical y horizontal)
// Implementación OBLIGATORIA: un <input type="range"> nativo transparente (opacity:0)
// a tamaño completo encima del dibujo, y el cabezal pintado se posiciona con el .value del input.
// Soporta arrastre con ratón y táctil, clic en la ranura, rueda del ratón, flechas de teclado y doble clic = valor por defecto.
// Orientación vertical con writing-mode: vertical-lr (+ direction: rtl para que el mínimo quede abajo).
// Si el tirador nativo y el dibujado no coinciden, ajusta márgenes hasta que coincidan.

(function() {
  'use strict';

  // Fader constructor
  class Fader {
    constructor(options = {}) {
      const defaultOpts = {
        min: -1,
        max: 1,
        step: 0.01,
        orientation: 'horizontal', // 'vertical' | 'horizontal'
        start: 0,
        onChange: null,
        onFinal: null
      };
      Object.assign(this, defaultOpts, options);

      // Create the native range input (transparent, full-size over the drawn knob)
      this.input = document.createElement('input');
      this.input.type = 'range';
      this.input.min = this.min;
      this.input.max = this.max;
      this.input.step = this.step;
      this.input.value = this.start;
      this.input.style.position = 'absolute';
      this.input.style.width = '100%';
      this.input.style.height = '100%';
      this.input.style.opacity = 0;
      this.input.style.cursor = 'pointer';
      this.input.style.zIndex = 1;

      // Container for the drawn elements
      this.container = document.createElement('div');
      this.container.style.position = 'relative';
      this.container.style.width = '100%';
      this.container.style.height = '100%';
      this.container.style.touchAction = 'none'; // enable drag

      // Draw the track (background bar)
      this.track = document.createElement('div');
      this.track.style.position = 'absolute';
      this.track.style.width = '100%';
      this.track.style.height = '100%';
      this.track.style.background = 'linear-gradient(var(--button-bg), var(--button-bg))';
      this.track.style.borderRadius = '3px';

      // Draw the knob/head - a visible indicator
      this.knob = document.createElement('div');
      this.knob.style.position = 'absolute';
      this.knob.style.width = Math.max(10, 20 + (this.max - this.min) * 2) + 'px';
      this.knob.style.height = Math.max(10, 20 + (this.max - this.min) * 2) + 'px';
      this.knob.style.background = 'var(--fader-knob)';
      this.knob.style.border = '1px solid var(--button-border)';
      this.knob.style.borderRadius = '50%';
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.knob.style.zIndex = 2;

      // Append elements to container
      this.container.appendChild(this.track);
      this.container.appendChild(this.knob);
      this.container.appendChild(this.input);

      // Append container to target if provided
      if (options.target) {
        options.target.appendChild(this.container);
      }

      // State
      this.dragging = false;
      this.touchId = null;

      // Bind methods
      this.handleInputChange = this.handleInputChange.bind(this);
      this.handleMouseDown = this.handleMouseDown.bind(this);
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseUp = this.handleMouseUp.bind(this);
      this.handleWheel = this.handleWheel.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);

      // Initialize
      this.setValue(this.start);
      this._attachEvents();
    }

    // Set value - updates both input and drawn knob
    setValue(v, skipInput = false) {
      const val = Math.max(this.min, Math.min(this.max, v));
      this.input.value = val;
      this.knob.style.transform = this._calcTransform(val);
      if (this.onChange && !skipInput) this.onChange(val);
      return val;
    }

    // Calculate transform for knob position
    _calcTransform(val) {
      const p = (val - this.min) / (this.max - this.min); // 0 to 1
      if (this.orientation === 'horizontal') {
        return `translateX(${p * 100}%)`;
      } else {
        // vertical: 0% = top, 100% = bottom (inverted because writing-mode)
        return `translateY(${p * 100}%)`;
      }
    }

    // Attach all event listeners
    _attachEvents() {
      // Input change (programmatic or arrow keys)
      this.input.addEventListener('input', this.handleInputChange);
      this.input.addEventListener('change', () => this.onFinal && this.onFinal(+this.input.value));

      // Mouse events
      this.container.addEventListener('mousedown', this.handleMouseDown);
      this.container.addEventListener('mouseup', () => this.dragging = false);
      this.container.addEventListener('mouseleave', () => this.dragging = false);

      // Touch events
      this.container.addEventListener('touchstart', this.handleMouseDown);
      this.container.addEventListener('touchend', () => this.dragging = false);
      this.container.addEventListener('touchmove', e => { if (this.dragging) this.handleTouchMove(e); }, { passive: false });

      // Wheel
      this.container.addEventListener('wheel', this.handleWheel, { passive: false });

      // Keyboard
      this.container.setAttribute('role', 'slider');
      this.container.setAttribute('aria-valuemin', this.min);
      this.container.setAttribute('aria-valuemax', this.max);
      this.container.setAttribute('aria-valuenow', this.start);
      this.container.addEventListener('keydown', this.handleKeyDown);
    }

    handleInputChange(e) {
      this.setValue(+e.target.value);
      if (this.onChange) this.onChange(+e.target.value);
    }

    handleMouseDown(e) {
      this.dragging = true;
      this._startX = e.clientX;
      this._startValue = +this.input.value;

      const onMouseMove = e => this._onDrag(e, 'horizontal');
      const onMouseUp = () => {
        this.dragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      // Prevent selection
      e.preventDefault();
    }

    handleTouchStart(e) {
      const touch = e.touches[0];
      this.dragging = true;
      this._startX = touch.clientX;
      this._startValue = +this.input.value;

      const onTouchMove = e => this._onTouchMove(e);
      const onTouchEnd = () => {
        this.dragging = false;
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
      };
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    }

    _onDrag(e, orientation) {
      if (!this.dragging) return;
      const rect = this.container.getBoundingClientRect();
      let delta;
      
      if (orientation === 'horizontal') {
        delta = e.clientX - this._startX;
        const newVal = this._startValue + delta / (rect.width / (this.max - this.min));
        this.setValue(newVal);
      } else {
        delta = e.clientY - this._startY;
        const newVal = this._startValue - delta / (rect.height / (this.max - this.min));
        this.setValue(newVal);
      }
    }

    _onTouchMove(e) {
      if (!this.dragging) return;
      const touch = e.touches[0];
      const rect = this.container.getBoundingClientRect();
      const deltaY = touch.clientY - this._startY;
      const newVal = +this._startValue - deltaY / (rect.height / (this.max - this.min));
      this.setValue(newVal);
    }

    handleWheel(e) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 : -1;
      const newVal = +this.input.value + delta * this.step;
      this.setValue(newVal);
    }

    handleKeyDown(e) {
      let newVal = +this.input.value;
      switch(e.key) {
        case 'ArrowRight': case 'ArrowUp': newVal += this.step; break;
        case 'ArrowLeft': case 'ArrowDown': newVal -= this.step; break;
        case 'Home': newVal = this.min; break;
        case 'End': newVal = this.max; break;
      }
      this.setValue(newVal);
    }

    // Public method to recalculate position if dimensions change
    recalculate() {
      this.setValue(+this.input.value);
    }
  }

  // Dial: mando circular para ratón (arrastre, rueda, doble clic = reset).
  // Sólo escribe una custom property (--dial-turn) y llama a onChange: no toca
  // ningún nodo de audio ni el crossfader.
  class Dial {
    constructor(options = {}) {
      this.el = options.el || null;
      if (!this.el) return;
      this.min = Number.isFinite(Number(options.min)) ? Number(options.min) : 0;
      this.max = Number.isFinite(Number(options.max)) ? Number(options.max) : 100;
      if (this.max <= this.min) this.max = this.min + 1;
      this.step = Number(options.step) > 0 ? Number(options.step) : 1;
      this.reset = Number.isFinite(Number(options.reset)) ? Number(options.reset) : this.min;
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
      this.value = this._clamp(Number(options.start));
      this._dragging = false;
      this._bind();
      this._render();
    }

    _clamp(v) {
      const n = Number.isFinite(Number(v)) ? Number(v) : this.min;
      return Math.max(this.min, Math.min(this.max, n));
    }

    setValue(v, silent = false) {
      this.value = this._clamp(v);
      this._render();
      if (!silent && this.onChange) this.onChange(this.value);
      return this.value;
    }

    _render() {
      const p = (this.value - this.min) / (this.max - this.min);
      this.el.style.setProperty('--dial-turn', (-135 + p * 270).toFixed(1) + 'deg');
      this.el.setAttribute('aria-valuenow', String(Math.round(this.value * 10) / 10));
    }

    _bind() {
      const el = this.el;
      el.addEventListener('wheel', (e) => {
        const dir = e.deltaY > 0 ? -1 : 1;
        const next = Math.max(this.min, Math.min(this.max, this.value + dir * this.step));
        if (next === this.value) return; // en el tope, deja desplazar la página
        e.preventDefault();
        this.setValue(next);
      }, { passive: false });

      // Sin setPointerCapture: el gesto se sigue en window y se libera al
      // soltar, salir del control o perder el foco. Nunca queda el ratón
      // "atrapado" impidiendo arrastrar una pista justo después.
      let pointerId = null;
      const onMove = (e) => {
        if (!this._dragging || e.pointerId !== pointerId) return;
        const span = this.max - this.min;
        const delta = (this._sy - e.clientY) + (e.clientX - this._sx);
        this.setValue(this._sv + (delta / 140) * span);
      };
      const onUp = (e) => {
        if (e && e.pointerId !== undefined && e.pointerId !== pointerId) return;
        this._dragging = false;
        pointerId = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('blur', onUp);
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        this._dragging = true;
        this._sx = e.clientX;
        this._sy = e.clientY;
        this._sv = this.value;
        pointerId = e.pointerId;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        window.addEventListener('blur', onUp);
      });

      el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.setValue(this.reset);
      });
      el.addEventListener('keydown', (e) => {
        let v = this.value;
        switch (e.key) {
          case 'ArrowUp': case 'ArrowRight': v += this.step; break;
          case 'ArrowDown': case 'ArrowLeft': v -= this.step; break;
          case 'Home': v = this.min; break;
          case 'End': v = this.max; break;
          default: return;
        }
        e.preventDefault();
        this.setValue(v);
      });
    }
  }

  // Exportar globalmente
  window.Fader = Fader;
  window.Dial = Dial;

  // Helper $
  if (typeof $ === 'undefined') {
    window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
  }
})();