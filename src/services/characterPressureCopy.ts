export type CharacterPressureCopyLocale = 'en' | 'es';
export type CharacterPressureCopySituationField =
  | 'situation'
  | 'scarceResource'
  | 'timeLimit'
  | 'secret'
  | 'cost';
export type CharacterPressureCopyInsightKind = 'question' | 'friction' | 'alliance' | 'decision';
export type CharacterPressureCopyPromotionTarget = 'beat' | 'scene' | 'relationship-change' | 'note';
export type CharacterPressureCopyDimension =
  | 'objective'
  | 'need'
  | 'fear'
  | 'power'
  | 'debt'
  | 'relationship';
export type CharacterPressureCopySignalDimension = Exclude<
  CharacterPressureCopyDimension,
  'relationship'
>;
export type CharacterPressureCopyValidationCode =
  | 'project-required'
  | 'character-count'
  | 'duplicate-character'
  | 'character-not-found'
  | 'character-project-mismatch'
  | 'situation-required'
  | 'pressure-required'
  | 'result-not-found'
  | 'target-not-applicable';

interface QuestionArgs {
  situation: string;
  name: string;
  objective: string;
  need: string;
  fear: string;
}

interface FrictionArgs {
  leftName: string;
  leftPower: string;
  rightName: string;
  rightObjective: string;
  pressure: string;
  relationship: string;
}

interface AllianceArgs {
  leftName: string;
  leftNeed: string;
  leftDebt: string;
  rightName: string;
  rightNeed: string;
  rightDebt: string;
  pressure: string;
  relationship: string;
}

interface DecisionArgs {
  name: string;
  objective: string;
  need: string;
  fear: string;
  power: string;
  debt: string;
  pressure: string;
  relationship: string;
}

export interface CharacterPressureChamberCopy {
  id: string;
  title: string;
  subtitle: string;
  nonCanon: string;
  charactersLegend: string;
  charactersHint: string;
  noCharacters: string;
  selectedCount: (count: number) => string;
  profilesTitle: string;
  profilesHint: string;
  pressureTitle: string;
  pressureHint: string;
  labels: Record<CharacterPressureCopySituationField, string>;
  placeholders: Record<CharacterPressureCopySituationField, string>;
  run: string;
  rerun: string;
  resultsTitle: string;
  resultsHint: string;
  resultCount: (count: number) => string;
  resultsEmpty: string;
  categories: Record<CharacterPressureCopyInsightKind | 'all', string>;
  dimensions: Record<CharacterPressureCopyDimension, string>;
  explicitSignal: string;
  adjacentSignal: string;
  missingSignal: string;
  evidenceTitle: string;
  promotionsTitle: string;
  promotionUnavailable: string;
  promote: Record<CharacterPressureCopyPromotionTarget, string>;
  promotionRequested: (target: CharacterPressureCopyPromotionTarget) => string;
  promotionFailed: string;
  validation: Record<CharacterPressureCopyValidationCode, string>;
  generation: {
    missing: Record<CharacterPressureCopySignalDimension, string>;
    recordedRelationship: (value: {
      label: string;
      kind: string;
      intensity: number;
      state: string;
    }) => string;
    codexRelationship: (value: { description: string; type: string }) => string;
    missingRelationship: string;
    pressurePart: Record<
      Exclude<CharacterPressureCopySituationField, 'situation'>,
      (value: string) => string
    >;
    joinPressure: (parts: readonly string[]) => string;
    question: (args: QuestionArgs) => string;
    friction: (args: FrictionArgs) => string;
    alliance: (args: AllianceArgs) => string;
    decision: (args: DecisionArgs) => string;
    promotionTitle: (
      target: CharacterPressureCopyPromotionTarget,
      characterNames: string,
    ) => string;
  };
}

