// skins.js — Selector de pieles de la controladora.
// Sólo escribe un atributo data-skin en <html> y la clave hammer:skin.
// No lee ni modifica nada del grafo Web Audio, crossfader, pitch ni vúmetros.
'use strict';

(function () {
  const KEY = 'hammer:skin';
  const DEFAULT_SKIN = 'silver';

  // Única fuente de verdad. El <select> se construye desde aquí.
  const SKINS = [
    { id: 'silver', label: 'Plata / Metálica' },
    { id: 'blue', label: 'Azul' },
    { id: 'red', label: 'Rojo' },
    { id: 'dark', label: 'Negro oscuro' },
    { id: 'barca', label: 'Barça' }
  ];
  const VALID = new Set(SKINS.map(s => s.id));

  const Skins = {
    key: KEY,
    list: SKINS,
    current: DEFAULT_SKIN,
    _inited: false,

    init() {
      if (this._inited) return;
      this._inited = true;

      const select = document.getElementById('skin-select');
      if (select) {
        select.innerHTML = '';
        SKINS.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.label;
          select.appendChild(opt);
        });
        select.addEventListener('change', () => this.set(select.value));
      }

      // Un valor guardado corrupto o desconocido nunca rompe el arranque.
      this.set(this._read(), false);
    },

    _read() {
      try {
        const v = localStorage.getItem(KEY);
        return VALID.has(v) ? v : DEFAULT_SKIN;
      } catch (_) {
        return DEFAULT_SKIN;
      }
    },

    get() { return this.current; },

    set(id, persist = true) {
      // Sólo se acepta un id de la lista blanca: nunca se guarda contenido
      // arbitrario (ni, por supuesto, una URL blob:).
      const next = VALID.has(id) ? id : DEFAULT_SKIN;
      this.current = next;
      document.documentElement.setAttribute('data-skin', next);

      const select = document.getElementById('skin-select');
      if (select && select.value !== next) select.value = next;

      if (persist) {
        try { localStorage.setItem(KEY, next); } catch (_) { /* ignore */ }
        if (typeof window.setStatus === 'function') {
          const label = (SKINS.find(s => s.id === next) || {}).label || next;
          window.setStatus('Skin: ' + label);
        }
      }
      return next;
    }
  };

  window.Skins = Skins;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Skins.init());
  } else {
    Skins.init();
  }
})();
