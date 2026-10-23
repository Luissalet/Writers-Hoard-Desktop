// Guided cards: a few questions, one at a time, whose answers fill the card.
// Written for this app. Each answer goes to a field named after its question;
// the first answer of a guide (the gist) also opens the card's description.
import type { CodexEntryType } from '@/types';

export interface GuideStep { field: { es: string; en: string }; question: { es: string; en: string }; hint: { es: string; en: string } }
export interface CardGuide { type: CodexEntryType; name: { es: string; en: string }; steps: GuideStep[] }
const S = (fieldEs: string, fieldEn: string, qEs: string, qEn: string, hEs: string, hEn: string): GuideStep => ({ field: { es: fieldEs, en: fieldEn }, question: { es: qEs, en: qEn }, hint: { es: hEs, en: hEn } });

export const CARD_GUIDES: CardGuide[] = [
  { type: 'character', name: { es: 'Personaje', en: 'Character' }, steps: [
    S('En pocas palabras', 'In a few words', '¿Quién es, en una frase?', 'Who are they, in one sentence?', 'Oficio, edad, lo que salta a la vista.', 'Trade, age, what stands out.'),
    S('Objetivo', 'Goal', '¿Qué quiere más que nada?', 'What do they want most?', 'Algo concreto que pueda ganar o perder.', 'Something concrete they can win or lose.'),
    S('Miedo', 'Fear', '¿Qué teme que pase?', 'What do they fear will happen?', 'El miedo empuja las decisiones malas.', 'Fear drives the bad decisions.'),
    S('Secreto', 'Secret', '¿Qué esconde, y a quién?', 'What do they hide, and from whom?', 'Un secreto da escenas.', 'A secret gives you scenes.'),
    S('Voz', 'Voice', '¿Cómo habla?', 'How do they speak?', 'Muletillas, ritmo, lo que nunca diría.', 'Tics, rhythm, what they would never say.'),
    S('Arco', 'Arc', '¿Qué habrá cambiado en él al final?', 'What will have changed in them by the end?', 'Puede no cambiar: eso también es un arco.', 'They may not change: that is an arc too.'),
  ] },
  { type: 'location', name: { es: 'Lugar', en: 'Location' }, steps: [
    S('En pocas palabras', 'In a few words', '¿Qué lugar es, en una frase?', 'What place is it, in one sentence?', 'Pueblo, cueva, nave, salón…', 'Town, cave, ship, hall…'),
    S('Al llegar', 'Arriving', '¿Qué se ve al llegar?', 'What do you see when you arrive?', 'La primera imagen que tendrá el lector.', 'The first picture the reader gets.'),
    S('Sonidos y olores', 'Sounds and smells', '¿Qué se oye y a qué huele?', 'What do you hear and smell?', 'Los sentidos que no son la vista.', 'The senses other than sight.'),
    S('Quién manda', 'Who rules', '¿Quién manda aquí, y cómo se nota?', 'Who is in charge here, and how does it show?', 'Leyes, guardias, costumbres.', 'Laws, guards, customs.'),
    S('Peligro', 'Danger', '¿Qué puede salir mal aquí?', 'What can go wrong here?', 'Un peligro hace memorable un lugar.', 'A danger makes a place memorable.'),
    S('Secreto', 'Secret', '¿Qué secreto guarda?', 'What secret does it keep?', 'Algo que solo descubre quien vuelve.', 'Something only someone who returns finds out.'),
  ] },
  { type: 'concept', name: { es: 'Acontecimiento', en: 'Event' }, steps: [
    S('En pocas palabras', 'In a few words', '¿Qué pasó, en una frase?', 'What happened, in one sentence?', 'Batalla, boda, descubrimiento…', 'Battle, wedding, discovery…'),
    S('Cuándo', 'When', '¿Cuándo pasó?', 'When did it happen?', 'Una fecha del mundo o «antes de…».', 'A world date or "before…".'),
    S('Causa', 'Cause', '¿Por qué pasó?', 'Why did it happen?', 'La causa que contaría cada bando.', 'The cause each side would tell.'),
    S('Testigos', 'Witnesses', '¿Quién estaba y qué vio?', 'Who was there and what did they see?', 'Versiones distintas dan conflicto.', 'Different versions give conflict.'),
    S('Consecuencia', 'Consequence', '¿Qué cambió después?', 'What changed afterwards?', 'Lo que tus personajes heredan de ello.', 'What your characters inherit from it.'),
  ] },
  { type: 'faction', name: { es: 'Facción', en: 'Faction' }, steps: [
    S('En pocas palabras', 'In a few words', '¿Qué grupo es, en una frase?', 'What group is it, in one sentence?', 'Gremio, secta, ejército, familia…', 'Guild, sect, army, family…'),
    S('Quiere', 'Wants', '¿Qué quiere el grupo?', 'What does the group want?', 'Su objetivo como grupo.', 'Its goal as a group.'),
    S('Cómo se entra', 'How to join', '¿Cómo se entra, y cómo se sale?', 'How do you join, and how do you leave?', 'Ritos, pruebas, precios.', 'Rites, trials, prices.'),
    S('Enemigos', 'Enemies', '¿Con quién choca?', 'Who do they clash with?', 'Rivales dentro y fuera.', 'Rivals inside and out.'),
    S('Grieta', 'Rift', '¿Qué lo podría romper por dentro?', 'What could break it from within?', 'La tensión que puedes usar.', 'The tension you can use.'),
  ] },
  { type: 'item', name: { es: 'Objeto', en: 'Item' }, steps: [
    S('En pocas palabras', 'In a few words', '¿Qué objeto es, en una frase?', 'What object is it, in one sentence?', 'Espada, carta, llave, reliquia…', 'Sword, letter, key, relic…'),
    S('Origen', 'Origin', '¿Quién lo hizo y para qué?', 'Who made it and why?', 'El propósito original.', 'Its original purpose.'),
    S('Poder', 'Power', '¿Qué hace, o qué significa?', 'What does it do, or mean?', 'Un poder o un valor para alguien.', 'A power or a value to someone.'),
    S('Paradero', 'Whereabouts', '¿Dónde está ahora y quién lo busca?', 'Where is it now and who seeks it?', 'El objeto mueve la trama.', 'The object moves the plot.'),
  ] },
];

export function cardGuide(type: CodexEntryType): CardGuide | undefined {
  return CARD_GUIDES.find(guide => guide.type === type);
}

/** The card's fields and description from the answers given (blank answers leave nothing). */
export function guideAnswers(guide: CardGuide, answers: readonly string[], locale: 'es' | 'en'): { fields: Record<string, string>; content: string } {
  const fields: Record<string, string> = {};
  guide.steps.forEach((step, index) => { const answer = (answers[index] ?? '').trim(); if (answer) fields[step.field[locale]] = answer.slice(0, 2000); });
  const gist = (answers[0] ?? '').trim();
  const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
  return { fields, content: gist ? `<p>${escape(gist)}</p>` : '' };
}
