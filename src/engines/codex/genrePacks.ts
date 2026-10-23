// Ready-made card types for a world's genres: a few types each, with the
// fields a writer of that genre tends to fill. Written for this app; seeding
// adds the ones the project does not have yet and never touches the rest.
import type { CodexEntryType } from '@/types';
import { foldAlias } from '@/services/codexReference/aliases';
import { generateId } from '@/utils/idGenerator';
import type { CodexTemplate } from './templateTypes';

interface PackType { en: string; es: string; category: CodexEntryType; icon: string; color: string; fields: Array<[string, string]> }
const T = (en: string, es: string, category: CodexEntryType, icon: string, color: string, fields: Array<[string, string]>): PackType => ({ en, es, category, icon, color, fields });

/** Every world gets these, whatever its genre. */
const BASE: PackType[] = [
  T('Protagonist', 'Protagonista', 'character', 'User', '#d5b575', [['Goal', 'Objetivo'], ['Flaw', 'Defecto'], ['Secret', 'Secreto'], ['Arc', 'Arco']]),
  T('Settlement', 'Asentamiento', 'location', 'Home', '#8e7cc3', [['Population', 'Población'], ['Ruler', 'Gobernante'], ['Known for', 'Conocido por']]),
  T('Event', 'Acontecimiento', 'concept', 'CalendarDays', '#7f8c8d', [['When', 'Cuándo'], ['Cause', 'Causa'], ['Consequence', 'Consecuencia']]),
];

