import type { NarrativeRhythmUnit, NarrativeThreadOrigin, NarrativeXrayLocale } from '@/services/narrativeXray';

export type NarrativeXrayView = 'voice' | 'rhythm' | 'energy' | 'threads';

export interface NarrativeXrayCopy {
  locale: NarrativeXrayLocale;
  title: string;
  description: string;
  measurementNotice: string;
  navigationLabel: string;
  views: Record<NarrativeXrayView, string>;
  sourceLabels: Record<NarrativeRhythmUnit['source'], string>;
  threadOrigins: Record<NarrativeThreadOrigin, string>;
  coverage: {
    label: string;
    writings: (count: number) => string;
    scenes: (count: number) => string;
    beats: (count: number) => string;
    annotations: (count: number) => string;
  };
  common: {
    words: string;
    sentences: string;
    paragraphs: string;
    averageSentence: string;
    medianSentence: string;
    averageParagraph: string;
    questions: string;
    exclamations: string;
    shortSentences: string;
    lines: string;
    occurrences: (count: number) => string;
    perHundredWords: (value: number) => string;
    percent: (value: number) => string;
    openEvidence: (title: string) => string;
    noText: string;
  };
  voice: {
    title: string;
    description: string;
    proseTitle: string;
    proseDescription: string;
    charactersTitle: string;
    charactersDescription: string;
    firstPerson: string;
    secondPerson: string;
    thirdPerson: string;
    markersPerThousand: string;
    recurringTerms: string;
    noRecurringTerms: string;
    emptyProse: string;
    emptyCharacters: string;
  };
  rhythm: {
    title: string;
    description: string;
    readingTitle: string;
    readingDescription: string;
    creationTitle: string;
    creationDescription: string;
    annotations: (count: number) => string;
    plannedWords: (count: number) => string;
    dialogBlocks: (count: number) => string;
    actionBlocks: (count: number) => string;
    sessions: (count: number) => string;
    minutes: (count: number) => string;
    sessionTypes: string;
    emptyNarrative: string;
    emptyCreation: string;
  };
  energy: {
    title: string;
    description: string;
    shortSentences: string;
    questions: string;
    exclamations: string;
    dialogShare: string;
    actionShare: string;
    markerScale: string;
    empty: string;
  };
  threads: {
    title: string;
    description: string;
    evidenceCount: (count: number) => string;
    entityCount: (count: number) => string;
    empty: string;
    emptyHint: string;
  };
}

const es: NarrativeXrayCopy = {
  locale: 'es',
  title: 'Radiografía narrativa',
  description: 'Lee la forma visible del proyecto: cómo respira el texto, dónde cambia su pulso y qué hilos has declarado.',
  measurementNotice: 'Describe señales contables; no puntúa la calidad ni interpreta el significado.',
  navigationLabel: 'Vistas de la radiografía',
  views: { voice: 'Voz', rhythm: 'Ritmo', energy: 'Energía', threads: 'Hilos' },
  sourceLabels: { writing: 'Escrito', scene: 'Escena', 'outline-beat': 'Beat' },
  threadOrigins: { tag: 'Etiqueta', 'entity-link': 'Enlace explícito' },
  coverage: {
    label: 'Material leído',
    writings: count => `${count} escritos`,
    scenes: count => `${count} escenas`,
    beats: count => `${count} beats`,
    annotations: count => `${count} anotaciones`,
  },
  common: {
    words: 'Palabras', sentences: 'Frases', paragraphs: 'Párrafos', averageSentence: 'Media por frase',
    medianSentence: 'Mediana por frase', averageParagraph: 'Media por párrafo', questions: 'Preguntas',
    exclamations: 'Exclamaciones', shortSentences: 'Frases breves', lines: 'Intervenciones',
    occurrences: count => `${count} apariciones`, perHundredWords: value => `${value} por 100 palabras`,
    percent: value => `${value} %`, openEvidence: title => `Abrir evidencia: ${title}`, noText: 'Sin texto medible',
  },
  voice: {
    title: 'Huellas de voz',
    description: 'Longitud, referencias gramaticales y términos repetidos. Las referencias no determinan por sí solas el punto de vista.',
    proseTitle: 'Prosa', proseDescription: 'Una lectura por escrito, respetando el orden de capítulos.',
    charactersTitle: 'Diálogo por personaje', charactersDescription: 'Solo bloques marcados explícitamente como diálogo.',
    firstPerson: '1.ª persona', secondPerson: '2.ª persona', thirdPerson: '3.ª persona',
    markersPerThousand: 'Marcadores por 1.000 palabras', recurringTerms: 'Términos repetidos',
    noRecurringTerms: 'No hay términos repetidos suficientes.', emptyProse: 'Todavía no hay prosa que medir.',
    emptyCharacters: 'Todavía no hay bloques de diálogo con personaje.',
  },
  rhythm: {
    title: 'Ritmo', description: 'Separa el ritmo que queda en la página del ritmo con el que se creó.',
    readingTitle: 'Ritmo de lectura', readingDescription: 'Unidades canónicas en su orden propio; no mezcla capítulo, escena y beat en una cronología inventada.',
    creationTitle: 'Ritmo de trabajo', creationDescription: 'Sesiones registradas por día, sin atribuirlas a un capítulo cuando el dato no existe.',
    annotations: count => `${count} anotaciones`, plannedWords: count => `Objetivo: ${count} palabras`,
    dialogBlocks: count => `${count} bloques de diálogo`, actionBlocks: count => `${count} bloques de acción`,
    sessions: count => `${count} sesiones`, minutes: count => `${count} min`, sessionTypes: 'Tipos',
    emptyNarrative: 'No hay escritos, escenas ni beats con los que dibujar el ritmo.',
    emptyCreation: 'No hay sesiones de escritura registradas.',
  },
  energy: {
    title: 'Energía superficial',
    description: 'Capas independientes de señales visibles. No se suman en una puntuación ni afirman que una escena sea intensa.',
    shortSentences: 'Frases breves', questions: 'Preguntas', exclamations: 'Exclamaciones',
    dialogShare: 'Diálogo explícito', actionShare: 'Acción explícita', markerScale: 'Densidad relativa dentro de esta vista',
    empty: 'No hay texto medible para mostrar estas señales.',
  },
  threads: {
    title: 'Hilos declarados', description: 'Solo etiquetas y relaciones que ya existen. La radiografía no deduce temas a partir del vocabulario.',
    evidenceCount: count => `${count} evidencias`, entityCount: count => `${count} entidades`,
    empty: 'Todavía no hay hilos explícitos.', emptyHint: 'Añade una etiqueta a un escrito o escena, o enlaza dos entidades para que aparezcan aquí.',
  },
};

