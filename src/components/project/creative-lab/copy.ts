import type {
  CreativeGenerationContext,
  CreativeGenerationTemplates,
  CreativeMove,
  CreativeOperation,
  CreativeOperationIssue,
  CreativePossibilityStatus,
  CreativePromotionTarget,
  CreativeSourceKind,
} from './types';

export interface CreativeLabCopy {
  locale: string;
  sourceKinds: Record<CreativeSourceKind, string>;
  untitledSources: Record<CreativeSourceKind, string>;
  operations: Record<CreativeOperation, { label: string; hint: string }>;
  moves: Record<CreativeMove, string>;
  promotionTargets: Record<CreativePromotionTarget, string>;
  statuses: Record<CreativePossibilityStatus, string>;
  issues: Record<CreativeOperationIssue, string>;
  header: {
    title: string;
    description: string;
    countsLabel: string;
    activeCount: (count: number) => string;
    archivedCount: (count: number) => string;
    promotedCount: (count: number) => string;
  };
  sources: {
    title: string;
    description: string;
    selectedCount: (count: number) => string;
    searchLabel: string;
    searchPlaceholder: string;
    filterLabel: string;
    all: string;
    noMatchesTitle: string;
    noMatchesDescription: string;
    unused: string;
    open: (title: string) => string;
    selectedLabel: string;
    remove: (title: string) => string;
    removeHint: string;
  };
  composer: {
    title: string;
    description: string;
    offlineBadge: string;
    noSelection: string;
    operationLegend: string;
    combineInstruction: string;
    truthInstruction: string;
    optional: string;
    focusLabel: string;
    focusPlaceholder: string;
    removeLabel: string;
    removePlaceholder: string;
    scaleLabel: string;
    scalePlaceholder: string;
    placeLabel: string;
    placePlaceholder: string;
    eraLabel: string;
    eraPlaceholder: string;
    povLabel: string;
    povPlaceholder: string;
    costLabel: string;
    costPlaceholder: string;
    add: string;
    ready: string;
  };
  possibility: {
    from: string;
    compare: string;
    comparing: string;
    titleLabel: string;
    titlePlaceholder: string;
    textLabel: string;
    groupLabel: string;
    groupPlaceholder: string;
    archive: string;
    promotionDestination: string;
    promoting: string;
    promote: string;
    restore: string;
    promoted: (target: string, label?: string) => string;
    retryAfterFailure: string;
    promotionFailed: string;
  };
  deck: {
    title: string;
    description: string;
    move: string;
    lockMove: string;
    unlockMove: string;
    material: (index: number) => string;
    lockMaterial: (index: number) => string;
    unlockMaterial: (index: number) => string;
    missingMaterial: string;
    unused: string;
    used: (count: number) => string;
    reroll: string;
    send: string;
    needsSource: string;
    needsTwoSources: string;
    ready: (seed: number) => string;
  };
  comparison: {
    title: string;
    clear: string;
    chooseAnother: string;
  };
  workspace: {
    label: string;
    statusNavigationLabel: string;
    ungrouped: string;
    emptyTitles: Record<CreativePossibilityStatus, string>;
    emptyBodies: Record<CreativePossibilityStatus, string>;
  };
  generation: CreativeGenerationTemplates;
}

function joinFragments(fragments: readonly string[], conjunction: string): string {
  if (fragments.length <= 1) return fragments[0] ?? '';
  if (fragments.length === 2) return `${fragments[0]} ${conjunction} ${fragments[1]}`;
  return `${fragments.slice(0, -1).join(', ')}, ${conjunction} ${fragments.at(-1)}`;
}

