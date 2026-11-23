# HANDOFF — dj. hammer

Guía de relevo para continuar el desarrollo. La sección 0 describe la versión canónica actual; el resto del documento es el estado histórico tras la etiqueta **`Gold-DjHammer`**.

---

## 0. Versión canónica actual (`v1.1-barca-pcdj-stable` + auditoría)

HEAD es `fded934` (tag `v1.1-barca-pcdj-stable`), posterior a `Gold-DjHammer`. La auditoría de 2026-11 confirmó que **no existen duplicados ni versiones antiguas interfiriendo**: un único `index.html`, un único `styles.css`, una `class Deck` instanciada dos veces (`main.js:322-328`) y los ocho módulos JS de la sección 2.2. `img/pcdj.png`, `window.Fader` y `window.renderSeg7` son utilidades sin cablear (invariante 10). Los tags son los únicos puntos de restauración; no hay carpetas `backup` ni copias `final2/nuevo/definitivo`.

### 0.1 Ruta única de carga (contrato de la cabina)

`Library.loadTo(track, deckId, autoplay)` es el **único núcleo de carga**. Convergen en él los cuatro mecanismos de la UI: botones de fila (`data-quick-deck`), doble clic, menú contextual (una opción por deck) y drag & drop (captura en `document` → `dropTo()` → `loadTo()`). `Deck.load()`/`Deck.play()` son sólo primitivas de audio. Reglas:

- **Disponibilidad**: una pista con `url == null` (restaurada de `localStorage`) nunca se reproduce. `loadTo()`/`dropTo()` avisan en LCD + barra de estado, no abren el selector de archivos y dejan el deck intacto.
- **Re-enlace explícito**: `Library.relink(track, file)` (menú derecho *Enlazar MP3…*, o soltar el MP3 sobre la pista) genera una nueva `URL.createObjectURL` sin tocar la clave `name|size|lastModified`. Sólo revoca la URL anterior si **ningún** deck la tiene en `audio.src`. Nunca se persiste `blob:`.
- **Drop**: el manejador de captura de `library.js` resuelve la fila, marca `__hammerDropHandled` para evitar un segundo `play()`, y llama a `markDrop(deckId)`. El listener de LCD del deck llama a `Library.shouldIgnoreLcdClick(id)`, que consume esa supresión **sólo en el deck que recibió el drop**: el otro deck sigue pudiendo abrir su selector. Los archivos externos se añaden a la biblioteca (`addFiles`) y se cargan por la misma ruta; un formato no compatible avisa con `⚠ Formato no compatible…`.
- **AUTO**: `nextUnplayed()` excluye pistas sin archivo, para que la cola no precargue metadatos restaurados.
- **Reintento de `play()`**: `_retryPlayAfterAbort()` congela `_loadToken` y `src`. Si llega otra carga o un `eject()` mientras espera `canplay`, cancela el reintento: nunca suena una pista que el usuario no pidió.

### 0.2 Pruebas automatizadas

`tests/logic.test.cjs` contiene 18 contratos ejecutables con `node --test tests/logic.test.cjs`. Usa `node:test` y un DOM simulado en `vm`: **sin dependencias nuevas, sin jsdom y sin navegador**. Cubre curva cos/sen, `user:true` → AUTO cancelado, STANDBY sin persistir, store sin `blob:`, `_restore` sin archivo, enrutado A/B, pista sin archivo sin selector, formato no compatible, `relink`, cola AUTO, supresión por deck, `select(track,false)`, reintento con token, simetría de IDs y convergencia de mecanismos.

---

## 1. Estado actual

| Concepto | Valor |
|---|---|
| Rama | `main` |
| Commit HEAD (hito) | `5233f677e7a2dd1ab4cbf4fdc52d01f6794cc9c4` (`feat(dj-hammer): skins, mouse jog dials and Web MIDI template`) |
| Etiqueta actual | `Gold-DjHammer` (etiqueta anotada `90968f610acff48ef34d97174f297e8ac163df1c`, apunta a `5233f67`) |
| Remote | `origin` → <https://github.com/martillohamer/hamer-sound.git> |
| Documentación | `README.md` y `HANDOFF.md` se actualizan en un commit de documentación posterior al hito |
| Dependencias | Ninguna: HTML + CSS + JS vanilla, sin build |

### Hitos

