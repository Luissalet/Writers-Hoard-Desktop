import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveTableGrouping, effectiveTableView, projectTableGroups, remapTableView, storedTableView, sumTableGroup } from '../src/engines/tables/viewGroups.ts';
import { findMatches } from '../src/engines/tables/tableEdits.ts';

const group = (columnId, direction = 'asc') => ({ columnId, direction });
const row = (id, district, house, label = house) => ({ id, district, house, label });
const read = (entry, columnId) => {
  const identity = entry[columnId];
  return { identity, label: columnId === 'house' ? entry.label : identity };
};
const ids = rows => rows.map(entry => entry.id);
const headers = projection => projection.items.filter(item => item.kind === 'group');

test('two levels retain leaf order, separate duplicate labels and fold just one path', () => {
  const rows = [
    row('first', 'North / Ω', 'id:2', 'Same name'),
    row('second', 'North / Ω', 'id:1', 'Same name'),
    row('third', 'North / Ω', 'id:2', 'Same name'),
    row('fourth', 'South', 'id:2', 'Same name'),
  ];
  const before = structuredClone(rows), rules = [group('district'), group('house', 'desc')];
  const open = projectTableGroups(rows, rules, read, new Set(), 'en');
  assert.deepEqual(ids(open.orderedRows), ['first', 'third', 'second', 'fourth']);
  assert.equal(new Set(headers(open).map(item => item.key)).size, 5);
  assert.deepEqual(headers(open).map(({ label, depth, count }) => [label, depth, count]), [
    ['North / Ω', 0, 3], ['Same name', 1, 2], ['Same name', 1, 1], ['South', 0, 1], ['Same name', 1, 1],
  ]);
  const [north, northSecondHouse] = open.pathsByRow.get('first');
  const folded = projectTableGroups(rows, rules, read, new Set([northSecondHouse]), 'en');
  assert.deepEqual(ids(folded.expandedRows), ['second', 'fourth']);
  assert.deepEqual(folded.orderedRows, open.orderedRows);
  assert.deepEqual(folded.pathsByRow, open.pathsByRow);
  assert.equal(folded.items.length, open.items.length, 'keep hidden rows mounted');
  const parentFolded = projectTableGroups(rows, rules, read, new Set([north]), 'en');
  assert.deepEqual(ids(parentFolded.expandedRows), ['fourth']);
  assert.deepEqual(headers(parentFolded).filter(item => item.hidden).map(item => item.depth), [1, 1]);
  assert.deepEqual(rows, before);
});

test('blank, zero, decimals, false and Unicode identities remain distinct', () => {
  const rows = ['', '0', '1.12', '1.5', 'false', 'Café', 'Cafe\u0301'].map((value, index) => ({ id: String(index), value }));
  const readNumber = ({ value }) => {
    const numeric = value ? Number(value) : undefined;
    return { identity: value, label: value, number: Number.isFinite(numeric) ? numeric : undefined };
  };
  const asc = projectTableGroups(rows, [group('value')], readNumber, new Set(), 'es');
  assert.deepEqual(ids(asc.orderedRows).slice(0, 4), ['0', '1', '2', '3']);
  assert.equal(new Set(headers(asc).map(item => item.key)).size, rows.length);
  assert(headers(asc).some(item => item.label === 'false'));
  const desc = projectTableGroups(rows, [group('value', 'desc')], readNumber, new Set(), 'es');
  assert.deepEqual(ids(desc.orderedRows), ids(asc.orderedRows).reverse());
  const ungrouped = projectTableGroups(rows, [], () => assert.fail('No column needed'), new Set(), 'es');
  assert.deepEqual(ungrouped.orderedRows, rows);
});

test('four saved levels keep a numeric leaf order and fold only the selected branch', () => {
  const columns = ['region', 'people', 'hold', 'souls'].map(id => ({ id }));
  const stored = [
    group('region'), group('people'), group('retired'), group('hold'),
    group('people', 'desc'), group('souls', 'desc'),
  ];
  const rules = effectiveTableGrouping(stored, columns);
  assert.deepEqual(rules, [group('region'), group('people'), group('hold'), group('souls', 'desc')]);
  const rows = [
    { id: 'low', region: 'North', people: 'Clans', hold: 'Grey Ω', souls: '900' },
    { id: 'other', region: 'North', people: 'Clans', hold: 'Stone Δ', souls: '10' },
    { id: 'high', region: 'North', people: 'Clans', hold: 'Grey Ω', souls: '1200' },
    { id: 'south', region: 'South', people: 'Clans', hold: 'Grey Ω', souls: '300' },
  ];
  const readGroup = (row, id) => ({
    identity: row[id], label: row[id], number: id === 'souls' ? Number(row[id]) : undefined,
  });
  const open = projectTableGroups(rows, rules, readGroup, new Set(), 'en');
  assert.deepEqual(ids(open.orderedRows), ['high', 'low', 'other', 'south']);
  const path = open.pathsByRow.get('high');
  assert.equal(path.length, 4);
  assert.notEqual(path[2], open.pathsByRow.get('south')[2]);
  const closed = projectTableGroups(rows, rules, readGroup, new Set([path[2]]), 'en');
  assert.deepEqual(ids(closed.expandedRows), ['other', 'south']);
  assert.deepEqual(closed.pathsByRow.get('high'), path);
  assert.deepEqual(headers(closed).filter(header => header.hidden).map(header => header.depth), [3, 3]);
});

