// pop.js — guiños pixel-art a la cultura de los videojuegos + emojis + gags de agente.
// Diseños originales que evocan tópicos del medio (bloque sorpresa, tubería, seta con lunares,
// alien de recreativa, fantasma de laberinto, piezas de cuatro bloques...). Sin marcas ni copias.
// Depende de los globales del motor: R, spr, txt, hash, OL. Prefijo `pop` para lo auxiliar.

// ---------- paletas compartidas ----------
const POP_C = {
  gold:'#f5c542', goldL:'#fff1a8', goldD:'#b8860b',
  red:'#e5533d', redL:'#ff9d8a', redD:'#a8322a',
  orange:'#f0802a', yellow:'#ffd23f', cream:'#fff6c9',
  green:'#4cc38a', greenL:'#8ee6b4', greenD:'#2e8a5e', lime:'#7ee787',
  blue:'#4a90e2', sky:'#79c0ff', cyan:'#5ad1e6', cyanL:'#9be8f5', cyanD:'#3fb8d8',
  purple:'#d2a8ff', magenta:'#d64fa0', pink:'#ffb3d9',
  white:'#e9f2f7', grey:'#8f96a3', greyD:'#5b5470', slate:'#3b3346', dark:'#100e16',
  wood:'#a8744c', woodL:'#c9a06a', woodD:'#6b4329', skin:'#f5e6c8'
};