| Etiqueta | Objeto tag | Commit | Fecha (creación tag) | Qué se estrenó |
|---|---|---|---|---|
| `mixer-finish` | `c817666` | `384ea32` | 2026-11-22 19:05:52 +0100 | Controles de deck, carga de audio e interacción con ratón |
| `Dj-Opa` | `3faa344` | `6205201` | 2026-11-22 20:32:36 +0100 | Botones hover `Play A/B` y menú contextual de pistas |
| `Silver-DjHammer` | `8bcbfd1` | `39ac181` | 2026-11-22 21:27:34 +0100 | Recordcases, reloj/contador de sesión, ficha de pista y rack FX |
| *(sin tag)* | — | `1ac0e9b` | 2026-11-22 | TRIM por deck, EQ de 3 bandas y limpieza de títulos |
| `Gold-DjHammer` | `90968f6` | `5233f67` | 2026-11-22 22:21:10 +0100 | Skins (incl. Barça), jog circular con ratón, diales y plantilla Web MIDI NV II |

Historial anterior: `3e9ea1f` (primer commit) → `5151964` (`chore: eliminar app.js y files.zip`) → los tres primeros hitos → `a83f7bc` (documentación Silver) → `1ac0e9b` → `5233f67`.

### Esquema de copias de seguridad

- Los **tags anotados son los puntos de restauración**; no hay carpetas `backup/` ni scripts de copia en el repo.
- `origin/main` actúa como espejo remoto. Para inspeccionar un hito sin mover la rama: `git show <tag>` o `git worktree add /tmp/opencode/hammer-<tag> <tag>`.
- Si se necesita una copia física local, usar una ruta temporal aprobada, p. ej. `/tmp/opencode/hamer-sound-<tag>`.
- Los archivos eliminados en `5151964` (`app.js`, `files.zip`) solo se recuperan desde ese commit; no forman parte del estado actual.
- Regla práctica: **un hito = un commit + un tag anotado + `git push origin main --tags`**. La documentación se commitea aparte, justo después.

---

## 2. Arquitectura técnica

### 2.1 Composición

`index.html` reparte la UI en zonas (comentarios `ZONA A`…`ZONA E`): cabecera con reloj/sesión, selector `SKIN` y estado MIDI; players A/B (con jog, TRIM y EQ); banco `.fx-rack` (con diales de corte); mezclador; biblioteca y barra de estado. Además contiene tres diálogos (`#dlg-cfg`, `#dlg-info`, `#dlg-recordcase`) y el menú `#track-ctx-menu`. El diálogo `cfg` incluye `<details>` con la tabla `#midi-map-rows`.

`styles.css` define el tema metálico (variables `--chassis`, `--plata`, `--aluminio`, `--lcd`, LEDs), cinco bloques `[data-skin="…"]` y dos media queries (`820px` y `520px`).

### 2.2 Módulos JS

Los scripts se cargan con `defer` en este orden: `seg7.js → controls.js → audio.js → deck.js → library.js → skins.js → midi.js → main.js`.

| Archivo | Responsabilidad | API expuesta |
|---|---|---|
| `js/seg7.js` | Render SVG de dígitos 7 segmentos | `window.renderSeg7` — **no invocado** por la UI actual |
| `js/controls.js` | Fader dibujado sobre `<input type="range">` y **dial circular** | `window.Fader` (sin instancias), `window.Dial` (2 instancias: corte de filtro A/B) |
| `js/audio.js` | `AudioContext`, master, crossfader cos/sen, ganancia para VU | `window.ctx`, `window.masterGain`, `window.xfade`, `window.setXf`, `window.getXfGain`, `window.setMaster`, `window.getMaster` |
| `js/deck.js` | `class Deck`: estados, grafo de audio, EQ de 3 bandas, FX, CUE, pitch, **jog**, VU, LEDs | `window.Deck`, `EQ_PRESETS` (constante de módulo) |
| `js/library.js` | `window.Library`: archivos, recordcases, filtro, marcas, DnD, menú contextual, cola de AUTO | `window.Library` |
| `js/skins.js` | Pieles de la controladora, persistentes en `hammer:skin` | `window.Skins` (`init/get/set/list/key`) |
| `js/midi.js` | Web MIDI tolerante, estados y tabla de mapeo NV II | `window.Midi` (`init/mapping/normalize/onControl`) |
| `js/main.js` | Arranque, mixer, `wireFxRack`, `wireMidi`, AUTO, sesión, VU máster, botones superiores, fin de pista | `window.AutoMode`, `window.StateMachine`, `window.Session`, `window.decks`, `window.setStatus` |

