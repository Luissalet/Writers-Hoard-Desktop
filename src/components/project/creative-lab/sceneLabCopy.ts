import type { SceneVariable } from '@/services/sceneLab';

export interface SceneLabCopy {
  variables: Record<SceneVariable, { label: string; placeholder: string }>;
  header: { title: string; description: string; sessionBadge: string };
  source: {
    label: string;
    empty: string;
    original: string;
    originalHint: string;
  };
  creator: {
    title: string;
    description: string;
    variable: string;
    change: string;
    changeHint: string;
    variantTitle: string;
    variantTitlePlaceholder: string;
    create: string;
    missingChange: string;
  };
  variants: {
    title: string;
    count: (count: number) => string;
    emptyTitle: string;
    emptyBody: string;
    select: (title: string) => string;
    compare: string;
    comparing: string;
    remove: (title: string) => string;
    promoted: (label?: string) => string;
  };
  editor: {
    title: string;
    sessionOnly: string;
    name: string;
    intention: string;
    intentionPlaceholder: string;
    tension: string;
    tensionValue: (value: number) => string;
    voice: string;
    voicePlaceholder: string;
    text: string;
    textPlaceholder: string;
    readOnly: string;
  };
  comparison: {
    title: string;
    description: string;
    clear: string;
    choose: string;
    baseline: string;
    intention: string;
    tension: string;
    voice: string;
    text: string;
    declaredChange: string;
    /** Screen-reader header of the row-label column. */
    field: string;
  };
  promotion: {
    title: string;
    description: string;
    noTargets: string;
    target: string;
    targetKinds: Record<'outline-beat' | 'timeline-event', string>;
    structuralTitle: string;
    structuralDescription: string;
    structuralDescriptionPlaceholder: string;
    review: string;
    previewTitle: string;
    previewDescription: string;
    before: string;
    after: string;
    unchanged: string;
    changedFields: (fields: string) => string;
    provenance: string;
    provenanceValue: (scene: string, variable: string, value: string) => string;
    cancel: string;
    confirm: string;
    confirming: string;
    noChange: string;
    failed: string;
  };
}