const VALIDATION_EN: CharacterPressureChamberCopy['validation'] = {
  'project-required': 'Choose a project before opening the chamber.',
  'character-count': 'Choose between two and four characters.',
  'duplicate-character': 'Choose each character only once.',
  'character-not-found': 'One selected character is no longer available. Review the selection.',
  'character-project-mismatch': 'One selected character belongs to another project.',
  'situation-required': 'Describe the situation before opening the chamber.',
  'pressure-required': 'Add a scarce resource, time limit, secret, or cost.',
  'result-not-found': 'That possibility is no longer part of this session. Run the chamber again.',
  'target-not-applicable': 'A relationship change needs a possibility involving two characters.',
};

const VALIDATION_ES: CharacterPressureChamberCopy['validation'] = {
  'project-required': 'Elige un proyecto antes de abrir la cámara.',
  'character-count': 'Elige entre dos y cuatro personajes.',
  'duplicate-character': 'Elige cada personaje una sola vez.',
  'character-not-found': 'Uno de los personajes elegidos ya no está disponible. Revisa la selección.',
  'character-project-mismatch': 'Uno de los personajes elegidos pertenece a otro proyecto.',
  'situation-required': 'Describe la situación antes de abrir la cámara.',
  'pressure-required': 'Añade un recurso escaso, un límite temporal, un secreto o un coste.',
  'result-not-found': 'Esa posibilidad ya no pertenece a la sesión. Vuelve a ejecutar la cámara.',
  'target-not-applicable': 'Un cambio de relación necesita una posibilidad con dos personajes.',
};

export const CHARACTER_PRESSURE_COPY: Record<
  CharacterPressureCopyLocale,
  CharacterPressureChamberCopy
