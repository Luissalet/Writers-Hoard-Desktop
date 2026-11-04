import type { FigureImportError } from './index.ts';

/** Spanish text for every reason the figure parser and decoder can give, keyed by the English reason. */
const ES: Record<string, string> = {
  'Numbers must be finite.': 'Los números deben ser finitos.',
  'Use complete JSON values.': 'Usa valores JSON completos.',
  'Choose a JSON figure.': 'Elige una figura JSON.',
  'Use a complete, non-circular JSON figure.': 'Usa una figura JSON completa y sin referencias circulares.',
  'Choose a valid JSON figure.': 'Elige una figura JSON válida.',
  'The figure must be a JSON object.': 'La figura debe ser un objeto JSON.',
  'Expected vitruvius.figure/1.': 'Se esperaba vitruvius.figure/1.',
  'Expected the 12-character source document ID.': 'Se esperaba el identificador de 12 caracteres del documento de origen.',
  'Expected a positive integer source revision.': 'Se esperaba una revisión de origen entera y positiva.',
  'Expected a title string.': 'Se esperaba un título de texto.',
  'Retain the complete native diagram source.': 'Conserva la fuente nativa completa del diagrama.',
  'The captured page must exist in the retained source.': 'La página capturada debe existir en la fuente conservada.',
  'The captured state must exist in the retained isometric source, without a page selection.': 'El estado capturado debe existir en la fuente isométrica conservada, sin selección de página.',
  'Expected HTTP(S) origin links.': 'Se esperaban enlaces de origen HTTP(S).',
  'Expected an HTTP(S) link.': 'Se esperaba un enlace HTTP(S).',
  'Use HTTP(S) without credentials.': 'Usa HTTP(S) sin credenciales.',
  'Retain a base64 PNG capture.': 'Conserva una captura PNG en base64.',
  'Expected complete base64 PNG data.': 'Se esperaban datos PNG en base64 completos.',
  'Expected a PNG signature and complete IHDR.': 'Se esperaba una firma PNG y una cabecera IHDR completa.',
  'Expected the PNG IHDR header.': 'Se esperaba la cabecera PNG IHDR.',
  'PNG dimensions must be positive.': 'Las dimensiones del PNG deben ser positivas.',
  'PNG pixel decoding requires the browser renderer.': 'La decodificación de píxeles del PNG requiere el renderizador del navegador.',
  'Decoded PNG dimensions differ from the capture header.': 'Las dimensiones del PNG decodificado no coinciden con la cabecera de la captura.',
  'The PNG capture could not be decoded.': 'No se pudo decodificar la captura PNG.',
};

/** Message for the editor UI: Spanish when the interface is Spanish, otherwise the English parser message. */
export function figureErrorText(error: FigureImportError, es: boolean): string {
  if (!es) return error.message;
  const reason = ES[error.detail];
  return reason ? `${error.field}: ${reason}` : error.message;
}

export const FIGURE_ERROR_REASONS_ES = ES;