test('search matches linked titles and returns each matching cell once', () => {
  const rows = [{ id: 'r:1' }, { id: 'r:2' }];
  const columns = [{ id: 'reference', name: 'Reference', kind: 'reference' }];
  assert.deepEqual(findMatches(rows, columns, '  guard Ω ', entry =>
    entry.id === 'r:1' ? ['codex-id', 'Guard Ω', 'Guard Ω'] : ['different-id', 'Other']), [
    { rowId: 'r:1', columnId: 'reference' },
  ]);
  assert.deepEqual(findMatches(rows.slice(0, 1), columns, 'codex-id', () => 'codex-id'), [
    { rowId: 'r:1', columnId: 'reference' },
  ]);
});

test('a deep grouping imported with a wide table does not use the JavaScript call stack', () => {
  const columns = Array.from({ length: 6000 }, (_, index) => ({ id: String(index) }));
  const rules = effectiveTableGrouping(columns.map(({ id }) => group(id)), columns);
  const rows = [{ id: 'only row' }];
  const read = () => ({ identity: 'a', label: 'a' });
  const open = projectTableGroups(rows, rules, read, new Set(), 'en');
  assert.equal(open.items.length, 6001);
  assert.equal(open.pathsByRow.get('only row').length, 6000);
  assert.equal(open.expandedRows[0], rows[0]);
});

test('group subtotals use the full filtered branch and survive folding', () => {
  const rows = [
    { id: 'wall', district: 'North', house: 'Marrow', souls: '2450' },
    { id: 'hold', district: 'North', house: 'Marrow', souls: '1750' },
    { id: 'fern', district: 'North', house: 'Fern', souls: '0' },
    { id: 'empty', district: 'South', house: 'Reed', souls: ' ' },
    { id: 'error', district: 'South', house: 'Reed', souls: '#DIV/0!' },
  ];
  const rules = [group('district'), group('house')];
  const subtotal = branch => sumTableGroup(branch, item => item.souls);
  const summarize = (source, collapsed = new Set()) => projectTableGroups(source, rules, read, collapsed, 'en', subtotal);
  const full = summarize(rows);
  const north = headers(full).find(item => item.value === 'North');
  const marrow = headers(full).find(item => item.value === 'Marrow');
  assert.deepEqual(north.subtotal, { value: 4200, count: 3 });
  assert.deepEqual(marrow.subtotal, { value: 4200, count: 2 });
  assert.deepEqual(headers(full).find(item => item.value === 'Fern').subtotal, { value: 0, count: 1 });
  assert.deepEqual(headers(full).find(item => item.value === 'Reed').subtotal, { value: null, count: 0 });
  const folded = summarize(rows, new Set([marrow.key]));
  assert.deepEqual(headers(folded).find(item => item.key === marrow.key).subtotal, marrow.subtotal);
  assert.equal(folded.expandedRows.some(item => item.id === 'wall'), false);
  assert.deepEqual(headers(summarize(rows.slice(0, 1)))[0].subtotal, { value: 2450, count: 1 });
  assert.deepEqual(sumTableGroup(['1e308', '1e308'], value => value), { value: '#NUM!', count: 2 });
  for (const values of [
    ['1000000000000000', '0.01', '-1000000000000000'],
    ['-1000000000000000', '1000000000000000', '0.01'],
    ['0.01', '-1000000000000000', '1000000000000000'],
  ]) assert.deepEqual(sumTableGroup(values, value => value), { value: 0.01, count: 3 });
  assert.deepEqual(sumTableGroup(['1e308', '1e308', '-1e308'], value => value), { value: 1e308, count: 3 });
  assert.deepEqual(sumTableGroup(['9007199254740991'], value => value), { value: 9007199254740991, count: 1 });
});

test('subtotal choices inherit and remap by numeric column identity', () => {
  const columns = [
    { id: 'house', kind: 'text' },
    { id: 'souls', kind: 'number' },
    { id: 'ratio', kind: 'number', calculation: { resultType: 'percent' } },
  ];
  const views = [{ tableId: 'ledger', subtotalColumns: ['souls'] }, { tableId: 'ledger', eraId: 'quiet', subtotalColumns: [] }];
  assert.deepEqual(storedTableView(views, 'ledger', 'later').subtotalColumns, ['souls']);
  assert.deepEqual(storedTableView(views, 'ledger', 'quiet').subtotalColumns, []);
  const view = { subtotalColumns: ['house', 'ratio', 'ratio', 'souls', 'unknown'] };
  assert.deepEqual(effectiveTableView(view, columns).subtotalColumns, ['ratio', 'souls']);
  assert.deepEqual(remapTableView({ subtotalColumns: ['souls', 'unknown'] }, id => id === 'souls' ? 'new-souls' : undefined), { subtotalColumns: ['new-souls'] });
  assert.deepEqual(remapTableView(views[1], () => undefined), { subtotalColumns: [] });
});
