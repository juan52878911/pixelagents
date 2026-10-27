# El mundo: una planta compartida que crece como un organismo

Cómo se genera y se pinta la planta de oficinas (`packages/web/src/world/*`,
`packages/web/src/scene/worldpaint.ts`). La referencia visual es `design/prototype/` (todo ordenado,
pixel-perfect); este documento recoge las reglas que lo garantizan, los sistemas naturales en que se
apoyan y las fuentes.

## Píxel perfecto

- Toda la escena se dibuja en una `RenderTexture` de resolución lógica (480×328) con `scaleMode: 'nearest'`,
  y esa textura se muestra a un factor **entero** de píxeles de dispositivo (`Engine.layout`).
- La cámara hace zoom en pasos enteros (1..4) y se posiciona en píxeles enteros (`setCamera` redondea).
- Las capas estáticas se hornean con `cacheAsTexture`. **Pixi v8 crea esa textura con `scaleMode: 'linear'`
  por defecto** (`RenderGroupSystem`: `textureOptions.scaleMode ?? "linear"`): `Engine.cacheLayer` pasa
  `CACHE_OPTS = { resolution: 1, antialias: false, scaleMode: 'nearest' }` (test `pixel-perfect.test.ts`;
  `scene-check.mjs` comprueba que cada bloque de píxel es de un solo color a escala 3 y con zoom 3).

## Rejilla

- Tile de 8 px (`TS`), `GY = 24` px de margen superior. El mapa tiene `cols` fijas (60 por defecto) y las
  filas crecen con el contenido (mínimo 38).
- `own[r][c]` = índice de la oficina dueña del tile, `COMMON` (−2) para el suelo compartido o −1 (hierba).
- Una oficina = **sala** rectangular (`tx, ty, tw, th`) + **alas** (tiles de su territorio fuera del
  rectángulo). Bandas de la sala (filas relativas): 0‑1 fachada (cartel, puerta, ventanas); 2‑3 pasillo
  de entrada; 4‑9 (+5 por fila extra de mesas) alfombras y mesas; 3 últimas filas banda de muebles. La
  columna derecha (3 tiles) es del termómetro y la hucha.
- **Autotiling por máscara de 4 vecinos** (`grid.ts: edgeMask`): contorno de 1 px en los bordes hacia el
  suelo común o la hierba; entre dos oficinas vecinas el muro compartido es **una sola línea** (la pinta
  la de menor índice); sombra al sur y al este solo sobre suelo común o hierba; muro bajo (7 px) en los
  tiles de ala con el norte abierto y en el suelo común cuyo norte es hierba (muro exterior).

## Una sola planta

```
  exterior: hierba, árboles en bosquetes, explanada y sendero hasta la entrada
  ┌──────────────────── RECEPCION ───┐          fila 6-7: fachada de la recepción (cartel + puerta)
  │ suelo de la recepción            │          fila 8-9: suelo de la recepción = semilla de los pasillos
  ├═══ pasillo (2 filas) ═══╤════════┤          cada sala lleva encima 2 filas de pasillo ("strip")
  │ fachada A  puerta │ fachada B    │          la puerta abre al pasillo; las paredes se comparten
  │ sala A            │ sala B       │
  │ alas de A ─┐      │   alas de B  │          territorios orgánicos; los huecos cerrados son
  │            └─ bolsa común ───────┤          "bolsas": salas de descanso con plantas y sofás
  └───────────────────────────────────┘
```

La planta nace del **núcleo**: la recepción (`makeLobby`, 10×4 tiles, centrada, filas 6‑9) con la
entrada en su fachada y la explanada 3×3 delante. Su suelo siembra la red de pasillos. Toda oficina tiene
su puerta en la fachada norte y delante de ella dos filas de pasillo (`STRIP`), de modo que las salas de
una misma fila comparten pasillo y las de filas distintas quedan separadas por él. Por los lados del mapa
quedan siempre dos columnas libres (`MARGIN`) por donde pueden correr pasillos: la red nunca se queda
sin camino.

`generateWorld(input, prev?)` procede en este orden:

1. **Salas** (`makeDraft`): el contenido (zonas, agentes, cápsulas) fija el ancho y el alto de la sala.
2. **Mantener / reclamar / colocar** (ver más abajo).
3. **Pasillos** (`routeDoor`): cada puerta, por orden de antigüedad, se une a la red por la ruta más
   barata (Dijkstra multiobjetivo sobre tiles compartidos o libres): 0,25 en pasillo previo, 0,5 en suelo
   común, 1 + ruido en hierba, 4 a través del ala de otra oficina (expropiación: la vecina cede el tile).
   Las rutas se ensanchan a dos tiles (hacia arriba en tramos horizontales, hacia el este en verticales).
   Las oficinas nuevas se colocan y enrutan una a una; un sitio cuyo pasillo no llega a la recepción se
   descarta y el barrido sigue. Lo que fue pasillo y ya no lleva a nadie vuelve a ser suelo libre.