function englishGeneration(): CreativeGenerationTemplates {
  const material = (context: CreativeGenerationContext) => joinFragments(context.sourceFragments, 'and');
  return {
    operations: {
      combine: context => `Treat ${material(context)} as parts of the same situation. What changes when one cannot exist without the other?`,
      invert: context => `Invert ${context.parameters.focus || material(context)}: assume its opposite is true. Which motive, consequence, or relationship becomes more interesting?`,
      remove: context => `Remove ${context.parameters.element} from ${material(context)}. What takes over its function, and what new pressure fills the gap?`,
      scale: context => `Change the scale of ${material(context)} to ${context.parameters.scale}. Which consequence becomes visible only at that scale?`,
      relocate: context => `Move ${material(context)} to ${[context.parameters.place, context.parameters.era].filter(Boolean).join(', ')}. What stops working there, and what becomes possible for the first time?`,
      pov: context => `Retell ${material(context)} from ${context.parameters.pointOfView}. What do they misunderstand, conceal, or notice before anyone else?`,
      cost: context => `Keep ${material(context)}, but make it cost ${context.parameters.cost}. Who accepts that price, and who refuses it?`,
      truth: context => `For ${material(context)} to be true, what else must already be true—and what evidence would reveal it?`,
    },
    deck: {
      combine: context => `Force ${material(context)} into one causal chain. What single event makes their connection unavoidable?`,
      remove: context => context.sourceFragments[1]
        ? `Remove ${context.sourceFragments[0]} from the world of ${context.sourceFragments[1]}. What inherits its unfinished work?`
        : `Remove ${material(context)}. What inherits its unfinished work?`,
      invert: context => context.sourceFragments[1]
        ? `Invert what ${context.sourceFragments[0]} seems to mean inside ${context.sourceFragments[1]}. What if the apparent warning is actually an invitation?`
        : `Invert what ${material(context)} seems to mean. What if the apparent warning is actually an invitation?`,
      'make-inevitable': context => context.sourceFragments[1]
        ? `Make ${context.sourceFragments[1]} the inevitable consequence of ${context.sourceFragments[0]}. Plant the earliest point where escape becomes impossible.`
        : `Make ${material(context)} inevitable. Plant the earliest point where escape becomes impossible.`,
      'change-who-pays': context => context.sourceFragments[1]
        ? `Let ${context.sourceFragments[0]} happen, but make ${context.sourceFragments[1]} pay for it. What debt now binds them?`
        : `Let ${material(context)} happen, but change who pays for it. What debt follows?`,
    },
  };
}

function spanishGeneration(): CreativeGenerationTemplates {
  const material = (context: CreativeGenerationContext) => joinFragments(context.sourceFragments, 'y');
  return {
    operations: {
      combine: context => `Trata ${material(context)} como partes de una misma situación. ¿Qué cambia cuando una no puede existir sin la otra?`,
      invert: context => `Invierte ${context.parameters.focus || material(context)}: da por cierto lo contrario. ¿Qué motivo, consecuencia o relación se vuelve más interesante?`,
      remove: context => `Quita ${context.parameters.element} de ${material(context)}. ¿Qué asume su función y qué presión nueva ocupa el vacío?`,
      scale: context => `Cambia la escala de ${material(context)} a ${context.parameters.scale}. ¿Qué consecuencia sólo resulta visible a esa escala?`,
      relocate: context => `Traslada ${material(context)} a ${[context.parameters.place, context.parameters.era].filter(Boolean).join(', ')}. ¿Qué deja de funcionar allí y qué se vuelve posible por primera vez?`,
      pov: context => `Cuenta ${material(context)} desde ${context.parameters.pointOfView}. ¿Qué malinterpreta, oculta o percibe antes que nadie?`,
      cost: context => `Conserva ${material(context)}, pero haz que cueste ${context.parameters.cost}. ¿Quién acepta ese precio y quién se niega?`,
      truth: context => `Para que ${material(context)} sea verdad, ¿qué más tendría que ser verdad y qué prueba lo revelaría?`,
    },
    deck: {
      combine: context => `Fuerza ${material(context)} a formar una sola cadena causal. ¿Qué acontecimiento vuelve inevitable su conexión?`,
      remove: context => context.sourceFragments[1]
        ? `Quita ${context.sourceFragments[0]} del mundo de ${context.sourceFragments[1]}. ¿Qué hereda su trabajo inconcluso?`
        : `Quita ${material(context)}. ¿Qué hereda su trabajo inconcluso?`,
      invert: context => context.sourceFragments[1]
        ? `Invierte lo que ${context.sourceFragments[0]} parece significar dentro de ${context.sourceFragments[1]}. ¿Y si la aparente advertencia fuera en realidad una invitación?`
        : `Invierte lo que ${material(context)} parece significar. ¿Y si la aparente advertencia fuera en realidad una invitación?`,
      'make-inevitable': context => context.sourceFragments[1]
        ? `Haz que ${context.sourceFragments[1]} sea la consecuencia inevitable de ${context.sourceFragments[0]}. Planta el primer punto en que escapar deja de ser posible.`
        : `Haz inevitable ${material(context)}. Planta el primer punto en que escapar deja de ser posible.`,
      'change-who-pays': context => context.sourceFragments[1]
        ? `Deja que ocurra ${context.sourceFragments[0]}, pero haz que ${context.sourceFragments[1]} pague por ello. ¿Qué deuda los une ahora?`
        : `Deja que ocurra ${material(context)}, pero cambia quién paga por ello. ¿Qué deuda queda?`,
    },
  };
}

