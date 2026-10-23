// Builds the offline compendium data from a checkout of the 5e-bits database
// (https://github.com/5e-bits/5e-database, MIT code; the game material is the
// System Reference Document 5.2 by Wizards of the Coast LLC, CC BY 4.0).
//   node scripts/build-srd-compendium.mjs <path to 5e-database>
// Writes compact JSON to src/engines/compendium/data/srd52-*.json.
import fs from 'node:fs';
import path from 'node:path';

const source = process.argv[2];
if (!source) { console.error('usage: node scripts/build-srd-compendium.mjs <5e-database checkout>'); process.exit(1); }
const read = name => JSON.parse(fs.readFileSync(path.join(source, 'src/2024/en', `5e-SRD-${name}.json`), 'utf8'));
const out = path.resolve('src/engines/compendium/data');
fs.mkdirSync(out, { recursive: true });
const text = value => String(value ?? '').replace(/\s+\n/g, '\n').trim();
const list = values => (Array.isArray(values) ? values : values ? [values] : []).map(value => typeof value === 'string' ? value : value.name ?? value.index).filter(Boolean).join(', ');
const entries = values => (values ?? []).map(value => [value.name, text(value.desc)]);

const monsters = read('Monsters').map(m => {
  const prof = kind => (m.proficiencies ?? []).filter(p => p.proficiency.index.startsWith(kind)).map(p => `${p.proficiency.name.replace(/^Saving Throw: |^Skill: /, '')} +${p.value}`).join(', ');
  const ac = m.armor_class?.[0] ?? {};
  return {
    id: m.index, n: m.name, s: m.size, t: m.type, al: m.alignment,
    ac: ac.value, acn: ac.type && ac.type !== 'dex' ? (ac.armor?.map(a => a.name).join(', ') || ac.desc || ac.type) : undefined,
    hp: m.hit_points, hd: m.hit_points_roll || m.hit_dice,
    sp: Object.entries(m.speed ?? {}).map(([k, v]) => (k === 'walk' ? v : `${k} ${v}`)).join(', '),
    ab: [m.strength, m.dexterity, m.constitution, m.intelligence, m.wisdom, m.charisma],
    sv: prof('saving-throw') || undefined, sk: prof('skill') || undefined,
    dv: list(m.damage_vulnerabilities) || undefined, dr: list(m.damage_resistances) || undefined, di: list(m.damage_immunities) || undefined, ci: list(m.condition_immunities) || undefined,
    se: Object.entries(m.senses ?? {}).map(([k, v]) => (k === 'passive_perception' ? `Passive Perception ${v}` : `${k.replace(/_/g, ' ')} ${v}`)).join(', '),
    la: m.languages || undefined, cr: m.challenge_rating, xp: m.xp, xpl: m.xp_in_lair, pb: m.proficiency_bonus,
    gear: list(m.gear) || undefined,
    tr: entries(m.special_abilities), act: entries(m.actions), bon: entries(m.bonus_actions), rea: entries(m.reactions), leg: entries(m.legendary_actions),
  };
});
const spells = read('Spells').map(s => ({
  id: s.index, n: s.name, lv: s.level, sc: s.school?.name, ct: s.casting_time, ra: s.range, co: (s.components ?? []).join(', '), ma: s.material || undefined,
  du: s.duration, cn: s.concentration || undefined, ri: s.ritual || undefined, cl: list(s.classes) || undefined,
  d: text(s.description ?? (Array.isArray(s.desc) ? s.desc.join('\n') : s.desc)), hl: text(s.higher_level ? (Array.isArray(s.higher_level) ? s.higher_level.join('\n') : s.higher_level) : '') || undefined,
}));
const items = read('Magic-Items').map(i => ({ id: i.index, n: i.name, ca: i.equipment_category?.name, ra: i.rarity?.name, at: i.attunement || undefined, d: text(Array.isArray(i.desc) ? i.desc.join('\n') : i.desc) }));
const conditions = read('Conditions').map(c => ({ id: c.index, n: c.name, d: text(c.description ?? (Array.isArray(c.desc) ? c.desc.join('\n') : c.desc)) }));
const write = (name, data) => { fs.writeFileSync(path.join(out, `srd52-${name}.json`), JSON.stringify(data)); console.log(name, data.length, fs.statSync(path.join(out, `srd52-${name}.json`)).size); };
write('monsters', monsters); write('spells', spells); write('items', items); write('conditions', conditions);