// ============================================================
// DECORACIÓN
// place 'wall' (alto máx. 12, ancho máx. 16) · 'floor' (ancho máx. 18, alto máx. 20)
// ============================================================
const POP_DECO = {
  // ---- pared ----
  bloque: { name:'Bloque sorpresa', place:'wall', w:12, h:12, fps:1.5,
    pal:{ O:OL, Y:'#f0a030', d:'#8a4a12', w:POP_C.goldL },
    frames:[[
      "OOOOOOOOOOOO",
      "OdYYYYYYYYdO",
      "OYYYOOOOYYYO",
      "OYYOOYYOOYYO",
      "OYYOOYYOOYYO",
      "OYYYYYOOYYYO",
      "OYYYYOOYYYYO",
      "OYYYYOOYYYYO",
      "OYYYYYYYYYYO",
      "OYYYYOOYYYYO",
      "OdYYYYYYYYdO",
      "OOOOOOOOOOOO"
    ],[
      "OOOOOOOOOOOO",
      "OdYYYYYYYYdO",
      "OYYYwwwwYYYO",
      "OYYwwYYwwYYO",
      "OYYwwYYwwYYO",
      "OYYYYYwwYYYO",
      "OYYYYwwYYYYO",
      "OYYYYwwYYYYO",
      "OYYYYYYYYYYO",
      "OYYYYwwYYYYO",
      "OdYYYYYYYYdO",
      "OOOOOOOOOOOO"
    ]] },

  corazones: { name:'Corazones de vida', place:'wall', w:15, h:5, fps:2,
    pal:{ O:OL, R:POP_C.red, r:POP_C.redL, g:POP_C.greyD },
    frames:[[
      "OO.OOOO.OOOO.OO",
      "OrRROOrRROOrRgO",
      "ORRROORRROORRgO",
      ".ORO..ORO..OgO.",
      "..O....O....O.."
    ],[
      "OO.OOOO.OOOO.OO",
      "OrRROOrRROOgggO",
      "ORRROORRROOgggO",
      ".ORO..ORO..OgO.",
      "..O....O....O.."
    ]] },

  invader: { name:'Alien de recreativa', place:'wall', w:13, h:10, fps:2,
    pal:{ O:OL, k:POP_C.dark, A:POP_C.lime },
    frames:[[
      "OOOOOOOOOOOOO",
      "OkkAkkkkkAkkO",
      "OkkkAkkkAkkkO",
      "OkkAAAAAAAkkO",
      "OkAAkAAAkAAkO",
      "OAAAAAAAAAAAO",
      "OAkAAAAAAAkAO",
      "OAkAkkkkkAkAO",
      "OkkkAAkAAkkkO",
      "OOOOOOOOOOOOO"
    ],[
      "OOOOOOOOOOOOO",
      "OkkAkkkkkAkkO",
      "OAkkAkkkAkkAO",
      "OAkAAAAAAAkAO",
      "OAAAkAAAkAAAO",
      "OAAAAAAAAAAAO",
      "OkAAAAAAAAAkO",
      "OkkAkkkkkAkkO",
      "OkAkkkkkkkAkO",
      "OOOOOOOOOOOOO"
    ]] },

  fantasma: { name:'Fantasma de laberinto', place:'wall', w:16, h:8, fps:2,
    pal:{ O:OL, C:POP_C.cyan, w:POP_C.white, b:'#2f5fb3', p:'#ffe9b0' },
    frames:[[
      "..OOOO..........",
      ".OCCCCO.........",
      "OCwwCwwO........",
      "OCwbCwbO..pp..pp",
      "OCCCCCCO..pp..pp",
      "OCCCCCCO........",
      "OCCCCCCO........",
      "OC.CC.CO........"
    ],[
      "..OOOO..........",
      ".OCCCCO.........",
      "OCwwCwwO........",
      "OCwbCwbO......pp",
      "OCCCCCCO......pp",
      "OCCCCCCO........",
      "OCCCCCCO........",
      "O.CCCC.O........"
    ],[
      "..OOOO..........",
      ".OCCCCO.........",
      "OCwwCwwO........",
      "OCwbCwbO........",
      "OCCCCCCO........",
      "OCCCCCCO........",
      "OCCCCCCO........",
      "OC.CC.CO........"
    ]] },

  cartel_1up: { name:'Cartel 1UP', place:'wall', w:15, h:9, fps:1.5,
    pal:{ O:OL, B:'#163a22', G:POP_C.lime, W:'#d8ffe0' },
    frames:[[
      "OOOOOOOOOOOOOOO",
      "OBBBBBBBBBBBBBO",
      "OB.G..G.G.GG.BO",
      "OBGG..G.G.G.GBO",
      "OB.G..G.G.GG.BO",
      "OB.G..G.G.G..BO",
      "OBGGG.GGG.G..BO",
      "OBBBBBBBBBBBBBO",
      "OOOOOOOOOOOOOOO"
    ],[
      "OOOOOOOOOOOOOOO",
      "OBBBBBBBBBBBBBO",
      "OB.W..W.W.WW.BO",
      "OBWW..W.W.W.WBO",
      "OB.W..W.W.WW.BO",
      "OB.W..W.W.W..BO",
      "OBWWW.WWW.W..BO",
      "OBBBBBBBBBBBBBO",
      "OOOOOOOOOOOOOOO"
    ]] },

  escudo: { name:'Escudo con gema', place:'wall', w:10, h:12, fps:0,
    pal:{ O:OL, y:'#d9a441', B:'#2f5fb3', b:'#234a8c', r:POP_C.red },
    frames:[[
      "OOOOOOOOOO",
      "OyyyyyyyyO",
      "OyBBBBBbyO",
      "OyBBrrBbyO",
      "OyBrrrrbyO",
      "OyBBrrBbyO",
      "OyBBBBBbyO",
      "OyBBBBBbyO",
      ".OyBBBbyO.",
      "..OyBbyO..",
      "...OyyO...",
      "....OO...."
    ]] },

  estrella: { name:'Estrella de invencibilidad', place:'wall', w:9, h:9, fps:4,
    pal:{ O:OL, Y:POP_C.yellow, w:POP_C.cream, e:OL },
    frames:[[
      "....O....",
      "...OYO...",
      "...OYO...",
      "OOOOYOOOO",
      "OYYeYeYYO",
      ".OYYYYYO.",
      "..OYYYO..",
      ".OYYOYYO.",
      ".OO...OO."
    ],[
      "....O....",
      "...OwO...",
      "...OwO...",
      "OOOOwOOOO",
      "OwwewewwO",
      ".OwwwwwO.",
      "..OwwwO..",
      ".OwwOwwO.",
      ".OO...OO."
    ]] },

  mando: { name:'Mando de consola', place:'wall', w:16, h:8, fps:0,
    pal:{ O:OL, g:POP_C.grey, d:POP_C.greyD, b:POP_C.blue, r:POP_C.red },
    frames:[[
      ".OOOOOOOOOOOOOO.",
      "OggggggggggggggO",
      "OggOgggggbbgrrgO",
      "OgOOOggggbbgrrgO",
      "OggOgggddggggggO",
      "OggggggggggggggO",
      "OddggggggggggddO",
      ".OOOOOOOOOOOOOO."
    ]] },

  // ---- suelo ----
  tuberia: { name:'Tubería verde', place:'floor', w:14, h:16, fps:0,
    pal:{ O:OL, l:POP_C.greenL, G:POP_C.green, d:POP_C.greenD },
    frames:[[
      "OOOOOOOOOOOOOO",
      "OllGGGGGGGGddO",
      "OllGGGGGGGGddO",
      "OllGGGGGGGGddO",
      "OOOOOOOOOOOOOO",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OllGGGGGGddO.",
      ".OOOOOOOOOOOO."
    ]] },

  seta: { name:'Seta con lunares', place:'floor', w:12, h:12, fps:2,
    pal:{ O:OL, r:POP_C.red, w:POP_C.white, c:POP_C.skin, e:OL },
    frames:[[
      "...OOOOOO...",
      "..OrrrrrrrO.",
      ".OrrwwrwwrrO",
      "OrrrwwrwwrrO",
      "OrrrrwwrrrrO",
      "OrrrrwwrrrrO",
      "OOOOOOOOOOOO",
      ".OccccccccO.",
      ".OceccccecO.",
      ".OccccccccO.",
      "..OOOOOOOO..",
      "............"
    ],[
      "............",
      "...OOOOOO...",
      "..OrrrrrrrO.",
      ".OrrwwrwwrrO",
      "OrrrwwrwwrrO",
      "OrrrrwwrrrrO",
      "OrrrrwwrrrrO",
      "OOOOOOOOOOOO",
      ".OccccccccO.",
      ".OceccccecO.",
      ".OccccccccO.",
      "..OOOOOOOO.."
    ]] },

  cofre: { name:'Cofre del tesoro', place:'floor', w:14, h:13, fps:1.5,
    pal:{ O:OL, l:POP_C.woodL, b:POP_C.wood, d:POP_C.woodD, m:POP_C.grey, y:POP_C.gold, Y:POP_C.cream, s:'#ffffff' },
    frames:[[
      "..............",
      "..............",
      "..............",
      ".OOOOOOOOOOOO.",
      "OllllllllllllO",
      "ObbbbbbbbbbbbO",
      "OmmmmmmmmmmmmO",
      "OdddddyydddddO",
      "OdddddyydddddO",
      "OddddddddddddO",
      "OddddddddddddO",
      ".OOOOOOOOOOOO.",
      ".............."
    ],[
      "..............",
      "..............",
      "..............",
      ".OOOOOOOOOOOO.",
      "OllllllllllllO",
      "ObbbbbbbbbbbbO",
      "OmmmmmmmmmmmmO",
      "OdddddyydddddO",
      "OdddddyydddddO",
      "OddddddddddddO",
      "OddddddddddddO",
      ".OOOOOOOOOOOO.",
      ".............."
    ],[
      ".OOOOOOOOOOOO.",
      "OllllllllllllO",
      "ObbbbbbbbbbbbO",
      ".OOOOOOOOOOOO.",
      "OyyYyyyyYyyyyO",
      "OyyyyyyyyyyyyO",
      "OmmmmmmmmmmmmO",
      "OdddddyydddddO",
      "OdddddyydddddO",
      "OddddddddddddO",
      "OddddddddddddO",
      ".OOOOOOOOOOOO.",
      ".............."
    ],[
      ".OOOOOOOOOOOO.",
      "OllllllllllllO",
      "ObbbbbbbbbbbbO",
      ".OOOOOOOOOOOO.",
      "OYysyyyYyysyyO",
      "OyyyyyYyyyyyyO",
      "OmmmmmmmmmmmmO",
      "OdddddyydddddO",
      "OdddddyydddddO",
      "OddddddddddddO",
      "OddddddddddddO",
      ".OOOOOOOOOOOO.",
      ".............."
    ]] },

  cristal: { name:'Cristal de guardado', place:'floor', w:9, h:13, fps:3,
    pal:{ O:OL, c:POP_C.cyanL, C:POP_C.cyanD, w:'#ffffff', m:POP_C.greyD },
    frames:[[
      "....O....",
      "...OcO...",
      "..OcCcO..",
      ".OcCCCcO.",
      ".OcCwCcO.",
      ".OcCCCcO.",
      "..OcCcO..",
      "...OcO...",
      "....O....",
      ".........",
      "..OOOOO..",
      ".OmmmmmO.",
      ".OOOOOOO."
    ],[
      ".........",
      "....O....",
      "...OcO...",
      "..OcCcO..",
      ".OcCCCcO.",
      ".OcwCCcO.",
      ".OcCCCcO.",
      "..OcCcO..",
      "...OcO...",
      "....O....",
      "..OOOOO..",
      ".OmmmmmO.",
      ".OOOOOOO."
    ],[
      "....O....",
      "...OcO...",
      ".wOcCcO..",
      ".OcCCCcO.",
      ".OcCCwcO.",
      ".OcCCCcO.",
      "..OcCcOw.",
      "...OcO...",
      "....O....",
      ".........",
      "..OOOOO..",
      ".OmmmmmO.",
      ".OOOOOOO."
    ]] },

  arcade: { name:'Máquina recreativa', place:'floor', w:14, h:20, fps:2,
    pal:{ O:OL, M:POP_C.magenta, m:'#8a2f66', k:POP_C.slate, K:'#4d4459', S:POP_C.dark, a:POP_C.lime, p:POP_C.yellow, s:'#ffffff', j:POP_C.grey, r:POP_C.red },
    frames:[[
      ".OOOOOOOOOOOO.",
      "OmMMMMMMMMMMmO",
      "OmMMMMMMMMMMmO",
      "OOOOOOOOOOOOOO",
      "OkkOOOOOOOOkkO",
      "OkkOSSSSSSOkkO",
      "OkkOSaSSSSOkkO",
      "OkkOSSSSSSOkkO",
      "OkkOSSSpSSOkkO",
      "OkkOOOOOOOOkkO",
      "OkkkkkkkkkkkkO",
      "OkkOOOOOOOOkkO",
      "OkkOjOOrOrOkkO",
      "OkkOOOOOOOOkkO",
      "OkkkkkkkkkkkkO",
      "OkkKKKKKKKKkkO",
      "OkkKKKKKKKKkkO",
      "OkkKKKKKKKKkkO",
      "OkkKKKKKKKKkkO",
      ".OOOOOOOOOOOO."
    ],[
      ".OOOOOOOOOOOO.",
      "OmMMMMMMMMMMmO",
      "OmMMMMMMMMMMmO",
      "OOOOOOOOOOOOOO",
      "OkkOOOOOOOOkkO",
      "OkkOSSSSSSOkkO",
      "OkkOSSSSaSOkkO",
      "OkkOSSSsSSOkkO",
      "OkkOSSSpSSOkkO",
      "OkkOOOOOOOOkkO",
      "OkkkkkkkkkkkkO",
      "OkkOOOOOOOOkkO",
      "OkkOjOOrOrOkkO",
      "OkkOOOOOOOOkkO",
      "OkkkkkkkkkkkkO",
      "OkkKKKKKKKKkkO",
      "OkkKKKKKKKKkkO",
      "OkkKKKKKKKKkkO",
      "OkkKKKKKKKKkkO",
      ".OOOOOOOOOOOO."
    ]] },

  bloque_hierba: { name:'Bloque de tierra con hierba', place:'floor', w:12, h:12, fps:0,
    pal:{ O:OL, G:'#5aa83c', g:'#7fcf4a', d:'#8a5a2b', D:POP_C.woodD },
    frames:[[
      "OOOOOOOOOOOO",
      "OgGGgGGgGGgO",
      "OGGGGGGGGGGO",
      "OGGdGGGdGGGO",
      "OdGdddGddddO",
      "OddddddddddO",
      "OdDddddDdddO",
      "OddddDddddDO",
      "OddddddddddO",
      "ODddddDddddO",
      "OddddddddddO",
      "OOOOOOOOOOOO"
    ]] },

  espada_piedra: { name:'Espada clavada en la piedra', place:'floor', w:12, h:16, fps:1,
    pal:{ O:OL, y:'#d9a441', b:POP_C.woodD, w:'#d5d9e0', s:POP_C.grey, K:'#8a8699', k:'#6e6a7a', D:'#4a4656', g:'#ffffff' },
    frames:[[
      ".....OO.....",
      "....OyyO....",
      "....ObbO....",
      "....ObbO....",
      "..OOOOOOOO..",
      "..OyyyyyyO..",
      "..OOOwsOOO..",
      "....OwsO....",
      "....OwsO....",
      "....OwsO....",
      ".OOOOwsOOOO.",
      "OKKKKwsKKKkO",
      "OKKkkkkkkkkO",
      "OkkkkkkkkkkO",
      "OkkkkDkkkkkO",
      "OOOOOOOOOOOO"
    ],[
      ".....OO.....",
      "....OyyO....",
      "....ObbO....",
      "....ObbO....",
      "..OOOOOOOO..",
      "..OyyyyyyO..",
      "..OOOgsOOO..",
      "...gOgsO....",
      "....OwsOg...",
      "....OwsO....",
      ".OOOOwsOOOO.",
      "OKKKKwsKKKkO",
      "OKKkkkkkkkkO",
      "OkkkkkkkkkkO",
      "OkkkkDkkkkkO",
      "OOOOOOOOOOOO"
    ]] },

  pocion: { name:'Poción', place:'floor', w:8, h:12, fps:2,
    pal:{ O:OL, b:POP_C.wood, w:'#dff4ff', P:'#d84d8e', p:POP_C.pink },
    frames:[[
      "..OOOO..",
      "..ObbO..",
      "..ObbO..",
      "..OwwO..",
      ".OwwwwO.",
      "OwwwwwwO",
      "OwPPPPwO",
      "OPPpPPPO",
      "OPPPPPPO",
      "OPpPPPPO",
      ".OPPPPO.",
      "..OOOO.."
    ],[
      "..OOOO..",
      "..ObbO..",
      "..ObbO..",
      "..OwwO..",
      ".OwwwwO.",
      "OwwwwwwO",
      "OwPpPPwO",
      "OPPPPPPO",
      "OPPPPpPO",
      "OPPPPPPO",
      ".OPPPPO.",
      "..OOOO.."
    ]] },

  anillo: { name:'Anillo dorado', place:'floor', w:9, h:9, fps:6,
    pal:{ O:OL, y:POP_C.gold, Y:POP_C.goldL },
    frames:[[
      "..OOOOO..",
      ".OyYYYyO.",
      "OyyO.OyyO",
      "OyO...OyO",
      "OyO...OyO",
      "OyO...OyO",
      "OyyO.OyyO",
      ".OyyyyyO.",
      "..OOOOO.."
    ],[
      "...OOO...",
      "..OyYyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyyyO..",
      "...OOO..."
    ],[
      "...OOO...",
      "...OyO...",
      "...OyO...",
      "...OYO...",
      "...OYO...",
      "...OyO...",
      "...OyO...",
      "...OyO...",
      "...OOO..."
    ],[
      "...OOO...",
      "..OyYyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyOyO..",
      "..OyyyO..",
      "...OOO..."
    ]] },

  cartucho: { name:'Cartucho', place:'floor', w:12, h:12, fps:0,
    pal:{ O:OL, g:POP_C.grey, d:POP_C.greyD, B:POP_C.sky, G:'#5aa83c', y:POP_C.yellow },
    frames:[[
      ".OOOOOOOOOO.",
      "OggggggggggO",
      "OgOOOOOOOOgO",
      "OgOBBBBBBOgO",
      "OgOBBBByBOgO",
      "OgOBBBBBBOgO",
      "OgOGGGGGGOgO",
      "OgOOOOOOOOgO",
      "OggggggggggO",
      "OgdgdgdgdgdO",
      "OggggggggggO",
      ".OOOOOOOOOO."
    ]] }
};

