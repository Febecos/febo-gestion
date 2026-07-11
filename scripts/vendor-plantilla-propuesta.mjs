// Vendoriza la PLANTILLA OFICIAL de propuesta comercial FV al repo como módulo TS.
// Fuente (mantenida por CÁLCULOS FV): FEBECOS-VENTAS/PROYECTOS/COTIZADOS/Edgardo Bouvier - FV Ongrid
// Salto/Edgardo Bouvier - Propuesta Solar FV.html. Re-correr cuando CÁLCULOS actualice la plantilla.
// Uso: node scripts/vendor-plantilla-propuesta.mjs
import fs from 'fs';

const SRC = 'D:/Dropbox/FEBECOS-VENTAS/PROYECTOS/COTIZADOS/Edgardo Bouvier - FV Ongrid Salto/Edgardo Bouvier - Propuesta Solar FV.html';
const OUT = 'src/lib/plantilla-propuesta-fv.ts';

const html = fs.readFileSync(SRC, 'utf8');
const out = [
  '// PLANTILLA OFICIAL de propuesta comercial FV — vendorizada TAL CUAL de la fuente de CÁLCULOS FV.',
  '// La salida C la puebla por REPLACES anclados (api/presentacion-fv-html) → el ESQUEMA queda idéntico.',
  '// Para actualizar: node scripts/vendor-plantilla-propuesta.mjs (relee la fuente en FEBECOS-VENTAS).',
  '// eslint-disable-next-line',
  'export const PLANTILLA_PROPUESTA_FV: string = ' + JSON.stringify(html) + ';',
  '',
].join('\n');
fs.writeFileSync(OUT, out, 'utf8');
console.log(`✅ plantilla vendorizada → ${OUT} (${(out.length / 1024).toFixed(0)} KB)`);