`main.js` monta decks y biblioteca en `DOMContentLoaded` dentro de `safe(label, fn)`: un fallo aislado no deja la consola muerta. `skins.js` y `midi.js` se auto-inician en `DOMContentLoaded` y además se llaman desde `safe()` en `main.js`; ambos son idempotentes (`_inited`). `audio.js` ya llamó a `initAudio()` al cargarse; el arranque lo vuelve a llamar (idempotente).

### 2.3 Grafo de audio (por deck)

```text
<audio> → MediaElementSource → inputGain (TRIM dB) → trimGain (lineal, #vol-b2)
  → eqLow (lowshelf 200 Hz) → eqMid (peaking 1000 Hz, Q=1) → eqHigh (highshelf 3200 Hz)
  → fxFilter (allpass | lowpass | highpass) → fxDry ──────────────→ chGain
                                            └→ fxDelay(0.28 s) ⇄ fxFeedback(≤0.45)
                                                               → fxWet ──────→ chGain
chGain → analyser → xfade[A|B].gain → master(0.8) → destination
```

`fxFilter` en `OFF` es `allpass` (transparente). `EQ_PRESETS` = `FLAT`, `BASS` (+6/−2/−2), `TREBLE` (−2/0/+6), `VOCAL` (−3/+3/+3) sobre los tres filtros. TRIM profesional: ±12 dB guardados por pista en `track.trimDb` (sólo metadatos).

### 2.4 Claves de `localStorage`

| Clave | Formato exacto | Lectura / escritura |
|---|---|---|
| `hammer:master` | Número `0-1` como texto | `audio.js`: `getMaster()` / `setMaster(v, store = true)`. STANDBY llama `setMaster(0, false)` para no persistir el silencio |
| `hammer:played:v1` | `{ "<name>\|<size>\|<lastModified>": boolean }` | `library.js`: `_readMap()` / `_writeMap()` |
| `hammer:library:v1` | `{ folders: [{id,name}], activeFolder, tracks: [{id,key,name,title,artist,size,lastModified,version,comment,bpm,folder,played,trimDb}] }` | `library.js`: `_restore()` / `_writeStore()`; `_writeMap()` también la escribe |
| `hammer:skin` | Uno de `silver\|blue\|red\|dark\|barca` | `skins.js`: `_read()` / `set(id, persist)`. Lista blanca: un valor desconocido cae a `silver` |

`track.url` y `track.missing` **jamás** se guardan. `add()` genera `URL.createObjectURL(f)`; `_restore()` devuelve `url: null, missing: true` y `render()` marca la fila con `⚠` en cursiva. `loadTo()` rechaza pistas sin `url` con el mensaje «vuelve a añadir el archivo para enlazarlo». **Ningún módulo escribe cadenas `blob:` en `localStorage`.**

---

## 3. Invariantes críticos (no romper)