/** Keyed by the portable genre name (PROJECT_GENRE_PRESETS). */
export const GENRE_PACKS: Record<string, PackType[]> = {
  Fantasy: [
    T('Spell', 'Hechizo', 'magic', 'Sparkles', '#8e7cc3', [['School', 'Escuela'], ['Cost', 'Coste'], ['Components', 'Componentes'], ['Limits', 'Límites']]),
    T('Kingdom', 'Reino', 'faction', 'Crown', '#c0504d', [['Ruler', 'Soberano'], ['Capital', 'Capital'], ['Allies', 'Aliados'], ['Rivals', 'Rivales']]),
    T('Creature', 'Criatura', 'concept', 'PawPrint', '#6aa84f', [['Habitat', 'Hábitat'], ['Diet', 'Dieta'], ['Danger', 'Peligro'], ['Lore', 'Leyenda']]),
    T('Artifact', 'Artefacto', 'item', 'Gem', '#e08a3c', [['Maker', 'Creador'], ['Power', 'Poder'], ['Price', 'Precio'], ['Whereabouts', 'Paradero']]),
    T('Order', 'Orden', 'faction', 'Shield', '#3d85c6', [['Founded', 'Fundación'], ['Creed', 'Credo'], ['Ranks', 'Rangos']]),
  ],
  Grimdark: [
    T('Warband', 'Mesnada', 'faction', 'Swords', '#7f8c8d', [['Captain', 'Capitán'], ['Pay', 'Paga'], ['Atrocities', 'Atrocidades']]),
    T('Plague', 'Plaga', 'concept', 'Biohazard', '#6aa84f', [['Symptoms', 'Síntomas'], ['Spread', 'Contagio'], ['Toll', 'Víctimas']]),
    T('Relic of war', 'Reliquia de guerra', 'item', 'Axe', '#c0504d', [['Battle', 'Batalla'], ['Bearer', 'Portador'], ['Curse', 'Maldición']]),
  ],
  'Dark Fantasy': [
    T('Pact', 'Pacto', 'magic', 'Flame', '#c0504d', [['Patron', 'Patrón'], ['Gift', 'Don'], ['Price', 'Precio'], ['Breaking', 'Ruptura']]),
    T('Haunt', 'Lugar maldito', 'location', 'Ghost', '#8e7cc3', [['Presence', 'Presencia'], ['Origin', 'Origen'], ['Warding', 'Protección']]),
    T('Witch hunter', 'Cazador de brujas', 'character', 'Crosshair', '#7f8c8d', [['Order', 'Orden'], ['Methods', 'Métodos'], ['Doubts', 'Dudas']]),
  ],
  'Sci-Fi': [
    T('Starship', 'Nave estelar', 'item', 'Rocket', '#3d85c6', [['Class', 'Clase'], ['Crew', 'Tripulación'], ['Drive', 'Propulsión'], ['Armament', 'Armamento']]),
    T('Planet', 'Planeta', 'location', 'Globe', '#6aa84f', [['Star', 'Estrella'], ['Gravity', 'Gravedad'], ['Atmosphere', 'Atmósfera'], ['Settlements', 'Asentamientos']]),
    T('Species', 'Especie', 'concept', 'Dna', '#8e7cc3', [['Biology', 'Biología'], ['Society', 'Sociedad'], ['Communication', 'Comunicación']]),
    T('Technology', 'Tecnología', 'concept', 'Cpu', '#e08a3c', [['Principle', 'Principio'], ['Limits', 'Límites'], ['Who controls it', 'Quién la controla']]),
    T('Corporation', 'Corporación', 'faction', 'Building2', '#7f8c8d', [['Sector', 'Sector'], ['Headquarters', 'Sede'], ['Reach', 'Alcance']]),
  ],
  Modern: [
    T('Workplace', 'Lugar de trabajo', 'location', 'Briefcase', '#3d85c6', [['Boss', 'Jefe'], ['Atmosphere', 'Ambiente'], ['Schedule', 'Horario']]),
    T('Relationship', 'Relación', 'concept', 'HeartHandshake', '#c27ba0', [['Between', 'Entre'], ['Since', 'Desde'], ['Tension', 'Tensión']]),
    T('Family', 'Familia', 'faction', 'Users', '#d5b575', [['Home', 'Hogar'], ['Tradition', 'Tradición'], ['Wound', 'Herida']]),
  ],
  Horror: [
    T('Entity', 'Entidad', 'character', 'Ghost', '#c0504d', [['Manifestation', 'Manifestación'], ['Wants', 'Quiere'], ['Rules', 'Reglas'], ['Weakness', 'Debilidad']]),
    T('Cursed object', 'Objeto maldito', 'item', 'Skull', '#7f8c8d', [['Found', 'Hallado'], ['Effect', 'Efecto'], ['Victims', 'Víctimas']]),
    T('Survivor', 'Superviviente', 'character', 'HeartPulse', '#6aa84f', [['Fear', 'Miedo'], ['Breaking point', 'Límite'], ['Saw', 'Vio']]),
  ],
  Historical: [
    T('Historical figure', 'Personaje histórico', 'character', 'Landmark', '#d5b575', [['Born', 'Nacimiento'], ['Died', 'Muerte'], ['Office', 'Cargo'], ['Sources', 'Fuentes']]),
    T('Battle', 'Batalla', 'concept', 'Swords', '#c0504d', [['Date', 'Fecha'], ['Sides', 'Bandos'], ['Outcome', 'Resultado'], ['Sources', 'Fuentes']]),
    T('Period detail', 'Detalle de época', 'concept', 'Scroll', '#e08a3c', [['Period', 'Época'], ['Use in the book', 'Uso en el libro'], ['Source', 'Fuente']]),
  ],
  Mythology: [
    T('Deity', 'Deidad', 'character', 'Sun', '#e08a3c', [['Domain', 'Dominio'], ['Symbols', 'Símbolos'], ['Worship', 'Culto'], ['Myths', 'Mitos']]),
    T('Myth', 'Mito', 'concept', 'BookOpen', '#8e7cc3', [['Told by', 'Contado por'], ['Moral', 'Moraleja'], ['Versions', 'Versiones']]),
    T('Sacred place', 'Lugar sagrado', 'location', 'Mountain', '#6aa84f', [['Deity', 'Deidad'], ['Rites', 'Ritos'], ['Taboos', 'Tabúes']]),
  ],
  'Alternate History': [
    T('Point of divergence', 'Punto de divergencia', 'concept', 'GitBranch', '#c0504d', [['Real history', 'Historia real'], ['What changed', 'Qué cambió'], ['Consequences', 'Consecuencias']]),
    T('Changed nation', 'Nación alterada', 'faction', 'Flag', '#3d85c6', [['Then', 'Antes'], ['Now', 'Ahora'], ['Leader', 'Líder']]),
  ],
  Dystopian: [
    T('Regime', 'Régimen', 'faction', 'Eye', '#c0504d', [['Ideology', 'Ideología'], ['Control', 'Control'], ['Enforcers', 'Ejecutores']]),
    T('Law', 'Ley', 'concept', 'Gavel', '#7f8c8d', [['Forbids', 'Prohíbe'], ['Punishment', 'Castigo'], ['Loophole', 'Resquicio']]),
    T('Resistance cell', 'Célula de resistencia', 'faction', 'Megaphone', '#6aa84f', [['Leader', 'Líder'], ['Hideout', 'Escondite'], ['Goal', 'Objetivo']]),
  ],
  'Post-Apocalyptic': [
    T('Wasteland', 'Yermo', 'location', 'Tent', '#e08a3c', [['Hazards', 'Peligros'], ['Resources', 'Recursos'], ['Who roams it', 'Quién lo recorre']]),
    T('Scavenged gear', 'Equipo rescatado', 'item', 'Wrench', '#7f8c8d', [['Found at', 'Hallado en'], ['Condition', 'Estado'], ['Trade value', 'Valor de trueque']]),
    T('Survivor band', 'Banda de supervivientes', 'faction', 'Users', '#6aa84f', [['Leader', 'Líder'], ['Rules', 'Normas'], ['Supplies', 'Provisiones']]),
  ],
  Survival: [
    T('Supply', 'Provisión', 'item', 'Package', '#6aa84f', [['Amount', 'Cantidad'], ['Lasts', 'Dura'], ['Where', 'Dónde']]),
    T('Threat', 'Amenaza', 'concept', 'TriangleAlert', '#c0504d', [['Kind', 'Tipo'], ['Signs', 'Señales'], ['Counter', 'Remedio']]),
  ],
  Western: [
    T('Frontier town', 'Pueblo fronterizo', 'location', 'Store', '#e08a3c', [['Sheriff', 'Sheriff'], ['Saloon', 'Salón'], ['Railroad', 'Ferrocarril']]),
    T('Outlaw', 'Forajido', 'character', 'Crosshair', '#c0504d', [['Bounty', 'Recompensa'], ['Gang', 'Banda'], ['Crimes', 'Delitos']]),
  ],
  Cyberpunk: [
    T('Megacorp', 'Megacorporación', 'faction', 'Building2', '#c27ba0', [['Products', 'Productos'], ['Security', 'Seguridad'], ['Dirty secret', 'Secreto sucio']]),
    T('Implant', 'Implante', 'item', 'Cpu', '#3d85c6', [['Maker', 'Fabricante'], ['Function', 'Función'], ['Side effects', 'Efectos secundarios'], ['Street price', 'Precio en la calle']]),
    T('District', 'Distrito', 'location', 'Building', '#8e7cc3', [['Gangs', 'Bandas'], ['Lights', 'Luces'], ['Rules', 'Reglas']]),
  ],
  Solarpunk: [
    T('Community', 'Comunidad', 'faction', 'Sprout', '#6aa84f', [['Values', 'Valores'], ['Decisions', 'Decisiones'], ['Shared works', 'Obras comunes']]),
    T('Green technology', 'Tecnología verde', 'concept', 'Leaf', '#6aa84f', [['Principle', 'Principio'], ['Upkeep', 'Mantenimiento'], ['Trade-offs', 'Contrapartidas']]),
  ],
  Steampunk: [
    T('Contraption', 'Artilugio', 'item', 'Cog', '#e08a3c', [['Inventor', 'Inventor'], ['Power', 'Energía'], ['Flaw', 'Fallo']]),
    T('Guild', 'Gremio', 'faction', 'Factory', '#7f8c8d', [['Trade', 'Oficio'], ['Patron', 'Mecenas'], ['Rivals', 'Rivales']]),
  ],
  Cozy: [
    T('Shop', 'Tienda', 'location', 'Coffee', '#c27ba0', [['Owner', 'Dueño'], ['Specialty', 'Especialidad'], ['Regulars', 'Habituales']]),
    T('Neighbour', 'Vecino', 'character', 'Smile', '#d5b575', [['Quirk', 'Manía'], ['Gift', 'Detalle'], ['Worry', 'Preocupación']]),
  ],
  'Dark Academia': [
    T('Institution', 'Institución', 'location', 'Library', '#7f8c8d', [['Founded', 'Fundación'], ['Traditions', 'Tradiciones'], ['Forbidden wing', 'Ala prohibida']]),
    T('Secret society', 'Sociedad secreta', 'faction', 'KeyRound', '#c0504d', [['Initiation', 'Iniciación'], ['Members', 'Miembros'], ['Purpose', 'Propósito']]),
  ],
  Gaslamp: [
    T('Séance', 'Sesión espiritista', 'concept', 'Candle', '#8e7cc3', [['Medium', 'Médium'], ['Spirit', 'Espíritu'], ['Revealed', 'Revelado']]),
    T('Society house', 'Casa de la alta sociedad', 'location', 'Castle', '#d5b575', [['Family', 'Familia'], ['Servants', 'Servicio'], ['Scandal', 'Escándalo']]),
  ],
};