// ============================================================
// EMOJIS 9×9 (contorno OL)
// ============================================================
const POP_EMOJI = {
  corazon: { name:'Corazón', fps:0, pal:{ O:OL, R:POP_C.red, r:POP_C.redL, d:POP_C.redD },
    frames:[[
      ".........",
      ".OO...OO.",
      "OrRO.ORRO",
      "ORRRORRRO",
      "ORRRRRRRO",
      ".ORRRRdO.",
      "..ORRdO..",
      "...OdO...",
      "....O...."
    ]] },
  estrella: { name:'Estrella', fps:0, pal:{ O:OL, Y:POP_C.yellow, y:POP_C.cream },
    frames:[[
      "....O....",
      "...OyO...",
      "OOOOYOOOO",
      "OyYYYYYYO",
      ".OYYYYYO.",
      "..OYYYO..",
      ".OYYOYYO.",
      ".OYO.OYO.",
      ".OO...OO."
    ]] },
  fuego: { name:'Fuego', fps:4, pal:{ O:OL, r:POP_C.orange, Y:POP_C.yellow, y:POP_C.cream, R:'#c4302b' },
    frames:[[
      "....O....",
      "...OrO...",
      "..OrrrO..",
      "..OrYrO..",
      ".OrYyYrO.",
      ".OrYyYrO.",
      "OrrYyYrrO",
      ".ORYYYRO.",
      "..OOOOO.."
    ],[
      "...O.....",
      "..OrO.O..",
      "..OrrOrO.",
      ".OrYrrrO.",
      ".OrYyYrO.",
      "OrrYyYrrO",
      "OrRYyYRrO",
      ".ORYYYRO.",
      "..OOOOO.."
    ]] },
  pulgar: { name:'Pulgar arriba', fps:0, pal:{ O:OL, Y:POP_C.gold, y:POP_C.goldL },
    frames:[[
      "...OO....",
      "..OyYO...",
      "..OYYO...",
      "..OYYOOO.",
      "OOOYYYYYO",
      "OyYYYYYYO",
      "OyYYYYYYO",
      ".OYYYYYYO",
      "..OOOOOO."
    ]] },
  cafe: { name:'Café', fps:2, pal:{ O:OL, s:'#c9ccd6', c:POP_C.woodD, w:POP_C.white },
    frames:[[
      "..s.s.s..",
      ".s.s.s...",
      "..s.s.s..",
      "OOOOOO...",
      "OccccOOO.",
      "OwwwwO.O.",
      "OwwwwOOO.",
      ".OwwwO...",
      ".OOOOO..."
    ],[
      ".s.s.s...",
      "..s.s.s..",
      ".s.s.s...",
      "OOOOOO...",
      "OccccOOO.",
      "OwwwwO.O.",
      "OwwwwOOO.",
      ".OwwwO...",
      ".OOOOO..."
    ]] },
  bicho: { name:'Bicho (bug)', fps:0, pal:{ O:OL, r:POP_C.red, k:POP_C.slate },
    frames:[[
      ".O.....O.",
      "..O.O.O..",
      "..OOOOO..",
      ".OkkOkkO.",
      "OOrrOrrOO",
      ".OrkOkrO.",
      "OOrrOrrOO",
      ".OrrOrrO.",
      "..OOOOO.."
    ]] },
  fiesta: { name:'Fiesta', fps:3, pal:{ O:OL, y:POP_C.yellow, r:POP_C.red, p:POP_C.pink, b:POP_C.sky, g:POP_C.lime },
    frames:[[
      ".p..y..b.",
      "...p...g.",
      "OO...y...",
      "OyyO.....",
      "OyryO..p.",
      ".OyryyO..",
      "..OyryyO.",
      "...OyryyO",
      "....OOOOO"
    ],[
      "..b.p..y.",
      ".g...b...",
      "OO.p...g.",
      "OyyO..y..",
      "OyryO....",
      ".OyryyO..",
      "..OyryyO.",
      "...OyryyO",
      "....OOOOO"
    ]] },
  cohete: { name:'Cohete', fps:4, pal:{ O:OL, w:'#d5d9e0', b:POP_C.sky, r:POP_C.red, F:POP_C.yellow, f:POP_C.orange },
    frames:[[
      "....O....",
      "...OwO...",
      "...OwO...",
      "..OwbwO..",
      "..OwwwO..",
      ".OrOwOrO.",
      ".OrOOOrO.",
      ".OO.F.OO.",
      "...fFf..."
    ],[
      "....O....",
      "...OwO...",
      "...OwO...",
      "..OwbwO..",
      "..OwwwO..",
      ".OrOwOrO.",
      ".OrOOOrO.",
      ".OO.f.OO.",
      "....F...."
    ]] },
  bombilla: { name:'Bombilla', fps:0, pal:{ O:OL, y:POP_C.yellow, Y:POP_C.cream, g:POP_C.grey },
    frames:[[
      "..OOOOO..",
      ".OyyYyyO.",
      "OyyYYyyyO",
      "OyyYyyyyO",
      "OyyyyyyyO",
      ".OyyyyyO.",
      "..OgggO..",
      "..OgggO..",
      "...OOO..."
    ]] },
  calavera: { name:'Calavera', fps:0, pal:{ O:OL, w:POP_C.white, g:'#c9ccd6' },
    frames:[[
      "..OOOOO..",
      ".OwwwwgO.",
      "OwwwwwwgO",
      "OwOOwOOgO",
      "OwOOwOOgO",
      "OwwwwwwgO",
      ".OwOwOgO.",
      "..OwwgO..",
      "..OOOOO.."
    ]] },
  cien: { name:'100', fps:0, pal:{ O:OL, r:POP_C.red },
    frames:[[
      "r.rrr.rrr",
      "r.r.r.r.r",
      "r.r.r.r.r",
      "r.r.r.r.r",
      "r.rrr.rrr",
      "O.OOO.OOO",
      "rrrrrrrrr",
      "OOOOOOOOO",
      "rrrrrrrrr"
    ]] },
  ojos: { name:'Ojos', fps:1, pal:{ O:OL, w:POP_C.white, k:'#2a2733' },
    frames:[[
      ".........",
      ".OOO.OOO.",
      "OwwwOwwwO",
      "OwwkOwwkO",
      "OwkkOwkkO",
      "OwwwOwwwO",
      ".OOO.OOO.",
      ".........",
      "........."
    ],[
      ".........",
      ".OOO.OOO.",
      "OwwwOwwwO",
      "OkwwOkwwO",
      "OkkwOkkwO",
      "OwwwOwwwO",
      ".OOO.OOO.",
      ".........",
      "........."
    ]] },
  risa: { name:'Risa', fps:0, pal:{ O:OL, y:POP_C.gold, w:POP_C.white, r:POP_C.red },
    frames:[[
      "..OOOOO..",
      ".OyyyyyO.",
      "OyOyyyOyO",
      "OyyyyyyyO",
      "OyOOOOOyO",
      "OyOwwwOyO",
      "OyOrrrOyO",
      ".OyOOOyO.",
      "..OOOOO.."
    ]] },
  ok: { name:'Visto bueno', fps:0, pal:{ O:OL, g:POP_C.green, w:'#ffffff' },
    frames:[[
      ".........",
      "..OOOOO..",
      ".OgggggO.",
      "OgggggwgO",
      "OggggwggO",
      "OgwgwgggO",
      "OgggwgggO",
      ".OgggggO.",
      "..OOOOO.."
    ]] },
  moneda: { name:'Moneda', fps:0, pal:{ O:OL, Y:POP_C.gold, y:POP_C.goldL, d:POP_C.goldD },
    frames:[[
      "..OOOOO..",
      ".OyYYYdO.",
      "OyYyYYYdO",
      "OYYyYYYdO",
      "OYYyYYYdO",
      "OYYYYYYdO",
      "OYYYYYddO",
      ".OYYYddO.",
      "..OOOOO.."
    ]] }
};