1. **Vúmetros**: el `analyser` de cada deck está después de `chGain` pero **antes** de `xfade[A|B].gain`. `Deck._updateVu()` multiplica el nivel por `getXfGain(this.id)`, y `drawMasterVU()` suma `A.lv + B.lv` (no `max`) y aplica `masterGain.gain.value`. Mover el analizador tras el crossfader dobla la atenuación.
2. **Crossfader de potencia constante**: `setXf(v)` usa `cos/sin` con `-1 = A`, `0 = centro`, `+1 = B`; `#cf-value` muestra `round(((v+1)/2)*100)%`. `getXfGain()` reproduce la misma curva derivando de `#crossfader` cuando no hay `AudioContext`.
3. **Cancelación de AUTO por el usuario**: el `input` de `#crossfader` llama a `setXf(cf.value, { fromSlider: true, user: true })`. `setXf()` dispara `AutoMode.cancelByUser()` → `cancelTransition()`, fija `suppressedFor` y avisa «Crossfade cancelado». No eliminar el flag `user: true`. El mapeo MIDI del crossfader usa el mismo flag.
4. **Nunca persistir `blob:`**: `_writeStore()` solo serializa metadatos. Al re-añadir un archivo, `add()` busca por clave `name|size|lastModified`, revoca la URL anterior solo si ningún deck (`window.decks.A/B.audio.src`) la está usando, crea una nueva y pone `missing = false`. `skins.js` sólo guarda un id de su lista blanca; `midi.js` no escribe nada.
5. **FX de plato bloqueados con AUTO**: `Session._syncFxAvailability()` deshabilita `.fx-motion button` cada 250 ms y `wireFxRack()` vuelve a comprobar `AutoMode.active` en cada clic (`guarded()`). `applyPitch()` no escribe `playbackRate` mientras `_brakeRaf` o `_startRaf` estén activos; la rampa usa `requestAnimationFrame` con mínimo `0.1`. Lo mismo vale para BRAKE/START recibidos por MIDI (`entry.noAuto` en `wireMidi()`).
6. **`Reiniciar ✓` ≠ `↺ sesión`**: `Library.clearMarks()` borra `hammer:played:v1` y reescribe el store (no toca `Session`); `Session.reset()` pone `start = Date.now()` y `count = 0`, limpia `#mini-viewer` y los estilos en línea de parpadeo, sin tocar marcas ni audio.
7. **AUTO respeta la recordcase**: `_check()` y `_finishTransition()` cuentan pendientes con `library._pool()`, y `nextUnplayed()` elige dentro de ese pool. Cambiar de carpeta cambia la cola; `SHFL` elige al azar. El fin de lista llama a `_announceEnd()`, apaga AUTO y escribe `FIN DE LISTA`.
8. **Orden de arranque**: `audio.js` llama a `initAudio()` al cargarse; `deck.js` y `library.js` dependen de esos globals; `main.js` crea `decks` y llama `library.init()`. Los módulos nuevos (`skins.js`, `midi.js`) van después de `audio.js` y antes de `main.js`, y se integran desde `DOMContentLoaded` dentro de `safe()`.
9. **STANDBY / EXIT**: `stby` silencia con `setMaster(0, false)`; `exit` sigue el orden AUTO.stop → `library.setAuto(false)` → `d.eject()` en A/B → restaurar master si había STANDBY → `setXf(0)` → limpiar `#mini-viewer`.
10. **Utilidades presentes pero sin cablear**: `img/pcdj.png`, `window.Fader` y `window.renderSeg7` existen como referencia/utilidad; no asumir que están activos en la UI. `window.Dial`, en cambio, **sí** está cableado a los dos mandos de corte.
11. **Skins = sólo CSS**: las skins redefinen custom properties de superficie/texto (`--glow`, `--surface-*`, `--panel*`, `--plata`, `--lcd`, `--fader-knob`, `--accent*`). **No se redefinen `--led-verde`, `--led-rojo`, `--led-off` ni `--vu-off`**: el significado de LEDs y vúmetros es constante. Ningún módulo de audio lee `data-skin`. La skin por defecto (`silver`) replica la paleta original.
12. **Jog = sólo seek**: `Deck._bindJog()` acumula segundos y llama a `_seekTo(startT + acc)`. No escribe `playbackRate`, ganancias ni crossfader; por eso no puede sortear el bloqueo de BRAKE/START con AUTO ni alterar los vúmetros. El anillo usa `--jog-pos` y la aguja `--jog-angle` (CSS), calculados desde `currentTime` en `_drawJog()`.
13. **MIDI sin efectos colaterales**: `midi.js` pide `requestMIDIAccess({ sysex: false })` y atrapa ausencia/denegación/errores; estados `off | ready | connected` con textos `MIDI: desconectado | listo | conectado`. No toca `localStorage`. La tabla `window.Midi.mapping.controls` es plantilla con números **provisionales**; `wireMidi()` es el único traductor a acciones reales y respeta las guardias de AUTO y de filtro ya descritas.

---

## 4. Metodología de trabajo y verificación obligatoria

Antes de dar por bueno cualquier cambio:

```bash
cd /mnt/c/Users/astur/Desktop/hamer-sound
for f in js/*.js; do node --check "$f" || exit 1; done
git diff --check
git status --short
```

Comprobación estática de IDs y persistencia (útil tras añadir controles):

