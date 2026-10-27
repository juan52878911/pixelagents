# El mundo: rejilla, crecimiento incremental y armonía

Cómo se genera y se pinta el pueblo de oficinas (`packages/web/src/world/*`, `packages/web/src/scene/worldpaint.ts`).
La referencia visual es `design/prototype/` (todo ordenado, pixel-perfect); este documento recoge las reglas
que lo garantizan y las fuentes en que se apoyan.

## Píxel perfecto

- Toda la escena se dibuja en una `RenderTexture` de resolución lógica (480×328) con `scaleMode: 'nearest'`,
  y esa textura se muestra a un factor **entero** de píxeles de dispositivo (`Engine.layout`).
- La cámara hace zoom en pasos enteros (1..4) y se posiciona en píxeles enteros (`setCamera` redondea).
- Las capas estáticas se hornean con `cacheAsTexture`. **Pixi v8 crea esa textura con `scaleMode: 'linear'`
  por defecto** (`RenderGroupSystem`: `textureOptions.scaleMode ?? "linear"`), y eso era la causa del
  desenfoque del terreno al hacer zoom: la capa `world` cacheada se muestreaba bilineal mientras los actores
  (textura propia `nearest`) seguían nítidos. `Engine.cacheLayer` pasa ahora `CACHE_OPTS = { resolution: 1,
  antialias: false, scaleMode: 'nearest' }` (test `pixel-perfect.test.ts`; `scene-check.mjs` comprueba que
  cada bloque de píxel es de un solo color a escala 3 y con zoom de cámara 3).

## Rejilla

- Tile de 8 px (`TS`), `GY = 24` px de margen superior. El mapa tiene `cols` fijas (60 por defecto) y las
  filas crecen con el contenido (mínimo 38).
- `own[r][c]` = índice de la oficina dueña del tile o −1 (hierba). Una oficina = **sala** rectangular
  (`tx, ty, tw, th`) + **alas** (tiles fuera del rectángulo).
- Bandas de la sala (filas relativas): 0‑1 fachada (cartel, puerta, ventanas); 2‑3 pasillo de entrada;
  4‑9 (+5 por fila extra de mesas) alfombras y mesas; 3 últimas filas banda de muebles. La columna
  derecha (3 tiles) es del termómetro y la hucha.
- **Autotiling por máscara de 4 vecinos** (`grid.ts: edgeMask`, bits N/E/S/W = «ese vecino no es mi
  oficina»): contorno de 1 px en los bordes exteriores, sombra al sur y al este, muro bajo (7 px) en los
  tiles de ala con el norte abierto, franja amarilla de laboratorio en los bordes sur. No hace falta el
  blob de 47 tiles: las esquinas se resuelven por composición de bordes porque el contorno es de 1 px.

## Formas válidas (estrategias sobre la rejilla)

Las estrategias (`strategies.ts`: `alas`, `escalera`, `mancha`, `mordida`, `cueva`, más las de plugins)
hacen brotar tiles alrededor de la sala con `free(c, r)` (hierba, no reservado, a un tile de otras
oficinas). Después, `grid.ts: shapeUp` impone las reglas que hacen la forma válida:

1. **Bloques 2×2**: todo tile fuera de la sala pertenece a al menos un bloque 2×2 de la oficina (sin picos
   ni pasillos de 1 tile, que dejaban muros sueltos).
2. **Conexión**: todo tile está 4‑conectado con la sala.
3. **Alcanzable**: todo tile transitable se alcanza desde la entrada (tile bajo la puerta) sin cruzar
   muros, mesas ni racks; lo que no se alcanza se recorta.

Se itera hasta que nada cambia; la sala nunca se recorta (`mordida` solo muerde la última fila).

## Crecimiento y demolición incrementales

`generateWorld(input, prev?)` recibe el layout anterior y procede en orden:

1. **Mantener**: una oficina cuyo contenido cabe en su sala anterior conserva tiles, muebles, puerta y
   cartel; sus mesas conservan el patrón (los que se van dejan hueco, los nuevos ocupan el primer hueco,
   siempre queda uno libre al final; con más de `MAX_SPARE` libres se compacta).
2. **Renovar in situ**: si necesita más (o sobra ≥ 8 tiles de ancho, o una fila de mesas) y el sitio
   sigue libre, se reconstruye en la misma esquina: se demuelen sus tiles viejos y se levanta la nueva sala
   con alas nuevas.
3. **Nueva / reubicar**: si no cabe donde estaba, o es nueva, toma el primer hueco libre barriendo desde
   arriba (dirección izquierda/derecha y fila de arranque por hash de la oficina) exigiendo un margen de
   crecimiento (`GROW_W/H`) para que pueda crecer en su sitio más adelante. Las filas del mapa crecen si
   hace falta y se recortan al sobrar (mínimo 38).

Cada oficina tiene su propio rng (`hash(semilla | id)`): suelo, puerta, estrategia y muebles no dependen
de cuántas oficinas haya ni de su orden. Árboles, arbustos, ruido de caminos y decoración exterior se
deciden **por tile** con `hash(semilla, tile)`: quitar una oficina hace que vuelva la hierba y los
árboles que tocan, sin mover los demás.

La línea de tiempo del layout (`build`) lleva: `demolish` (tiles del layout anterior que caen, rápido,
con cuadrilla de derribo), `reveal` (tiles que se levantan, con cuadrilla de obra), caminos nuevos y
naturaleza nueva. `epoch` sube cuando cambia la geometría; si no, la línea de tiempo anterior sigue
(`relayout` solo reasigna mesas). La escena pinta terreno donde aún no hay obra y el arte anterior donde
aún no se ha derribado (`paintConstruction(nuevo, anterior, …)`).