const englishCopy: SceneLabCopy = {
  variables: {
    pov: { label: 'Point of view', placeholder: 'The witness who benefits from the lie' },
    objective: { label: 'Objective', placeholder: 'Leave without revealing the key' },
    location: { label: 'Location', placeholder: 'A crowded station during a blackout' },
    'entry-order': { label: 'Entry order', placeholder: 'The antagonist arrives before the witness' },
    information: { label: 'Information', placeholder: 'The audience knows the door is trapped' },
    cost: { label: 'Cost', placeholder: 'Winning exposes the protagonist’s betrayal' },
    outcome: { label: 'Outcome', placeholder: 'The apparent loser gets what they needed' },
    tone: { label: 'Tone', placeholder: 'Polite on the surface, quietly threatening' },
  },
  header: {
    title: 'Scene laboratory',
    description: 'Change one condition, write the consequence, and compare the scene before it touches structure.',
    sessionBadge: 'local session · canon untouched',
  },
  source: {
    label: 'Source scene',
    empty: 'Add a scene to this project before opening the laboratory.',
    original: 'Original',
    originalHint: 'Read-only baseline',
  },
  creator: {
    title: 'Declare the experiment',
    description: 'Hold everything else steady. Name the single variable this version tests.',
    variable: 'Variable',
    change: 'What changes?',
    changeHint: 'Be concrete enough that two versions could disagree.',
    variantTitle: 'Working title',
    variantTitlePlaceholder: 'Optional; generated from the change if blank',
    create: 'Create local variant',
    missingChange: 'Describe the change before creating a variant.',
  },
  variants: {
    title: 'Local variants',
    count: count => `${count} ${count === 1 ? 'variant' : 'variants'}`,
    emptyTitle: 'No alternate take yet',
    emptyBody: 'Declare one variable. The new take begins as an editable copy of the original.',
    select: title => `Edit ${title}`,
    compare: 'Compare',
    comparing: 'Comparing',
    remove: title => `Remove ${title} from this session`,
    promoted: label => `Staged as branch${label ? ` · ${label}` : ''}`,
  },
  editor: {
    title: 'Work the take',
    sessionOnly: 'Edits stay in this session until you stage a structural branch.',
    name: 'Variant title',
    intention: 'Intention',
    intentionPlaceholder: 'What must this scene accomplish?',
    tension: 'Tension',
    tensionValue: value => `${value} out of 10`,
    voice: 'Voice',
    voicePlaceholder: 'Whose language and rhythm dominate?',
    text: 'Scene text',
    textPlaceholder: 'Write the alternate take here…',
    readOnly: 'This variant was already staged and is now read-only.',
  },
  comparison: {
    title: 'Comparison desk',
    description: 'Read the same four questions across both takes; length alone is not a verdict.',
    clear: 'Clear comparison',
    choose: 'Mark a variant for comparison. One selection compares against the original; two compare with each other.',
    baseline: 'Original scene',
    intention: 'Intention',
    tension: 'Tension',
    voice: 'Voice',
    text: 'Text',
    declaredChange: 'Declared change',
    field: 'Field',
  },
  promotion: {
    title: 'Stage in an existing branch',
    description: 'Only the title and structural summary leave the lab. Scene prose remains local.',
    noTargets: 'Link this scene to an outline beat or timeline event to stage a branch.',
    target: 'Structural anchor',
    targetKinds: { 'outline-beat': 'Outline beat', 'timeline-event': 'Timeline event' },
    structuralTitle: 'Proposed structural title',
    structuralDescription: 'Proposed structural summary',
    structuralDescriptionPlaceholder: 'Describe what changes in the story structure, not the full scene text.',
    review: 'Review structural delta',
    previewTitle: 'Branch preview',
    previewDescription: 'This callback stages an alternative in the branch kernel; it does not promote that branch to canon.',
    before: 'Current structure',
    after: 'Proposed branch',
    unchanged: 'No structural change',
    changedFields: fields => `Changes: ${fields}`,
    provenance: 'Provenance',
    provenanceValue: (scene, variable, value) => `${scene} · ${variable}: ${value}`,
    cancel: 'Keep editing',
    confirm: 'Stage branch',
    confirming: 'Staging…',
    noChange: 'Change the structural title or summary before staging.',
    failed: 'The branch could not be staged. The local variant is still here.',
  },
};