```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");
const ids=new Set([...h.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const refs=new Set();for(const f of fs.readdirSync("js").filter(x=>x.endsWith(".js"))){
const s=fs.readFileSync("js/"+f,"utf8");
for(const m of s.matchAll(/(?:\$|querySelector(?:All)?)\(\s*[\x27"]#([\w-]+)[\x27"]/g))refs.add(m[1]);
for(const m of s.matchAll(/getElementById\(\s*[\x27"]([\w-]+)[\x27"]/g))refs.add(m[1]);}
const miss=[...refs].filter(x=>!ids.has(x));console.log(miss.length?"FALTAN: "+miss:"OK: IDs");'
grep -R "localStorage.setItem" js/   # ninguna llamada debe guardar .url / createObjectURL / blob:
```

En el navegador, con <http://localhost:8080> abierto:

1. Recargar con **`Ctrl + Shift + R`** y mantener **`F12`** abierto. Consola sin errores; `Local Storage`: `hammer:*` sin cadenas `blob:`.
2. Comprobar hora, `SESIÓN`, `PINCHADOS` y `↺ sesión`; `Reiniciar ✓` no reinicia el reloj.
3. Crear carpeta, mover una pista arrastrándola al chip, recargar y volver a añadir el MP3 para confirmar el re-enlace (desaparece `⚠`).
4. Filtro LP/HP y eco: el sonido y ambos vúmetros cambian; `BRAKE`/`START` funcionan fuera de AUTO.
5. Activar `AUTO`: `BRAKE`/`START` quedan deshabilitados; mover el crossfader cancela la transición; el contador sigue subiendo.
6. **Skins**: cambiar `SKIN` por las cinco opciones (verificar Barça), recargar y comprobar que se conserva en `hammer:skin` y que audio/vúmetros no cambian.
7. **Jog**: cargar pista; arrastrar el borde del círculo (giro), el centro (seek horizontal), la rueda y el doble clic; el anillo y la aguja deben seguir la posición sin alterar pitch ni crossfader.
8. **Diales**: mover el mando junto a `CUT`, comprobar que el output y el sonido cambian; doble clic lo abre a `12.0k`.
9. **MIDI**: sin hardware, estado `MIDI: desconectado`/`listo` y sin errores en consola; en `cfg → Mapeo Numark NV II` se ve la tabla y el aviso de números provisionales.

Cada hito se cierra con commit + tag anotado (y documentación aparte). Para este cambio:

```bash
git add HANDOFF.md README.md
git commit -m "docs: HANDOFF y README para Gold-DjHammer"
git push origin main --tags
```

---

## 5. Roadmap / siguientes fases

| Prioridad | Trabajo | Situación actual | Punto de partida |
|---|---|---|---|
| Alta | **Confirmar el mapeo NV II con hardware** | Tabla lista pero con números provisionales; sin dispositivo conectado | `js/midi.js → NV2_MAPPING.controls` y `main.js → wireMidi()` |
| Alta | **Hot cues y loops** | Un único `cuePoint` por carga; sin loop | `Deck.cue()`, `_seekTo()` y `audio.loop`; plantear `loopStart`/`loopEnd` y cues por pista |
| Media | **Cálculo y match de BPM** | `bpm` es siempre `'---'`; la columna es decorativa | `Library.add()`/`_writeStore()` y `#detail-*-bpm`; analizar con `OfflineAudioContext` o metadatos y usar `pitch` para match |
| Media | **Waitlist** | No existe; `nextUnplayed()` decide directamente el siguiente tema | `Library.nextUnplayed()` y `AutoMode._check()`; añadir cola de peticiones con prioridad |
| Baja | **Más pieles y preferencias de usuario** | Cinco skins fijas; se podrían añadir temas de temporada o un editor | `js/skins.js → SKINS` y bloques `[data-skin]` en `styles.css` |

Ya entregado en este hito/camino: **EQ de 3 bandas + TRIM por pista** y **limpieza de títulos** (`1ac0e9b`), **skins + jog + diales + plantilla MIDI** (`5233f67`).

---

## 6. Enlaces

- [Repositorio remoto](https://github.com/martillohamer/hamer-sound.git)
- [README.md — presentación y uso](README.md)
- [index.html](index.html) · [styles.css](styles.css)
- [js/audio.js](js/audio.js) · [js/controls.js](js/controls.js) · [js/deck.js](js/deck.js) · [js/library.js](js/library.js)
- [js/skins.js](js/skins.js) · [js/midi.js](js/midi.js) · [js/main.js](js/main.js)
