// Words for the prep blocks (check, encounter, player handout), in both languages.
import type { HandoutTemplate } from '@/engines/prepBlocks/handouts';

export const SKILLS = {
  es: ['Acrobacias', 'Trato con animales', 'Arcanos', 'Atletismo', 'Engaño', 'Historia', 'Perspicacia', 'Intimidación', 'Investigación', 'Medicina', 'Naturaleza', 'Percepción', 'Interpretación', 'Persuasión', 'Religión', 'Juego de manos', 'Sigilo', 'Supervivencia', 'Fuerza', 'Destreza', 'Constitución', 'Inteligencia', 'Sabiduría', 'Carisma'],
  en: ['Acrobatics', 'Animal Handling', 'Arcana', 'Athletics', 'Deception', 'History', 'Insight', 'Intimidation', 'Investigation', 'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion', 'Sleight of Hand', 'Stealth', 'Survival', 'Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'],
} as const;

export const prepCopy = {
  es: {
    check: 'Prueba', skill: 'Habilidad o característica', dc: 'CD', bonus: 'Modificador', mode: 'Tirada', normal: 'Normal', advantage: 'Con ventaja', disadvantage: 'Con desventaja', note: 'Qué revela o qué pasa', roll: 'Tirar', rollAgain: 'Tirar otra vez', clear: 'Borrar tirada', notRolled: 'Sin tirar', passed: 'Superada', failed: 'Fallada',
    encounter: 'Encuentro', encounterTitle: 'Nombre del encuentro', creature: 'Criatura o personaje', count: 'Cantidad', addRow: 'Añadir criatura', removeRow: 'Quitar', pasteList: 'Pegar una lista', pasteHint: 'Una criatura por línea: «2x Goblin», «1x Jefe goblin»', pasteApply: 'Usar esta lista', link: 'Vincular', unlink: 'Quitar vínculo', linkSearch: 'Buscar criatura del compendio o ficha del Códice', monsterGroup: 'Compendio', cardGroup: 'Códice', noResults: 'Sin resultados',
    prepare: 'Preparar combate', prepareAnother: 'Preparar otro', open: 'Abrir combate', prepared: 'Combate «{title}» preparado con {n} combatientes.', unlinked: 'Sin vínculo (valores por defecto): {names}.', needRows: 'Añade al menos una criatura.', needProject: 'Esto solo se puede preparar dentro de un proyecto.', failed2: 'No se pudo preparar el combate.', combatTitle: 'Combate', existing: 'Combate preparado',
    handout: 'Material para jugadores', handoutLabel: 'Qué es', handoutWhen: 'Cuándo se entrega', pickImage: 'Imagen de la galería', noImage: 'Sin imagen elegida', chooseImage: 'Elegir imagen', fromTemplate: 'Crear desde una plantilla', editHandout: 'Editar el texto', missingImage: 'La imagen ya no está en la galería.', galleryEmpty: 'La galería de este proyecto no tiene imágenes todavía.',
    studio: 'Plantillas de material', template: 'Plantilla', hook: 'Empezar desde un gancho', hookNone: 'Sin gancho', title: 'Título', body: 'Texto', signature: 'Firma', extra: 'Línea extra', preview: 'Vista previa', save: 'Guardar en la galería y usar', saveEdit: 'Guardar cambios', close: 'Cerrar', saved: 'Guardado en la galería.', saveFailed: 'No se pudo guardar el material.', empty: 'Escribe un título o un texto.', hiddenWiki: 'Oculto en la wiki',
  },
  en: {
    check: 'Check', skill: 'Skill or ability', dc: 'DC', bonus: 'Modifier', mode: 'Roll', normal: 'Normal', advantage: 'Advantage', disadvantage: 'Disadvantage', note: 'What it reveals or what happens', roll: 'Roll', rollAgain: 'Roll again', clear: 'Clear roll', notRolled: 'Not rolled', passed: 'Passed', failed: 'Failed',
    encounter: 'Encounter', encounterTitle: 'Encounter name', creature: 'Creature or character', count: 'Count', addRow: 'Add creature', removeRow: 'Remove', pasteList: 'Paste a list', pasteHint: 'One creature per line: "2x Goblin", "1x Goblin Boss"', pasteApply: 'Use this list', link: 'Link', unlink: 'Remove link', linkSearch: 'Search a compendium creature or a Codex card', monsterGroup: 'Compendium', cardGroup: 'Codex', noResults: 'No results',
    prepare: 'Prepare combat', prepareAnother: 'Prepare another', open: 'Open combat', prepared: 'Combat "{title}" prepared with {n} combatants.', unlinked: 'Not linked (default values): {names}.', needRows: 'Add at least one creature.', needProject: 'This can only be prepared inside a project.', failed2: 'The combat could not be prepared.', combatTitle: 'Combat', existing: 'Combat prepared',
    handout: 'Player handout', handoutLabel: 'What it is', handoutWhen: 'When to hand it out', pickImage: 'Gallery image', noImage: 'No image chosen', chooseImage: 'Choose image', fromTemplate: 'Create from a template', editHandout: 'Edit the text', missingImage: 'The image is no longer in the gallery.', galleryEmpty: 'This project\'s gallery has no images yet.',
    studio: 'Handout templates', template: 'Template', hook: 'Start from a hook', hookNone: 'No hook', title: 'Title', body: 'Text', signature: 'Signature', extra: 'Extra line', preview: 'Preview', save: 'Save to the gallery and use', saveEdit: 'Save changes', close: 'Close', saved: 'Saved to the gallery.', saveFailed: 'The handout could not be saved.', empty: 'Write a title or some text.', hiddenWiki: 'Hidden from the wiki',
  },
} as const;
export type PrepCopy = typeof prepCopy['es'] | typeof prepCopy['en'];
export type { HandoutTemplate };