> = {
  en: {
    id: 'character-pressure-en-v1',
    title: 'Character pressure chamber',
    subtitle: 'Put existing motives and relationships under pressure to discover questions—not answers.',
    nonCanon: 'Exploration only · never changes canon',
    charactersLegend: 'Choose 2–4 characters',
    charactersHint: 'The chamber reads their Codex entries, latest linked arcs, and recorded relationships.',
    noCharacters: 'Add character entries to the Codex before opening this chamber.',
    selectedCount: (count) => `${count} selected`,
    profilesTitle: 'Signals in play',
    profilesHint: 'Adjacent signals are prompts, not facts. Missing signals remain visibly open.',
    pressureTitle: 'Set the pressure',
    pressureHint: 'Describe the situation, then add at least one constraint.',
    labels: {
      situation: 'Situation',
      scarceResource: 'Scarce resource',
      timeLimit: 'Time limit',
      secret: 'Secret',
      cost: 'Cost',
    },
    placeholders: {
      situation: 'The group is trapped somewhere that makes neutrality impossible…',
      scarceResource: 'One seat, a single dose, the last safe route…',
      timeLimit: 'Before dawn, ten minutes, one final vote…',
      secret: 'What one person knows and cannot safely reveal…',
      cost: 'What success would consume, expose, or break…',
    },
    run: 'Open the chamber',
    rerun: 'Run again',
    resultsTitle: 'Possibilities under pressure',
    resultsHint: 'Every result is an open question grounded in the selected source rows.',
    resultCount: (count) => `${count} possibilities`,
    resultsEmpty: 'No possibilities match this filter.',
    categories: {
      all: 'All',
      question: 'Questions',
      friction: 'Frictions',
      alliance: 'Alliances',
      decision: 'Decisions',
    },
    dimensions: {
      objective: 'Objective',
      need: 'Need',
      fear: 'Fear',
      power: 'Power',
      debt: 'Debt',
      relationship: 'Relationship',
    },
    explicitSignal: 'Recorded directly',
    adjacentSignal: 'Possible pressure from an adjacent field',
    missingSignal: 'Still open',
    evidenceTitle: 'Why this question appeared',
    promotionsTitle: 'Turn this possibility into a draft',
    promotionUnavailable: 'Connect a destination callback to promote this possibility.',
    promote: {
      beat: 'Draft beat',
      scene: 'Draft scene',
      'relationship-change': 'Draft relationship change',
      note: 'Draft note',
    },
    promotionRequested: (target) => `Draft handed to the host for ${target} with provenance.`,
    promotionFailed: 'The destination did not accept the draft. Nothing was changed here.',
    validation: VALIDATION_EN,
    generation: {
      missing: {
        objective: 'an objective still left open',
        need: 'a need not yet articulated',
        fear: 'a fear still unnamed',
        power: 'leverage not yet defined',
        debt: 'a debt that could emerge',
      },
      recordedRelationship: ({ label, kind, intensity, state }) =>
        `the recorded “${label || kind}” relationship (intensity ${intensity}, state ${state})`,
      codexRelationship: ({ description, type }) => `the Codex tie “${description || type}”`,
      missingRelationship: 'a relationship not yet defined',
      pressurePart: {
        scarceResource: (value) => `the scarce resource “${value}”`,
        timeLimit: (value) => `the limit “${value}”`,
        secret: (value) => `the secret “${value}”`,
        cost: (value) => `the cost “${value}”`,
      },
      joinPressure: (parts) => parts.join(', '),
      question: ({ situation, name, objective, need, fear }) =>
        `When ${situation}, what might force ${name} to choose between the objective ${objective} and the need ${need}, and what fear could that expose (${fear})?`,
      friction: ({ leftName, leftPower, rightName, rightObjective, pressure, relationship }) =>
        `Where might ${leftName}'s power (${leftPower}) collide with ${rightName}'s objective (${rightObjective}) while contesting ${pressure}, given ${relationship}?`,
      alliance: ({ leftName, leftNeed, leftDebt, rightName, rightNeed, rightDebt, pressure, relationship }) =>
        `Could ${leftName} and ${rightName} form a temporary alliance to protect ${leftNeed} and ${rightNeed} around ${pressure}? What debt might each take on—${leftDebt} against ${rightDebt}—and how could ${relationship} strain it?`,
      decision: ({ name, objective, need, fear, power, debt, pressure, relationship }) =>
        `Under ${pressure}, what difficult decision might ${name} face: pursue ${objective}, protect ${need}, use ${power}, or accept ${debt}? How could the fear ${fear} and ${relationship} change the cost of each possibility?`,
      promotionTitle: (target, names) => {
        const labels: Record<CharacterPressureCopyPromotionTarget, string> = {
          beat: 'Pressure beat',
          scene: 'Pressure scene',
          'relationship-change': 'Possible relationship change',
          note: 'Pressure question',
        };
        return `${labels[target]}: ${names}`;
      },
    },
  },
  es: {
    id: 'character-pressure-es-v1',
    title: 'Cámara de presión de personajes',
    subtitle: 'Tensiona motivos y relaciones existentes para descubrir preguntas, no respuestas.',
    nonCanon: 'Solo exploración · nunca cambia el canon',
    charactersLegend: 'Elige entre 2 y 4 personajes',
    charactersHint: 'La cámara lee sus fichas de Códice, los arcos enlazados más recientes y las relaciones registradas.',
    noCharacters: 'Añade fichas de personaje al Códice antes de abrir esta cámara.',
    selectedCount: (count) => `${count} seleccionados`,
    profilesTitle: 'Señales en juego',
    profilesHint: 'Las señales adyacentes son preguntas, no hechos. Lo que falta permanece visiblemente abierto.',
    pressureTitle: 'Define la presión',
    pressureHint: 'Describe la situación y añade al menos una restricción.',
    labels: {
      situation: 'Situación',
      scarceResource: 'Recurso escaso',
      timeLimit: 'Límite temporal',
      secret: 'Secreto',
      cost: 'Coste',
    },
    placeholders: {
      situation: 'El grupo está atrapado en un lugar donde la neutralidad es imposible…',
      scarceResource: 'Un asiento, una sola dosis, la última ruta segura…',
      timeLimit: 'Antes del amanecer, diez minutos, una última votación…',
      secret: 'Lo que alguien sabe y no puede revelar sin peligro…',
      cost: 'Lo que el éxito consumiría, expondría o rompería…',
    },
    run: 'Abrir la cámara',
    rerun: 'Ejecutar de nuevo',
    resultsTitle: 'Posibilidades bajo presión',
    resultsHint: 'Cada resultado es una pregunta abierta apoyada en las filas fuente elegidas.',
    resultCount: (count) => `${count} posibilidades`,
    resultsEmpty: 'Ninguna posibilidad coincide con este filtro.',
    categories: {
      all: 'Todas',
      question: 'Preguntas',
      friction: 'Fricciones',
      alliance: 'Alianzas',
      decision: 'Decisiones',
    },
    dimensions: {
      objective: 'Objetivo',
      need: 'Necesidad',
      fear: 'Miedo',
      power: 'Poder',
      debt: 'Deuda',
      relationship: 'Relación',
    },
    explicitSignal: 'Registrada directamente',
    adjacentSignal: 'Presión posible desde un campo adyacente',
    missingSignal: 'Sigue abierta',
    evidenceTitle: 'Por qué apareció esta pregunta',
    promotionsTitle: 'Convierte esta posibilidad en borrador',
    promotionUnavailable: 'Conecta un callback de destino para promover esta posibilidad.',
    promote: {
      beat: 'Borrador de beat',
      scene: 'Borrador de escena',
      'relationship-change': 'Borrador de cambio de relación',
      note: 'Borrador de nota',
    },
    promotionRequested: (target) => `Borrador entregado al host para ${target} con su procedencia.`,
    promotionFailed: 'El destino no aceptó el borrador. Aquí no se modificó nada.',
    validation: VALIDATION_ES,
    generation: {
      missing: {
        objective: 'un objetivo aún abierto',
        need: 'una necesidad todavía no formulada',
        fear: 'un miedo aún sin nombre',
        power: 'un poder todavía sin definir',
        debt: 'una deuda que podría aparecer',
      },
      recordedRelationship: ({ label, kind, intensity, state }) =>
        `la relación registrada “${label || kind}” (intensidad ${intensity}, estado ${state})`,
      codexRelationship: ({ description, type }) => `el vínculo de Códice “${description || type}”`,
      missingRelationship: 'una relación todavía no definida',
      pressurePart: {
        scarceResource: (value) => `el recurso escaso “${value}”`,
        timeLimit: (value) => `el límite “${value}”`,
        secret: (value) => `el secreto “${value}”`,
        cost: (value) => `el coste “${value}”`,
      },
      joinPressure: (parts) => parts.join(', '),
      question: ({ situation, name, objective, need, fear }) =>
        `Cuando ${situation}, ¿qué podría obligar a ${name} a elegir entre el objetivo ${objective} y la necesidad ${need}, y qué miedo podría dejar al descubierto (${fear})?`,
      friction: ({ leftName, leftPower, rightName, rightObjective, pressure, relationship }) =>
        `¿Dónde podría chocar el poder de ${leftName} (${leftPower}) con el objetivo de ${rightName} (${rightObjective}) al disputar ${pressure}, dada ${relationship}?`,
      alliance: ({ leftName, leftNeed, leftDebt, rightName, rightNeed, rightDebt, pressure, relationship }) =>
        `¿Podrían ${leftName} y ${rightName} formar una alianza temporal para proteger ${leftNeed} y ${rightNeed} ante ${pressure}? ¿Qué deuda podría asumir cada uno —${leftDebt} frente a ${rightDebt}— y cómo podría tensionarla ${relationship}?`,
      decision: ({ name, objective, need, fear, power, debt, pressure, relationship }) =>
        `Bajo ${pressure}, ¿qué decisión difícil podría enfrentar ${name}: perseguir ${objective}, proteger ${need}, usar ${power} o aceptar ${debt}? ¿Cómo podrían el miedo ${fear} y ${relationship} cambiar el coste de cada posibilidad?`,
      promotionTitle: (target, names) => {
        const labels: Record<CharacterPressureCopyPromotionTarget, string> = {
          beat: 'Beat de presión',
          scene: 'Escena de presión',
          'relationship-change': 'Cambio de relación posible',
          note: 'Pregunta de presión',
        };
        return `${labels[target]}: ${names}`;
      },
    },
  },
};

export function getCharacterPressureCopy(
  locale: CharacterPressureCopyLocale,
): CharacterPressureChamberCopy {
  return CHARACTER_PRESSURE_COPY[locale];
}