const spanishCopy: SceneLabCopy = {
  variables: {
    pov: { label: 'Punto de vista', placeholder: 'El testigo que se beneficia de la mentira' },
    objective: { label: 'Objetivo', placeholder: 'Salir sin revelar la llave' },
    location: { label: 'Lugar', placeholder: 'Una estación abarrotada durante un apagón' },
    'entry-order': { label: 'Orden de entrada', placeholder: 'El antagonista llega antes que el testigo' },
    information: { label: 'Información', placeholder: 'El público sabe que la puerta tiene una trampa' },
    cost: { label: 'Coste', placeholder: 'Ganar revela la traición de la protagonista' },
    outcome: { label: 'Resultado', placeholder: 'Quien parece perder consigue lo que necesitaba' },
    tone: { label: 'Tono', placeholder: 'Cortés en la superficie, amenazante por debajo' },
  },
  header: {
    title: 'Laboratorio de escenas',
    description: 'Cambia una condición, escribe la consecuencia y compara la escena antes de tocar la estructura.',
    sessionBadge: 'sesión local · canon intacto',
  },
  source: {
    label: 'Escena de origen',
    empty: 'Añade una escena al proyecto antes de abrir el laboratorio.',
    original: 'Original',
    originalHint: 'Base de lectura, no editable',
  },
  creator: {
    title: 'Declara el experimento',
    description: 'Mantén lo demás estable. Nombra la única variable que pone a prueba esta versión.',
    variable: 'Variable',
    change: '¿Qué cambia?',
    changeHint: 'Sé lo bastante concreto para que dos versiones puedan contradecirse.',
    variantTitle: 'Título de trabajo',
    variantTitlePlaceholder: 'Opcional; se genera desde el cambio si lo dejas en blanco',
    create: 'Crear variante local',
    missingChange: 'Describe el cambio antes de crear la variante.',
  },
  variants: {
    title: 'Variantes locales',
    count: count => `${count} ${count === 1 ? 'variante' : 'variantes'}`,
    emptyTitle: 'Aún no hay otra toma',
    emptyBody: 'Declara una variable. La nueva toma empieza como copia editable del original.',
    select: title => `Editar ${title}`,
    compare: 'Comparar',
    comparing: 'Comparando',
    remove: title => `Quitar ${title} de esta sesión`,
    promoted: label => `Preparada como rama${label ? ` · ${label}` : ''}`,
  },
  editor: {
    title: 'Trabaja la toma',
    sessionOnly: 'Los cambios siguen en esta sesión hasta que prepares una rama estructural.',
    name: 'Título de la variante',
    intention: 'Intención',
    intentionPlaceholder: '¿Qué debe conseguir esta escena?',
    tension: 'Tensión',
    tensionValue: value => `${value} de 10`,
    voice: 'Voz',
    voicePlaceholder: '¿Qué lenguaje y ritmo dominan?',
    text: 'Texto de la escena',
    textPlaceholder: 'Escribe aquí la toma alternativa…',
    readOnly: 'Esta variante ya se preparó y ahora es de solo lectura.',
  },
  comparison: {
    title: 'Mesa de comparación',
    description: 'Lee las mismas cuatro preguntas en ambas tomas; la longitud no decide por sí sola.',
    clear: 'Limpiar comparación',
    choose: 'Marca una variante. Una se compara con el original; dos se comparan entre sí.',
    baseline: 'Escena original',
    intention: 'Intención',
    tension: 'Tensión',
    voice: 'Voz',
    text: 'Texto',
    declaredChange: 'Cambio declarado',
    field: 'Campo',
  },
  promotion: {
    title: 'Preparar en una rama existente',
    description: 'Sólo salen del laboratorio el título y el resumen estructural. La prosa sigue en local.',
    noTargets: 'Vincula esta escena a un beat o evento para poder preparar una rama.',
    target: 'Ancla estructural',
    targetKinds: { 'outline-beat': 'Beat de escaleta', 'timeline-event': 'Evento de cronología' },
    structuralTitle: 'Título estructural propuesto',
    structuralDescription: 'Resumen estructural propuesto',
    structuralDescriptionPlaceholder: 'Describe qué cambia en la historia, no el texto completo de la escena.',
    review: 'Revisar delta estructural',
    previewTitle: 'Vista previa de la rama',
    previewDescription: 'El callback prepara una alternativa en el kernel de ramas; no la convierte en canon.',
    before: 'Estructura actual',
    after: 'Rama propuesta',
    unchanged: 'Sin cambio estructural',
    changedFields: fields => `Cambia: ${fields}`,
    provenance: 'Procedencia',
    provenanceValue: (scene, variable, value) => `${scene} · ${variable}: ${value}`,
    cancel: 'Seguir editando',
    confirm: 'Preparar rama',
    confirming: 'Preparando…',
    noChange: 'Cambia el título o el resumen estructural antes de preparar la rama.',
    failed: 'No se pudo preparar la rama. La variante local sigue aquí.',
  },
};

export function getSceneLabCopy(locale = 'en'): SceneLabCopy {
  return locale.toLocaleLowerCase().startsWith('es') ? spanishCopy : englishCopy;
}