// ============================================================
// GAGS (agente sentado; x,y esquina sup. izq. del sprite 10 px; mesa en y+10)
// draw dibuja dentro de x-10..x+20, y-26..y+12, solo coordenadas enteras.
// ============================================================
const POP_PAL_BLOCK = { O:OL, Y:'#f0a030', d:'#8a4a12', B:POP_C.wood, b:POP_C.woodD };
const POP_GAG_BLOCK = [
  "OOOOOOOOOO",
  "OdYYYYYYdO",
  "OYYOOOOYYO",
  "OYOOYYOOYO",
  "OYYYYOOYYO",
  "OYYYOOYYYO",
  "OYYYYYYYYO",
  "OYYYOOYYYO",
  "OdYYYYYYdO",
  "OOOOOOOOOO"
];
const POP_GAG_BLOCK_USED = [
  "OOOOOOOOOO",
  "ObBBBBBBbO",
  "OBbBBBBbBO",
  "OBBBBBBBBO",
  "OBBBBBBBBO",
  "OBBBBBBBBO",
  "OBBBBBBBBO",
  "OBbBBBBbBO",
  "ObBBBBBBbO",
  "OOOOOOOOOO"
];
const POP_PAL_COIN = { O:OL, y:POP_C.goldD, Y:POP_C.gold, w:POP_C.goldL };
const POP_COIN = [".OOO.", "OyYyO", "OYwYO", "OYYyO", ".OOO."];
const POP_PAL_SWORD = { O:OL, w:'#d5d9e0', s:POP_C.grey, y:'#d9a441', b:POP_C.woodD };
const POP_SWORD = [
  "..OO..",
  ".OwsO.",
  ".OwsO.",
  ".OwsO.",
  ".OwsO.",
  ".OwsO.",
  ".OwsO.",
  "OOOOOO",
  "OyyyyO",
  "OOOOOO",
  ".ObbO.",
  ".ObbO.",
  ".OyyO.",
  "..OO.."
];
const POP_PAL_PIPE = { O:OL, l:POP_C.greenL, G:POP_C.green, d:POP_C.greenD };
const POP_PIPE_CAP = [
  "OOOOOOOOOOOOOO",
  "OllGGGGGGGGddO",
  "OllGGGGGGGGddO",
  "OOOOOOOOOOOOOO"
];
const POP_PAL_SHROOM = { O:OL, r:POP_C.red, w:POP_C.white, c:POP_C.skin, e:OL };
const POP_SHROOM = [
  "..OOOO..",
  ".OrwwrO.",
  "OwrrrrwO",
  "OrrrrrrO",
  "OOOOOOOO",
  ".OccccO.",
  ".OecceO.",
  "..OOOO.."
];
const POP_PAL_GHOST = { O:OL, C:POP_C.cyan, w:POP_C.white, b:'#2f5fb3' };
const POP_GHOST = [[
  "..OOOO..",
  ".OCCCCO.",
  "OCwwCwwO",
  "OCwbCwbO",
  "OCCCCCCO",
  "OCCCCCCO",
  "OCCCCCCO",
  "OC.CC.CO"
],[
  "..OOOO..",
  ".OCCCCO.",
  "OCwwCwwO",
  "OCwbCwbO",
  "OCCCCCCO",
  "OCCCCCCO",
  "OCCCCCCO",
  "O.CCCC.O"
]];
const POP_PAL_ALIEN = { A:POP_C.lime };
const POP_ALIEN = [[
  "..A.....A..",
  "...A...A...",
  "..AAAAAAA..",
  ".AA.AAA.AA.",
  "AAAAAAAAAAA",
  "A.AAAAAAA.A",
  "A.A.....A.A",
  "...AA.AA..."
],[
  "..A.....A..",
  "A..A...A..A",
  "A.AAAAAAA.A",
  "AAA.AAA.AAA",
  "AAAAAAAAAAA",
  ".AAAAAAAAA.",
  "..A.....A..",
  ".A.......A."
]];