4. **Territorios** (`territory.ts`): primero brota la estrategia de alas de la oficina (`alas`, `escalera`,
   `mancha`, `mordida`, `cueva` o las de plugins), después **acreción competitiva por frentes**: en
   rondas, cada oficina a la que le falta área reclama el mejor tile de su frontera (más cercano a la
   sala, mejor rodeado por ella y favorecido por un ruido por tile), las más hambrientas primero. El
   área objetivo = sala × (1,25..1,6), tope 40 tiles de ala, alcance 4 tiles de la sala. Una pasada
   **celular** rellena entrantes (un tile libre con ≥ 3 vecinos de la oficina se une). Luego `shapeUp`
   (bloques 2×2, conexión con la sala) y recorte de lo que no se alcanza desde la entrada.
5. **Bolsas** (`settlePockets`): todo tile libre encerrado (sin salida a la hierba exterior) pasa a suelo
   común; si solo lo rodea una oficina y ningún pasillo, se lo queda esa oficina (sin huecos inútiles).
6. **Muebles**: los de oficina siguen `furniture.ts`; las bolsas reciben plantas en las esquinas (tiles
   con dos lados de pared) y sofás, mesas o neveras contra una pared (`commonProblem`).
7. **Exterior**: explanada y camino hasta el borde del mapa; árboles por hash de tile con distancia mínima
   3 (muestreo tipo Poisson-disc por "dart throwing" determinista) y densidad modulada por un ruido de
   baja frecuencia (bosquetes); cada sprite comprueba que todos los tiles bajo él son hierba sin camino
   (nada cruza un muro); arbustos y decoración exterior igual.

## Reclamar y liberar espacio en vivo

Dado el layout anterior:

- **Mantener**: una oficina cuyo contenido cabe en su sala conserva tiles, muebles, puerta y cartel; las
  mesas conservan el patrón (los que se van dejan hueco, los nuevos ocupan el primer hueco, siempre queda
  uno libre; con más de `MAX_SPARE` libres se compacta). Subir y bajar un agente no reordena nada
  (test de histéresis).
- **Reclamar** (`mode: 'renovate'`, `grow`): si necesita más, intenta la sala nueva anclada en su esquina
  (y si no, pegada a su borde derecho) tomando, por este orden, sus propias alas, suelo libre, bolsas
  comunes, **alas de vecinas** (las vecinas se validan de nuevo y pierden solo esas alas: `pushed`) y,
  hacia fuera, hierba (el edificio crece por el borde). Nunca una sala ajena ni un pasillo. Si no cabe,
  se reubica en el primer hueco libre y sus tiles viejos se derriban.
- **Liberar**: con ≥ 8 tiles de ancho sobrantes o una fila de mesas menos, la sala se reconstruye más
  pequeña en el mismo sitio; lo que suelta sigue la regla de las bolsas: encerrado → sala de descanso,
  en el borde exterior → hierba (sucesión: vuelven los árboles por hash de tile).
- **Local**: lo no afectado no se mueve; muebles y mesas de oficinas no afectadas quedan quietos; los
  muebles de una oficina empujada se conservan si siguen siendo válidos.

La línea de tiempo (`build`) sale de comparar tile a tile el contenido anterior y el nuevo: todo tile que
cambia de dueño se **derriba** por la cuadrilla de su dueño anterior (`@common` para el suelo compartido)
y se **levanta** por la de su dueño nuevo; los pasillos primero. `changed` = ganó o perdió tiles;
`doneAt ≥ 0` solo si ganó. `epoch` sube cuando cambia la geometría.

Determinismo: misma semilla y mismos grupos ⇒ generación desde cero idéntica bit a bit; la secuencia
incremental es determinista dada la historia. Cada oficina tiene su rng (`hash(semilla | id)`); árboles,
arbustos, bolsas y rutas se deciden por hash de tile.

## Tipografía, paleta y sombras

Jerarquía: cartel de oficina en 5×7 + 4×6, zona (alfombra) en 4×6, NPC/termómetro/burbujas en 3×5. El
coste de la hucha va en 4×6 con un `$` de 5 columnas (el de 3 columnas no se leía). `fit` trunca con «…».
Columna de medidores (24 px): CARGA 19‑24, termómetro 27‑57, nivel 61‑65, moneda 70‑79, hucha 80‑88,
coste 91‑96; nada se monta. Paleta común en `worldpaint.ts: PAL` (contorno, sombras, cartel, muro y suelo
común `wallCommon/floorCommon`), suelos por tipo y estaciones (`seasons.ts`).

## Invariantes (tests)

