const en = {
  preset: 'Start from a script', custom: 'Custom mapping', apply: 'Apply preset', runes: 'Runes · Elder Futhark',
  presetHelp: 'Editable visual substitutions for Latin letters, not linguistic transliteration. Applying a preset replaces the mapping below; it does not change saved words or native form overrides.',
  preview: 'Writing preview', sample: 'The silver forest', sampleLabel: 'Preview text',
  font: 'Local script font', upload: 'Choose font', remove: 'Remove font',
  fontHelp: 'TTF, OTF, WOFF or WOFF2 · up to 512 KiB. Stored with this language and its exports. Applies to native forms and previews.',
  fontError: 'This font could not be read. Choose a valid font under 512 KiB. The previous font is preserved.',
  fontLoadError: 'The saved font could not be loaded. Native forms use the system font.', loading: 'Checking font…',
};
const es: typeof en = {
  preset: 'Partir de una escritura', custom: 'Correspondencias propias', apply: 'Aplicar alfabeto', runes: 'Runas · Futhark antiguo',
  presetHelp: 'Sustituciones visuales editables de letras latinas, sin transliteración lingüística. Aplicar un alfabeto sustituye las correspondencias de abajo; conserva las palabras guardadas y sus formas nativas personalizadas.',
  preview: 'Vista previa de escritura', sample: 'El bosque de plata', sampleLabel: 'Texto de prueba',
  font: 'Fuente local para la escritura', upload: 'Elegir fuente', remove: 'Quitar fuente',
  fontHelp: 'TTF, OTF, WOFF o WOFF2 · hasta 512 KiB. Se guarda con el idioma y sus exportaciones. Se aplica a las formas nativas y vistas previas.',
  fontError: 'No se ha podido leer esta fuente. Elige una fuente válida de menos de 512 KiB. Se conserva la fuente anterior.',
  fontLoadError: 'No se ha podido cargar la fuente guardada. Las formas nativas usan la fuente del sistema.', loading: 'Comprobando fuente…',
};
export const scriptCopy = { en, es };