Determinismo: con la misma semilla y el mismo conjunto de grupos la generación desde cero es idéntica bit
a bit; la secuencia incremental es determinista dada la historia. La carga de la página recalcula desde
cero (sin historia), así que dos clientes con la misma semilla y el mismo estado ven el mismo pueblo.

## Caminos

Plaza: cuadrado 3×3 de hierba con un tile de margen, en la componente de hierba con más puertas, el más
céntrico respecto a las puertas (suma de distancias Manhattan); se conserva mientras siga siendo válido.
Red de caminos como **MST tipo Prim**: la plaza siembra la red y cada puerta, por orden de antigüedad, se
une por la ruta más barata (**Dijkstra multiobjetivo**: para en el primer tile de la red; A* no aporta con
varios destinos). Coste = 1 + ruido por tile (serpentean), 0,25 en tiles que ya eran camino, así una
oficina nueva añade un ramal en vez de redibujar la red; los ramales que ya no llevan a nadie desaparecen.

## Muebles (`furniture.ts`)

Un mueble es un rectángulo de sprite con **huella** = su fila de tiles inferior. Es válido si:

- todo el sprite está sobre tiles de su oficina, y la huella no pisa fachada, pasillo, mesas, termómetro,
  racks ni muros (tiles de ala con el norte abierto);
- en la sala, la huella está en la banda de muebles (3 últimas filas);
- guarda 2 px con los demás muebles;
- **toca una pared**: borde sur abierto, borde lateral abierto, o el tile de arriba es muro/fachada/mesas;
- deja **todos los tiles transitables alcanzables desde la entrada** (sin bloquear pasillos ni alas).

`placementProblem` devuelve el motivo del rechazo; los tests lo usan como invariante sobre cada mueble.
La sala recibe 2‑4 muebles y cada ala 1 por cada ~9 tiles (máx. 5). Las oficinas mantenidas conservan sus
muebles.

## Tipografía (`engine/fonts.ts`)

Jerarquía: **cartel de oficina** en 5×7 (etiqueta) + 4×6 (tipo), **zona** (alfombra) en 4×6, **NPC**
(cápsulas), termómetro y burbujas en 3×5 (la del prototipo). Glifos de ancho variable con una columna de
separación, mayúsculas sin diacríticos. `measure` mide, `fit` trunca con «…» para que **ninguna etiqueta
desborde**: el cartel limita la etiqueta a 108 px y la puerta se coloca después; la alfombra se ensancha
hasta el hueco libre antes de la siguiente y, si no basta, trunca; los nombres de cápsula caben en 22 px.

## Paleta y sombras

Constantes comunes en `worldpaint.ts: PAL` (contorno `#05030a`, sombra `rgba(0,0,0,.28)`, pie de muro
`rgba(0,0,0,.35)`, caja del cartel `#1a1423/#2a2236`, etiqueta `#ffe9a8`, tipo `#8be9fd`), suelos y muros
por tipo (`WALLS`, `floorPattern`) y estaciones (`seasons.ts`). Los sprites usan el contorno `OL`.

## Invariantes (tests)

`packages/web/test/world.test.ts` comprueba en 60 días × 5 conjuntos, casos límite y 60 secuencias de
6 pasos (agente nuevo, zona nueva, baja, oficina nueva, demolición): sala íntegra, puerta con camino y
despejada, cartel antes de la puerta, tiles = orden de obra, bloques 2×2, conexión, un tile de hierba
entre oficinas, cada mueble válido según las reglas, decoración de pared en la fachada, mesas dentro de la
sala, 1..3 mesas libres por zona, red de caminos conexa, árboles y arbustos en hierba, obra solo en lo que
cambió, **estabilidad** (lo no cambiado no se mueve, no cambia de forma ni de muebles, nadie cambia de
mesa), demolición de todo tile que deja de pertenecer a su oficina, e idempotencia de `relayout`.

## Fuentes consultadas

- Pixi v8, `RenderGroupSystem`/`TexturePool`: `cacheAsTexture` toma `scaleMode` de sus opciones y
  usa `"linear"` si no se indica (código de `node_modules/pixi.js/lib/scene/container/RenderGroupSystem.mjs`).
- Autotiling por bitmask de 4/8 vecinos y blob de 47: Boris the Brave, *Tileset roundup* /
  *Marching squares & autotiling*; Sean Barrett, *Herringbone Wang tiles* (por qué bastan bordes cuando el
  contorno es de 1 px).
- Crecimiento de habitaciones: *Procedural room growing* (Rogue Basin: «Grid-based dungeon generation»,
  BSP de *Roguelike dungeon generation*), agregación de rectángulos (TinyKeep / Phi Dinh) y autómatas
  celulares para cuevas (Rogue Basin, *Cellular Automata Method for Generating Random Cave-Like Levels*),
  que inspiran `alas`/`escalera`/`mancha`/`cueva`.
- Conexión de salas con MST + ruta mínima: TinyKeep (Delaunay + MST + A*), Rogue Basin *Dungeon
  builder*; Amit Patel (Red Blob Games), *Introduction to A\**: con varios objetivos, Dijkstra
  multiobjetivo es la elección correcta.
- WFC: Maxim Gumin, *WaveFunctionCollapse*: descartado para el pueblo porque no es incremental ni
  determinista por tile frente a cambios locales; la restricción de forma se resuelve con reglas
  explícitas (2×2 + conectividad).
- Determinismo por hash en vez de rng secuencial: *Hash-based procedural generation* (Squirrel Eiserloh,
  GDC 2017, «Math for Game Programmers: Noise-Based RNG»).
- Fuentes bitmap: proporciones de «Tom Thumb» (3×5) y de las fuentes de consola 4×6 / 5×7 (Linux
  `font_mini_4x6`, Adafruit GFX 5×7) como referencia de legibilidad; los glifos son propios.