`packages/web/test/world.test.ts`: 60 días × 5 conjuntos, casos límite, 60 secuencias de 6 pasos (agente
nuevo, zona nueva, baja, oficina nueva, demolición), histéresis, reclamo gradual con vecinos y rendimiento.
Comprueba: una sola planta (todo lo que no es hierba está 4‑conectado), recepción íntegra con entrada y
camino, cada puerta sobre un pasillo y alcanzable desde la recepción por pasillos, pasillo de 2 filas
delante de cada fachada, sala íntegra, tiles = orden de obra, área ≤ sala × 1,9 + 12, bloques 2×2, sin
islas, sin alas junto a la fachada, muebles válidos (oficina y zona común), mesas dentro de la sala,
1..3 huecos libres, árboles/arbustos/decoración con todo el sprite sobre hierba, estabilidad (lo no
afectado no se mueve ni cambia de forma, muebles y fachada iguales, nadie cambia de mesa; una vecina
empujada solo pierde alas), derribo y obra exactamente en los tiles que cambian de dueño, idempotencia de
`relayout`, p95 < 80 ms desde cero con 12 oficinas y p95 < 40 ms incremental (medido: ~32 / ~17 ms).

`packages/web/scripts/scene-check.mjs` deja `scene-1/2/zoom/scale1/wait/fx.png`, `scene-50.png` y
`scene-50-south.png` tras crecer a 8 oficinas, `scene-shrink.png` y `scene-shrink-south.png` tras irse 40
agentes (las demás no se mueven). Las capturas anteriores están en `packages/web/scripts/before/`.

## Sistemas naturales elegidos y por qué

- **Acreción por frentes (modelo de Eden)** para los territorios: Eden, M. (1961), *A two-dimensional
  growth process*, Proc. 4th Berkeley Symp. Da bordes rugosos pero compactos, es incremental (cada tile
  que se añade es local) y determinista con ruido por tile. Descartado el DLA (demasiado ramificado).
- **Partición ponderada tipo Voronoi / power diagram**: Aurenhammer, F. (1987), *Power diagrams:
  properties, algorithms and applications*, SIAM J. Comput.; Balzer, M. y Deussen, O. (2005), *Voronoi
  treemaps*, IEEE InfoVis (área proporcional a un peso). Aquí el peso es la demanda restante: en cada
  ronda crece primero la oficina más lejos de su objetivo, lo que reparte el área en proporción sin
  resolver un diagrama continuo. La relajación de Lloyd (Lloyd, S. (1982), *Least squares quantization
  in PCM*) se descartó: mueve las semillas, y las salas no pueden moverse sin reconstruirse.
- **Autómatas celulares** para suavizar: regla de mayoría (≥ 3 vecinos) como en *Cellular Automata
  Method for Generating Random Cave-Like Levels* (RogueBasin). Solo rellena, nunca quita (lo quita
  `shapeUp`), así no oscila.
- **Red de pasillos como árbol de rutas más baratas (Prim + Dijkstra multiobjetivo)**: Amit Patel (Red
  Blob Games), *Introduction to A\**; TinyKeep (Phi Dinh), Delaunay + MST + A\*. Se evaluó la
  colonización de espacio (Runions, Lane y Prusinkiewicz (2007), *Modeling trees with a space
  colonization algorithm*, Eurographics NPH) y la venación de hojas (Runions et al. (2005), *Modeling and
  visualization of leaf venation patterns*, SIGGRAPH): producen árboles bonitos, pero sus ramas no
  respetan la rejilla ni los rectángulos de las salas y no son incrementales ante cambios locales; el
  árbol de rutas con coste bajo en lo ya construido da la misma forma ramificada y añade un ramal por
  oficina nueva sin redibujar.
- **Muestreo de disco de Poisson** para árboles: Bridson, R. (2007), *Fast Poisson disk sampling in
  arbitrary dimensions*, SIGGRAPH sketches; aquí la variante por rechazo con hash de tile (determinista y
  local) y densidad modulada por ruido de baja frecuencia para formar bosquetes.
- **Sucesión ecológica** para el espacio liberado: Clements, F. (1916), *Plant succession*; Connell, J. y
  Slatyer, R. (1977), *Mechanisms of succession in natural communities*, Am. Nat. Un tile que una oficina
  suelta no desaparece: si está encerrado se convierte en sala de descanso (colonización por el común),
  si da al exterior vuelve a ser hierba y recupera sus árboles por hash de tile.
- **Reacción‑difusión y campos de presión** (Turing (1952), *The chemical basis of morphogenesis*) se
  descartaron: requieren iterar un campo continuo sobre toda la planta y no son locales ni estables ante
  un cambio en una oficina.
- Determinismo por hash en vez de rng secuencial: Squirrel Eiserloh (GDC 2017), *Math for Game
  Programmers: Noise-Based RNG*.
- Autotiling por bitmask: Boris the Brave, *Tileset roundup* / *Marching squares & autotiling*. Pixi v8
  `RenderGroupSystem`/`TexturePool`: `cacheAsTexture` usa `"linear"` si no se indica `scaleMode`.