const englishCopy: CreativeLabCopy = {
  locale: 'en',
  sourceKinds: { note: 'Notes', board: 'Board', codex: 'Codex', gallery: 'Gallery', seed: 'Seeds' },
  untitledSources: {
    note: 'Untitled note', board: 'Untitled board card', codex: 'Untitled Codex entry',
    gallery: 'Untitled image', seed: 'Untitled seed',
  },
  operations: {
    combine: { label: 'Combine', hint: 'Make two or more sources depend on each other.' },
    invert: { label: 'Invert', hint: 'Assume the premise or apparent meaning is false.' },
    remove: { label: 'Remove', hint: 'Take one element away and inspect the vacuum.' },
    scale: { label: 'Change scale', hint: 'Move the material from intimate to systemic, or back.' },
    relocate: { label: 'Place / era', hint: 'Move the material somewhere its assumptions break.' },
    pov: { label: 'Change POV', hint: 'Give the scene to a different witness or participant.' },
    cost: { label: 'Raise the cost', hint: 'Keep the outcome, but make its price consequential.' },
    truth: { label: 'What must be true?', hint: 'Expose the hidden conditions beneath the idea.' },
  },
  moves: {
    combine: 'Combine', invert: 'Invert', remove: 'Remove', scale: 'Change scale', relocate: 'Place / era',
    pov: 'Change POV', cost: 'Raise the cost', truth: 'What must be true?',
    'make-inevitable': 'Make inevitable', 'change-who-pays': 'Change who pays',
  },
  promotionTargets: {
    note: 'Note', board: 'Board card', codex: 'Codex entry', seed: 'Seed',
    outline: 'Outline beat', timeline: 'Timeline event',
  },
  statuses: { active: 'On the table', archived: 'Archive', promoted: 'Promoted' },
  issues: {
    'select-source': 'Select at least one source.',
    'select-two-sources': 'Combine needs at least two sources.',
    'missing-remove-element': 'Name the element to remove.',
    'missing-scale': 'Describe the new scale.',
    'missing-place-or-era': 'Add a place, an era, or both.',
    'missing-pov': 'Name the new point of view.',
    'missing-cost': 'Describe the price that rises.',
  },
  header: {
    title: 'Ideas table',
    description: 'Generate, compare, and discard routes before any of them become canon.',
    countsLabel: 'Possibility counts',
    activeCount: count => `${count} live`,
    archivedCount: count => `${count} archived`,
    promotedCount: count => `${count} canon`,
  },
  sources: {
    title: 'Source shelf', description: 'Choose live material. Nothing is copied or changed here.',
    selectedCount: count => `${count} selected`, searchLabel: 'Search sources',
    searchPlaceholder: 'Search title, text, or tag', filterLabel: 'Filter source type', all: 'All',
    noMatchesTitle: 'No source matches this view', noMatchesDescription: 'Clear the search or choose another source type.',
    unused: 'unused', open: title => `Open ${title}`, selectedLabel: 'Selected sources',
    remove: title => `Remove ${title} from the selection`, removeHint: 'click to remove',
  },
  composer: {
    title: 'Build a possibility', description: 'Start with a deliberate move. The result stays editable and non-canonical.',
    offlineBadge: 'deterministic · offline', noSelection: 'Select material from the source shelf to begin.',
    operationLegend: 'Creative operation', combineInstruction: 'Use every selected source in one causal proposition.',
    truthInstruction: 'Turn the selected material into a chain of hidden prerequisites.', optional: '(optional)',
    focusLabel: 'Focus to invert', focusPlaceholder: 'the promise, the alibi, the relationship…',
    removeLabel: 'Element to remove', removePlaceholder: 'the mentor, magic, a safe return…',
    scaleLabel: 'New scale', scalePlaceholder: 'one room, a city, three generations…',
    placeLabel: 'Place', placePlaceholder: 'an isolated station…', eraLabel: 'Era', eraPlaceholder: 'after the empire falls…',
    povLabel: 'New point of view', povPlaceholder: 'the witness who benefits…',
    costLabel: 'New price', costPlaceholder: "their reputation, a sibling's safety…",
    add: 'Add to table', ready: 'Ready to generate locally.',
  },
  possibility: {
    from: 'from', compare: 'Compare', comparing: 'Comparing', titleLabel: 'Working title',
    titlePlaceholder: 'Optional working title', textLabel: 'Possibility text', groupLabel: 'Group',
    groupPlaceholder: 'Unsorted', archive: 'Archive', promotionDestination: 'Promotion destination',
    promoting: 'Promoting…', promote: 'Promote', restore: 'Return to table',
    promoted: (target, label) => `Promoted to ${target}${label ? ` · ${label}` : ''}`,
    retryAfterFailure: 'Try again; the possibility is still on the table.', promotionFailed: 'Promotion failed.',
  },
  deck: {
    title: 'Constraint deck', description: 'Lock what matters. Reroll the rest toward less-used material.',
    move: 'Move', lockMove: 'Lock the constraint move', unlockMove: 'Unlock the constraint move',
    material: index => `Material ${index}`, lockMaterial: index => `Lock material ${index}`,
    unlockMaterial: index => `Unlock material ${index}`, missingMaterial: 'Add canonical material to fill this slot.',
    unused: 'not used yet', used: count => `used ${count}×`, reroll: 'Reroll unlocked cards',
    send: 'Send deal to the table', needsSource: 'The deck needs at least one source.',
    needsTwoSources: 'This move needs two source cards.', ready: seed => `Roll ${seed} · ready offline`,
  },
  comparison: {
    title: 'Comparison', clear: 'Clear',
    chooseAnother: 'Choose one more possibility. Selecting a third replaces the oldest selection.',
  },
  workspace: {
    label: 'Possibility workspace', statusNavigationLabel: 'Possibility status', ungrouped: 'Unsorted',
    emptyTitles: {
      active: 'The table is clear', archived: 'No archived possibilities', promoted: 'No promoted possibilities',
    },
    emptyBodies: {
      active: 'Select source material, choose a move, and add the first route.',
      archived: 'Possibilities appear here after you archive them.',
      promoted: 'Possibilities appear here after you promote them into canon.',
    },
  },
  generation: englishGeneration(),
};