// destello en cruz (3×3) centrado en (cx,cy)
function popSparkle(g, cx, cy, c, big) {
  R(g, cx, cy, 1, 1, c);
  R(g, cx - 1, cy, 1, 1, c); R(g, cx + 1, cy, 1, 1, c);
  R(g, cx, cy - 1, 1, 1, c); R(g, cx, cy + 1, 1, 1, c);
  if (big) { R(g, cx - 2, cy, 1, 1, c); R(g, cx + 2, cy, 1, 1, c); R(g, cx, cy - 2, 1, 1, c); R(g, cx, cy + 2, 1, 1, c); }
}
// recorta un valor al intervalo [a,b]
function popClamp(v, a, b) { return v < a ? a : v > b ? b : v; }
// celda 2×2 de pieza de cuatro bloques con brillo en la esquina
function popCell(g, x, y, c, light) { R(g, x, y, 2, 2, c); R(g, x, y, 1, 1, light); }
// texto con sombra de 1 px para que se lea sobre cualquier fondo
function popText(g, s, x, y, c) { txt(g, s, x + 1, y + 1, OL, 1); txt(g, s, x, y, c, 1); }

const POP_GAGS = {
  bloque: { name:'Golpe al bloque', dur:1.6,
    pose(p) { return { lift: p < 0.5 ? Math.round(5 * Math.sin((p / 0.5) * Math.PI)) : 0 }; },
    draw(g, x, y, p, t) {
      const hit = p >= 0.3;
      const bump = (p >= 0.3 && p < 0.45) ? 2 : 0;
      if (hit && p < 0.85) {
        const q = (p - 0.3) / 0.55;
        const cy = y - 18 - Math.round(8 * Math.sin(q * Math.PI));
        spr(g, POP_COIN, x + 2 + Math.round(q * 3), cy, POP_PAL_COIN, false);
      }
      spr(g, hit ? POP_GAG_BLOCK_USED : POP_GAG_BLOCK, x, y - 16 - bump, POP_PAL_BLOCK, false);
      if (p >= 0.85) {
        const k = Math.floor(t * 10);
        popSparkle(g, x + 5 + (k % 2), y - 23, k % 2 ? POP_C.goldL : '#ffffff', k % 2 === 0);
      }
      if (hit && p < 0.5) { R(g, x - 2, y - 7, 1, 1, '#ffffff'); R(g, x + 11, y - 7, 1, 1, '#ffffff'); }
    } },

  espada: { name:'Objeto conseguido', dur:2.0,
    pose(p) { return { arms:'up' }; },
    draw(g, x, y, p, t) {
      const up = Math.round((1 - popClamp(p / 0.15, 0, 1)) * 6);
      const cx = x + 5, cy = y - 9;
      if (p > 0.15) {
        const rot = Math.floor(t * 6) % 2;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + rot * (Math.PI / 8);
          const len = 7 + Math.floor(hash(i + Math.floor(t * 4)) % 3);
          for (let d = 6; d <= len; d++) {
            const px = cx + Math.round(Math.cos(a) * d), py = cy + Math.round(Math.sin(a) * d);
            if (py < y - 20 || py > y - 1 || px < x - 6 || px > x + 15) continue;
            R(g, px, py, 1, 1, (d + i) % 2 ? POP_C.yellow : POP_C.cream);
          }
        }
      }
      spr(g, POP_SWORD, x + 2, y - 15 + up, POP_PAL_SWORD, false);
      if (p > 0.4 && Math.floor(t * 5) % 2) R(g, x + 4, y - 11 + Math.floor(t * 3) % 4, 1, 1, '#ffffff');
    } },

  tuberia: { name:'Por la tubería', dur:2.4,
    pose(p) {
      const d = 12;
      const lift = p < 0.35 ? -Math.round(d * p / 0.35) : p < 0.65 ? -d : -Math.round(d * (1 - p) / 0.35);
      return { lift };
    },
    draw(g, x, y, p, t) {
      spr(g, POP_PIPE_CAP, x - 2, y + 6, POP_PAL_PIPE, false);
      // burbujas al entrar y al salir
      if ((p > 0.2 && p < 0.45) || (p > 0.6 && p < 0.85)) {
        for (let i = 0; i < 3; i++) {
          const q = ((t * 1.5 + i / 3) % 1);
          const bx = x + 1 + (hash(i + 7) % 8), by = y + 5 - Math.round(q * 6);
          R(g, bx, by, 1, 1, i % 2 ? POP_C.greenL : '#ffffff');
        }
      }
      if (p >= 0.4 && p < 0.6) popText(g, '...', x + 2, y - 3, POP_C.greenL);
    } },

  seta: { name:'Seta de poder', dur:2.0,
    pose(p) {
      if (p < 0.45 || p > 0.85) return { lift: 0 };
      return { lift: Math.round(3 * Math.abs(Math.sin(((p - 0.45) / 0.4) * Math.PI * 2))) };
    },
    draw(g, x, y, p, t) {
      if (p < 0.4) {
        const sx = x + 12 - Math.round((p / 0.4) * 4);
        spr(g, POP_SHROOM, sx, y + 1, POP_PAL_SHROOM, false);
      } else if (p < 0.5) {
        const k = Math.floor(t * 12);
        R(g, x + 9 + (k % 2), y + 2, 1, 1, POP_C.red); R(g, x + 11, y + 4 + (k % 3), 1, 1, POP_C.white);
        R(g, x + 8, y + 6, 1, 1, POP_C.red);
      } else if (p < 0.85) {
        const k = Math.floor(t * 8);
        for (let i = 0; i < 3; i++) {
          const h = hash(k * 3 + i);
          const sx = x - 5 + (h % 20), sy = y - 12 + ((h >>> 5) % 14);
          popSparkle(g, sx, sy, (h >>> 9) % 2 ? POP_C.yellow : POP_C.white, false);
        }
      }
      if (p > 0.45 && p < 0.8) {
        const ty = y - 12 - Math.round(((p - 0.45) / 0.35) * 8);
        popText(g, 'YUM!', x - 2, ty, Math.floor(t * 6) % 2 ? POP_C.yellow : POP_C.cream);
      }
    } },

  fantasma: { name:'Fantasma comilón', dur:2.2,
    draw(g, x, y, p, t) {
      const gx = x - 10 + Math.round(p * 22);
      const gy = y - 13;
      for (let i = 0; i < 6; i++) {
        const dx = x - 6 + i * 4;
        if (gx + 4 > dx) continue;
        R(g, dx, y - 10, 2, 2, '#ffe9b0');
      }
      spr(g, POP_GHOST[Math.floor(t * 6) % 2], gx, gy, POP_PAL_GHOST, false);
    } },

  tetris: { name:'Línea completa', dur:2.4,
    draw(g, x, y, p, t) {
      const wx = x + 11, wy = y - 23; // interior 8×16 (4×8 celdas)
      const border = POP_C.greyD;
      R(g, x + 10, y - 23, 1, 16, border); R(g, x + 19, y - 23, 1, 16, border); R(g, x + 10, y - 7, 10, 1, border);
      const cell = (c, r, col, light) => popCell(g, wx + c * 2, wy + r * 2, col, light);
      const cleared = p >= 0.8;
      const flash = p >= 0.6 && p < 0.8;
      // pila existente
      const base = [[0, 7], [1, 7], [2, 7]];
      const upper = [[0, 6], [1, 6]];
      const drop = cleared ? 1 : 0;
      if (!cleared) for (const q of base) cell(q[0], q[1], flash && Math.floor(t * 10) % 2 ? '#ffffff' : POP_C.blue, flash ? '#ffffff' : POP_C.sky);
      for (const q of upper) cell(q[0], q[1] + drop, POP_C.magenta, POP_C.pink);
      // pieza I vertical cayendo por la columna 3
      let row;
      if (p < 0.6) row = Math.min(4, -1 + Math.floor((p / 0.6) * 6));
      else row = 4;
      for (let k = 0; k < 4; k++) {
        const r = row + k;
        if (cleared && r === 7) continue;
        const rr = r + (cleared ? 1 : 0);
        if (rr < -1 || rr > 7) continue;
        const col = (flash && r === 7 && Math.floor(t * 10) % 2) ? '#ffffff' : POP_C.cyan;
        cell(3, rr, col, POP_C.cyanL);
      }
      if (cleared) popText(g, '+100', x - 6, y - 20, Math.floor(t * 6) % 2 ? POP_C.yellow : POP_C.cream);
    } },

  invader: { name:'Alien abatido', dur:2.2,
    pose(p) { return { lift: (p > 0.6 && p < 0.72) ? 2 : 0 }; },
    draw(g, x, y, p, t) {
      const step = Math.floor(t * 3) % 2;
      if (p < 0.6) {
        const ax = x + (step ? 1 : -1);
        const ay = y - 26 + Math.round(8 * popClamp(p / 0.45, 0, 1));
        spr(g, POP_ALIEN[step], ax, ay, POP_PAL_ALIEN, false);
      }
      if (p >= 0.45 && p < 0.6) {
        const q = (p - 0.45) / 0.15;
        const sy = y - 1 - Math.round(9 * q);
        R(g, x + 5, sy, 1, 3, POP_C.yellow);
      }
      if (p >= 0.6 && p < 0.8) {
        const q = (p - 0.6) / 0.2;
        const rad = 1 + Math.round(q * 4);
        const cx = x + 5, cy = y - 14;
        const c = q < 0.5 ? POP_C.cream : POP_C.orange;
        R(g, cx - rad, cy, 1, 1, c); R(g, cx + rad, cy, 1, 1, c); R(g, cx, cy - rad, 1, 1, c); R(g, cx, cy + rad, 1, 1, c);
        const d = Math.max(1, rad - 1);
        R(g, cx - d, cy - d, 1, 1, c); R(g, cx + d, cy - d, 1, 1, c); R(g, cx - d, cy + d, 1, 1, c); R(g, cx + d, cy + d, 1, 1, c);
        if (q < 0.4) R(g, cx - 1, cy - 1, 3, 3, POP_C.yellow);
      }
      if (p >= 0.8) popText(g, '+50', x, y - 18, Math.floor(t * 6) % 2 ? POP_C.lime : '#ffffff');
    } },

  lvup: { name:'Subida de nivel', dur:2.0,
    pose(p) { return { lift: Math.round(4 * Math.abs(Math.sin(p * Math.PI * 2))) }; },
    draw(g, x, y, p, t) {
      const ty = y - 12 - Math.round(10 * popClamp(p / 0.6, 0, 1));
      const cols = [POP_C.yellow, '#ffffff', POP_C.lime];
      popText(g, 'LV UP', x - 4, ty, cols[Math.floor(t * 8) % 3]);
      if (p < 0.9) {
        const k = Math.floor(t * 4);
        for (let i = 0; i < 5; i++) {
          const h = hash(i * 17 + k);
          const sx = x - 7 + (h % 24), sy = y - 24 + ((h >>> 5) % 22);
          popSparkle(g, sx, sy, (h >>> 10) % 2 ? POP_C.yellow : POP_C.cream, (h >>> 12) % 3 === 0);
        }
      }
    } }
};
