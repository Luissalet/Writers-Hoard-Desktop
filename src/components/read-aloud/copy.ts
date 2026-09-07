import type { ReadAloudLocale } from '@/services/readAloud';

export interface ReadAloudCopy {
  readAloudTitle: string;
  tableReadTitle: string;
  play: string;
  pause: string;
  resume: string;
  stop: string;
  previous: string;
  next: string;
  speed: string;
  segmentation: string;
  sentence: string;
  block: string;
  transcript: string;
  voices: string;
  voicesHint: string;
  systemDefaultVoice: string;
  noVoices: string;
  unsupported: string;
  noBoundary: string;
  empty: string;
  createNote: string;
  noteCreated: string;
  noteFailed: string;
  jumpToSource: string;
  sourceOpened: string;
  sourceFailed: string;
  keyboardHelp: string;
  stateCurrent: string;
  stateDone: string;
  stateQueued: string;
  stateStopped: string;
  statePaused: string;
  stateFinished: string;
  stateError: string;
  kindProse: string;
  kindDialogue: string;
  kindStageDirection: string;
  kindAction: string;
  kindTransition: string;
  kindNote: string;
  kindSlug: string;
  segmentOf: string;
}

const COPY: Record<ReadAloudLocale, ReadAloudCopy> = {
  es: {
    readAloudTitle: 'Lectura cr\u00edtica en voz alta',
    tableReadTitle: 'Lectura de mesa',
    play: 'Reproducir',
    pause: 'Pausar',
    resume: 'Reanudar',
    stop: 'Detener',
    previous: 'Anterior',
    next: 'Siguiente',
    speed: 'Velocidad',
    segmentation: 'Unidad de lectura',
    sentence: 'Oraci\u00f3n',
    block: 'Bloque',
    transcript: 'Texto de lectura',
    voices: 'Reparto de voces',
    voicesHint: 'Las voces disponibles dependen del sistema y del navegador.',
    systemDefaultVoice: 'Voz predeterminada del sistema',
    noVoices: 'El sistema no ha publicado voces disponibles.',
    unsupported: 'Este dispositivo no ofrece lectura en voz alta mediante Web Speech. Puedes recorrer el texto y crear notas manualmente.',
    noBoundary: 'No hay seguimiento palabra a palabra; se resaltar\u00e1 la unidad que est\u00e9 sonando.',
    empty: 'No hay texto legible en esta selecci\u00f3n.',
    createNote: 'Crear nota aqu\u00ed',
    noteCreated: 'Nota enviada al proyecto.',
    noteFailed: 'No se pudo crear la nota. Int\u00e9ntalo de nuevo.',
    jumpToSource: 'Ir al bloque original',
    sourceOpened: 'Bloque original abierto.',
    sourceFailed: 'No se pudo abrir el bloque original.',
    keyboardHelp: 'Espacio: reproducir o pausar. Flechas: anterior o siguiente. Escape: detener.',
    stateCurrent: 'Sonando',
    stateDone: 'Le\u00eddo',
    stateQueued: 'Pendiente',
    stateStopped: 'Preparado',
    statePaused: 'En pausa',
    stateFinished: 'Lectura terminada',
    stateError: 'La lectura se interrumpi\u00f3',
    kindProse: 'Prosa',
    kindDialogue: 'Di\u00e1logo',
    kindStageDirection: 'Acotaci\u00f3n',
    kindAction: 'Acci\u00f3n',
    kindTransition: 'Transici\u00f3n',
    kindNote: 'Nota',
    kindSlug: 'Cabecera',
    segmentOf: '{current} de {total}',
  },
  en: {
    readAloudTitle: 'Critical read-aloud',
    tableReadTitle: 'Table read',
    play: 'Play',
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    previous: 'Previous',
    next: 'Next',
    speed: 'Speed',
    segmentation: 'Reading unit',
    sentence: 'Sentence',
    block: 'Block',
    transcript: 'Reading text',
    voices: 'Voice cast',
    voicesHint: 'Available voices depend on the system and browser.',
    systemDefaultVoice: 'System default voice',
    noVoices: 'The system has not published any available voices.',
    unsupported: 'This device does not expose read-aloud through Web Speech. You can still step through the text and create notes manually.',
    noBoundary: 'Word-by-word tracking is unavailable; the unit being spoken will remain highlighted.',
    empty: 'There is no readable text in this selection.',
    createNote: 'Create note here',
    noteCreated: 'Note sent to the project.',
    noteFailed: 'The note could not be created. Try again.',
    jumpToSource: 'Go to original block',
    sourceOpened: 'Original block opened.',
    sourceFailed: 'The original block could not be opened.',
    keyboardHelp: 'Space: play or pause. Arrows: previous or next. Escape: stop.',
    stateCurrent: 'Playing',
    stateDone: 'Read',
    stateQueued: 'Queued',
    stateStopped: 'Ready',
    statePaused: 'Paused',
    stateFinished: 'Reading finished',
    stateError: 'Reading was interrupted',
    kindProse: 'Prose',
    kindDialogue: 'Dialogue',
    kindStageDirection: 'Stage direction',
    kindAction: 'Action',
    kindTransition: 'Transition',
    kindNote: 'Note',
    kindSlug: 'Scene heading',
    segmentOf: '{current} of {total}',
  },
};

export function getReadAloudCopy(
  locale: ReadAloudLocale,
  overrides?: Partial<ReadAloudCopy>,
): ReadAloudCopy {
  return { ...COPY[locale], ...overrides };
}