const en: NarrativeXrayCopy = {
  locale: 'en',
  title: 'Narrative X-ray',
  description: 'Read the project’s visible shape: how the text breathes, where its pulse changes, and which threads you declared.',
  measurementNotice: 'It describes countable signals; it does not score quality or interpret meaning.',
  navigationLabel: 'Narrative X-ray views',
  views: { voice: 'Voice', rhythm: 'Rhythm', energy: 'Energy', threads: 'Threads' },
  sourceLabels: { writing: 'Writing', scene: 'Scene', 'outline-beat': 'Beat' },
  threadOrigins: { tag: 'Tag', 'entity-link': 'Explicit link' },
  coverage: {
    label: 'Material read', writings: count => `${count} writings`, scenes: count => `${count} scenes`,
    beats: count => `${count} beats`, annotations: count => `${count} annotations`,
  },
  common: {
    words: 'Words', sentences: 'Sentences', paragraphs: 'Paragraphs', averageSentence: 'Average per sentence',
    medianSentence: 'Median per sentence', averageParagraph: 'Average per paragraph', questions: 'Questions',
    exclamations: 'Exclamations', shortSentences: 'Short sentences', lines: 'Lines',
    occurrences: count => `${count} occurrences`, perHundredWords: value => `${value} per 100 words`,
    percent: value => `${value}%`, openEvidence: title => `Open evidence: ${title}`, noText: 'No measurable text',
  },
  voice: {
    title: 'Voice traces',
    description: 'Length, grammatical references, and repeated terms. Reference markers alone do not establish point of view.',
    proseTitle: 'Prose', proseDescription: 'One reading per writing, in chapter order.',
    charactersTitle: 'Dialogue by character', charactersDescription: 'Only blocks explicitly marked as dialogue.',
    firstPerson: 'First person', secondPerson: 'Second person', thirdPerson: 'Third person',
    markersPerThousand: 'Markers per 1,000 words', recurringTerms: 'Repeated terms',
    noRecurringTerms: 'There are not enough repeated terms.', emptyProse: 'There is no prose to measure yet.',
    emptyCharacters: 'There are no character dialogue blocks yet.',
  },
  rhythm: {
    title: 'Rhythm', description: 'Separates the rhythm left on the page from the rhythm of its creation.',
    readingTitle: 'Reading rhythm', readingDescription: 'Canonical units in their own order; chapters, scenes, and beats are not merged into an invented chronology.',
    creationTitle: 'Creation rhythm', creationDescription: 'Recorded sessions by day, without assigning them to a chapter when that data does not exist.',
    annotations: count => `${count} annotations`, plannedWords: count => `Target: ${count} words`,
    dialogBlocks: count => `${count} dialogue blocks`, actionBlocks: count => `${count} action blocks`,
    sessions: count => `${count} sessions`, minutes: count => `${count} min`, sessionTypes: 'Types',
    emptyNarrative: 'There are no writings, scenes, or beats to chart.', emptyCreation: 'There are no recorded writing sessions.',
  },
  energy: {
    title: 'Surface energy',
    description: 'Independent layers of visible signals. They are not combined into a score and do not claim a scene is intense.',
    shortSentences: 'Short sentences', questions: 'Questions', exclamations: 'Exclamations',
    dialogShare: 'Explicit dialogue', actionShare: 'Explicit action', markerScale: 'Relative density within this view',
    empty: 'There is no measurable text for these signals.',
  },
  threads: {
    title: 'Declared threads', description: 'Only existing tags and relations. The X-ray does not infer themes from vocabulary.',
    evidenceCount: count => `${count} evidence items`, entityCount: count => `${count} entities`,
    empty: 'There are no explicit threads yet.', emptyHint: 'Tag a writing or scene, or link two entities, to make a thread appear here.',
  },
};

export function narrativeXrayCopy(locale: string | undefined): NarrativeXrayCopy {
  return locale?.toLowerCase().startsWith('en') ? en : es;
}
