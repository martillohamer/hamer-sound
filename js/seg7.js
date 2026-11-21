// seg7.js — Renderizador de dígitos de 7 segmentos con SVG
// Soporta 0-9, ':', '-' y '.'
// Los segmentos apagados se ven fantasma (opacity .3)
(function() {
  // Segment definition: which segments are lit for each digit/char
  // Order: top, upper-right, lower-right, bottom, lower-left, upper-left, middle
  const digitSegments = {
    '0': [1,1,1,1,1,1,0], '1': [0,1,1,0,0,0,0], '2': [1,1,0,1,1,0,1], '3': [1,1,1,1,0,0,1],
    '4': [0,1,1,0,0,1,1], '5': [1,0,1,1,0,1,1], '6': [1,0,1,1,1,1,1], '7': [1,1,1,0,0,0,0],
    '8': [1,1,1,1,1,1,1], '9': [1,1,1,1,0,1,1], ':': [0,0,0,0,0,0,0], '-': [0,0,0,1,0,0,0], '.': [0,0,0,0,0,0,1]
  };

  // SVG segment paths (relative to a 100×100 glyph box)
  const segmentPaths = {
    0: 'M10,10 L90,10 L90,20 M90,20 L10,20',   // top horizontal
    1: 'M90,10 L90,90 L20,90',                   // upper-right vertical
    2: 'M10,90 L20,90 L20,100 L10,100',          // lower-right vertical + bottom
    3: 'M10,100 L90,100 L90,90',                 // bottom horizontal + lower-right
    4: 'M10,20 L10,90 L20,90',                   // lower-left vertical + middle start
    5: 'M10,90 L90,90 M50,10 L50,20',            // middle horizontal + top-left
    6: 'M10,20 L10,90 M50,10 L50,20',            // left vertical + top-left (combined)
    7: 'M10,10 L90,10 M50,10 L50,20'             // top horizontal only
  };

  // Actually let me use a simpler approach - define paths as strings
  // I'll build the glyph from rect elements

  function createGlyph(char, size) {
    size = size || 100;
    const ns = 'http://www.w3.org/2000/svg';
    const glyph = document.createElementNS(ns, 'g');
    glyph.setAttribute('class', 'seg7-glyph');
    glyph.setAttribute('data-char', char);
    
    // Define 7 segments as paths
    const segLen = size * 0.9;
    const gap = size * 0.1;
    
    // Top horizontal
    const top = document.createElementNS(ns, 'path');
    top.setAttribute('data-seg', 'top');
    top.setAttribute('stroke', '#fff');
    top.setAttribute('stroke-width', Math.max(1, size * 0.1));
    top.setAttribute('opacity', char === '.' ? .3 : 1);
    // M10,10 -> L90,10 (approximate, will be set properly)
    top.setAttribute('d', `M${gap} ${gap} L${size-gap} ${gap}`);
    glyph.appendChild(top);
    
    // Upper-right vertical
    const ur = document.createElementNS(ns, 'path');
    ur.setAttribute('data-seg', 'ur');
    ur.setAttribute('stroke', '#fff');
    ur.setAttribute('stroke-width', Math.max(1, size * 0.1));
    ur.setAttribute('opacity', char === '.' ? .3 : 1);
    ur.setAttribute('d', `M${size-gap} ${gap} L${size-gap} ${size-gap}`);
    glyph.appendChild(ur);
    
    // Lower-right vertical
    const lr = document.createElementNS(ns, 'path');
    lr.setAttribute('data-seg', 'lr');
    lr.setAttribute('stroke', '#fff');
    lr.setAttribute('stroke-width', Math.max(1, size * 0.1));
    lr.setAttribute('opacity', char === '.' ? .3 : 1);
    lr.setAttribute('d', `M${size-gap} ${size-gap} L${size-gap} ${size-gap*2}`);
    glyph.appendChild(lr);
    
    // Bottom horizontal
    const bot = document.createElementNS(ns, 'path');
    bot.setAttribute('data-seg', 'bottom');
    bot.setAttribute('stroke', '#fff');
    bot.setAttribute('stroke-width', Math.max(1, size * 0.1));
    bot.setAttribute('opacity', char === '.' ? .3 : 1);
    bot.setAttribute('d', `M${gap} ${size-gap*2} L${size-gap} ${size-gap*2}`);
    glyph.appendChild(bot);
    
    // Lower-left vertical
    const ll = document.createElementNS(ns, 'path');
    ll.setAttribute('data-seg', 'll');
    ll.setAttribute('stroke', '#fff');
    ll.setAttribute('stroke-width', Math.max(1, size * 0.1));
    ll.setAttribute('opacity', char === '.' ? .3 : 1);
    ll.setAttribute('d', `M${gap} ${size-gap*2} L${gap} ${size-gap*2+gap}`);
    glyph.appendChild(ll);
    
    // Upper-left vertical
    const ul = document.createElementNS(ns, 'path');
    ul.setAttribute('data-seg', 'ul');
    ul.setAttribute('stroke', '#fff');
    ul.setAttribute('stroke-width', Math.max(1, size * 0.1));
    ul.setAttribute('opacity', char === '.' ? .3 : 1);
    ul.setAttribute('d', `M${gap} ${gap} L${gap} ${size-gap*2}`);
    glyph.appendChild(ul);
    
    // Middle horizontal
    const mid = document.createElementNS(ns, 'path');
    mid.setAttribute('data-seg', 'mid');
    mid.setAttribute('stroke', '#fff');
    mid.setAttribute('stroke-width', Math.max(1, size * 0.1));
    mid.setAttribute('opacity', char === '.' ? .3 : 1);
    mid.setAttribute('d', `M${gap} ${size*0.5} L${size-gap} ${size*0.5}`);
    glyph.appendChild(mid);
    
    return glyph;
  }

  function renderToElement(el, text, size) {
    const ns = 'http://www.w3.org/2000/svg';
    el.innerHTML = '';
    const chars = text.split('');
    chars.forEach((ch, i) => {
      const glyph = createGlyph(ch, size);
      glyph.setAttribute('transform', `translate(${i * (size * 1.1)} 0)`);
      el.appendChild(glyph);
    });
  }

  // Exponer API global
  window.renderSeg7 = function(el, text, size) {
    if (typeof el === 'string') el = $(el);
    if (!el) { console.error('Falta elemento en el HTML:', typeof el === 'string' ? el : 'seg7 container'); return; }
    renderToElement(el, text, size);
  };

  // Inicializar helpers $ si no existen
  if (typeof $ === 'undefined') {
    window.$ = (sel, r = document) => { const e = r.querySelector(sel); if (!e) console.error('Falta elemento en el HTML:', sel); return e; };
  }
})();