/** The types a project with these genres would be offered: the base ones, then each genre's, without repeats. */
export function genrePackTypes(genres: readonly string[]): PackType[] {
  const seen = new Set<string>(), out: PackType[] = [];
  for (const type of [...BASE, ...genres.flatMap(genre => GENRE_PACKS[genre] ?? [])]) {
    if (seen.has(type.en)) continue;
    seen.add(type.en); out.push(type);
  }
  return out;
}

/** Templates to add for these genres, leaving out any whose name the project already uses. */
export function genrePackTemplates(genres: readonly string[], existing: readonly Pick<CodexTemplate, 'name'>[], locale: 'es' | 'en', now = Date.now()): CodexTemplate[] {
  const taken = new Set(existing.map(template => foldAlias(template.name.trim())));
  return genrePackTypes(genres).flatMap(type => {
    const name = locale === 'es' ? type.es : type.en;
    if (taken.has(foldAlias(name))) return [];
    taken.add(foldAlias(name));
    return [{ id: generateId('codex-template'), name, category: type.category, icon: type.icon, color: type.color, fields: Object.fromEntries(type.fields.map(([en, es]) => [locale === 'es' ? es : en, ''])), content: '', revision: 0, createdAt: now, updatedAt: now }];
  });
}

/** Add the genre pack's types the project lacks, one by one; returns their names. */
export async function seedGenrePack(projectId: string, genres: readonly string[], existing: readonly Pick<CodexTemplate, 'name'>[], locale: 'es' | 'en'): Promise<string[]> {
  const { saveCodexTemplate } = await import('./templates');
  const added: string[] = [];
  for (const template of genrePackTemplates(genres, existing, locale)) { await saveCodexTemplate(projectId, template, null); added.push(template.name); }
  return added;
}