const spanishCopy: CreativeLabCopy = {
  locale: 'es',
  sourceKinds: { note: 'Notas', board: 'Tablero', codex: 'Códice', gallery: 'Galería', seed: 'Semillas' },
  untitledSources: {
    note: 'Nota sin título', board: 'Tarjeta de tablero sin título', codex: 'Entrada de Códice sin título',
    gallery: 'Imagen sin título', seed: 'Semilla sin título',
  },
  operations: {
    combine: { label: 'Combinar', hint: 'Haz que dos o más fuentes dependan entre sí.' },
    invert: { label: 'Invertir', hint: 'Da por falsa la premisa o el significado aparente.' },
    remove: { label: 'Quitar', hint: 'Elimina un elemento y examina el vacío que deja.' },
    scale: { label: 'Cambiar escala', hint: 'Lleva el material de lo íntimo a lo sistémico, o al revés.' },
    relocate: { label: 'Lugar / época', hint: 'Traslada el material adonde se rompan sus supuestos.' },
    pov: { label: 'Cambiar POV', hint: 'Entrega la escena a otro testigo o participante.' },
    cost: { label: 'Subir el coste', hint: 'Conserva el resultado, pero dale un precio con consecuencias.' },
    truth: { label: '¿Qué tendría que ser verdad?', hint: 'Expón las condiciones ocultas bajo la idea.' },
  },
  moves: {
    combine: 'Combinar', invert: 'Invertir', remove: 'Quitar', scale: 'Cambiar escala', relocate: 'Lugar / época',
    pov: 'Cambiar POV', cost: 'Subir el coste', truth: '¿Qué tendría que ser verdad?',
    'make-inevitable': 'Hacer inevitable', 'change-who-pays': 'Cambiar quién paga',
  },
  promotionTargets: {
    note: 'Nota', board: 'Tarjeta de tablero', codex: 'Entrada de Códice', seed: 'Semilla',
    outline: 'Hito de esquema', timeline: 'Evento temporal',
  },
  statuses: { active: 'En la mesa', archived: 'Archivo', promoted: 'Promovidas' },
  issues: {
    'select-source': 'Selecciona al menos una fuente.',
    'select-two-sources': 'Combinar necesita al menos dos fuentes.',
    'missing-remove-element': 'Nombra el elemento que quieres quitar.',
    'missing-scale': 'Describe la nueva escala.',
    'missing-place-or-era': 'Añade un lugar, una época o ambos.',
    'missing-pov': 'Nombra el nuevo punto de vista.',
    'missing-cost': 'Describe el precio que aumenta.',
  },
  header: {
    title: 'Mesa de ideas',
    description: 'Genera, compara y descarta caminos antes de convertirlos en canon.',
    countsLabel: 'Recuento de posibilidades',
    activeCount: count => `${count} activas`,
    archivedCount: count => `${count} archivadas`,
    promotedCount: count => `${count} canónicas`,
  },
  sources: {
    title: 'Estante de fuentes', description: 'Elige material vivo. Aquí no se copia ni se modifica nada.',
    selectedCount: count => `${count} seleccionadas`, searchLabel: 'Buscar fuentes',
    searchPlaceholder: 'Buscar por título, texto o etiqueta', filterLabel: 'Filtrar tipo de fuente', all: 'Todo',
    noMatchesTitle: 'Ninguna fuente coincide con esta vista', noMatchesDescription: 'Limpia la búsqueda o elige otro tipo de fuente.',
    unused: 'sin usar', open: title => `Abrir ${title}`, selectedLabel: 'Fuentes seleccionadas',
    remove: title => `Quitar ${title} de la selección`, removeHint: 'clic para quitar',
  },
  composer: {
    title: 'Construye una posibilidad', description: 'Empieza con un movimiento deliberado. El resultado seguirá siendo editable y no canónico.',
    offlineBadge: 'determinista · sin conexión', noSelection: 'Selecciona material del estante de fuentes para empezar.',
    operationLegend: 'Operación creativa', combineInstruction: 'Usa todas las fuentes seleccionadas en una sola proposición causal.',
    truthInstruction: 'Convierte el material seleccionado en una cadena de condiciones ocultas.', optional: '(opcional)',
    focusLabel: 'Foco que invertir', focusPlaceholder: 'la promesa, la coartada, la relación…',
    removeLabel: 'Elemento que quitar', removePlaceholder: 'el mentor, la magia, un regreso seguro…',
    scaleLabel: 'Nueva escala', scalePlaceholder: 'una habitación, una ciudad, tres generaciones…',
    placeLabel: 'Lugar', placePlaceholder: 'una estación aislada…', eraLabel: 'Época', eraPlaceholder: 'después de la caída del imperio…',
    povLabel: 'Nuevo punto de vista', povPlaceholder: 'el testigo que sale beneficiado…',
    costLabel: 'Nuevo precio', costPlaceholder: 'su reputación, la seguridad de su hermana…',
    add: 'Añadir a la mesa', ready: 'Listo para generar en local.',
  },
  possibility: {
    from: 'desde', compare: 'Comparar', comparing: 'En comparación', titleLabel: 'Título de trabajo',
    titlePlaceholder: 'Título de trabajo opcional', textLabel: 'Texto de la posibilidad', groupLabel: 'Grupo',
    groupPlaceholder: 'Sin ordenar', archive: 'Archivar', promotionDestination: 'Destino de promoción',
    promoting: 'Promoviendo…', promote: 'Promover', restore: 'Devolver a la mesa',
    promoted: (target, label) => `Promovida a ${target}${label ? ` · ${label}` : ''}`,
    retryAfterFailure: 'Inténtalo de nuevo; la posibilidad sigue en la mesa.', promotionFailed: 'La promoción ha fallado.',
  },
  deck: {
    title: 'Baraja de restricciones', description: 'Bloquea lo importante. Baraja el resto hacia material menos usado.',
    move: 'Movimiento', lockMove: 'Bloquear el movimiento', unlockMove: 'Desbloquear el movimiento',
    material: index => `Material ${index}`, lockMaterial: index => `Bloquear material ${index}`,
    unlockMaterial: index => `Desbloquear material ${index}`, missingMaterial: 'Añade material canónico para llenar esta posición.',
    unused: 'aún sin usar', used: count => `usado ${count}×`, reroll: 'Barajar cartas desbloqueadas',
    send: 'Enviar jugada a la mesa', needsSource: 'La baraja necesita al menos una fuente.',
    needsTwoSources: 'Este movimiento necesita dos cartas de fuente.', ready: seed => `Tirada ${seed} · lista sin conexión`,
  },
  comparison: {
    title: 'Comparación', clear: 'Limpiar',
    chooseAnother: 'Elige otra posibilidad. Si seleccionas una tercera, sustituirá a la más antigua.',
  },
  workspace: {
    label: 'Espacio de posibilidades', statusNavigationLabel: 'Estado de las posibilidades', ungrouped: 'Sin ordenar',
    emptyTitles: {
      active: 'La mesa está despejada', archived: 'No hay posibilidades archivadas', promoted: 'No hay posibilidades promovidas',
    },
    emptyBodies: {
      active: 'Selecciona material, elige un movimiento y añade el primer camino.',
      archived: 'Las posibilidades aparecerán aquí cuando las archives.',
      promoted: 'Las posibilidades aparecerán aquí cuando las promociones a canon.',
    },
  },
  generation: spanishGeneration(),
};

export function getCreativeLabCopy(locale = 'en'): CreativeLabCopy {
  return locale.toLocaleLowerCase().startsWith('es') ? spanishCopy : englishCopy;
}
