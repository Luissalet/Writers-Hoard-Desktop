import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project, Timeline, TimelineEvent } from '@/types';
import { t } from '@/i18n/useTranslation';
import { useLocaleStore } from '@/stores/localeStore';
import '@/engines/timeline';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import TimelineView from '@/engines/timeline/components/TimelineView';
import { defaultWorldCalendar, eraOf, formatWorldDate, fromDayNumber, parseWorldDate, toDayNumber, validateWorldCalendar } from '@/engines/timeline/worldCalendar';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import { compactTimelineLabel, eventWithinYearRange, saveTimelineSettings } from '@/engines/timeline/timelineSettings';
import { whCreateEvent, whListEvents } from '@/services/aiBridge/tools/timeline';
import { whWorldCalendarGet, whWorldCalendarSet, whWorldDate } from '@/services/aiBridge/tools/worldCalendar';
import { buildWorldBible, loadBibleData } from '@/services/worldBible';
import { loadWorldDoc } from '@/services/familyBridge/worldExport';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const id = (value: string) => document.querySelector<HTMLElement>(`[data-testid="${value}"]`);
function input(node: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }

export async function testTimelineScopes(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'en' });
  const now = Date.now(), pid = `timeline-scopes-${now}`, sagaId = `${pid}-saga`, passed: string[] = [];
  const cal = defaultWorldCalendar('Saga reckoning'); cal.months = [{ name: 'Frost', days: 30 }]; cal.moons = [];
  const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, title: 'Calendar fixture', mode: 'novelist', type: 'standalone', status: 'draft', description: '', color: '#000', enabledEngines: ['timeline','writings'], engineOrder: ['timeline','writings'], createdAt: now, updatedAt: now, ...extra });
  const lane = (id: string, title: string): Timeline => ({ id, projectId: pid, title, color: '#c4973b', createdAt: now, updatedAt: now });
  const first = lane(`${pid}-first`, 'The northern dynasty'), second = lane(`${pid}-second`, 'The old kingdom');
  await db.projects.bulkAdd([project(sagaId, { type: 'saga', worldCalendar: cal }), project(pid, { parentId: sagaId })]);
  await db.timelines.bulkAdd([first, second]);
  const host = document.getElementById('root')!; let root: Root | null = null;
  const unmount = async () => { await act(async () => { root?.unmount(); root = null; await pause(); }); };
  const render = async (node: React.ReactNode, query = '') => { await unmount(); await act(async () => { root = createRoot(host); root.render(<StrictMode><MemoryRouter initialEntries={[`/project/${pid}/timeline${query}`]}>{node}</MemoryRouter></StrictMode>); await pause(100); }); };
  const wait = async (what: string, predicate: () => boolean | Promise<boolean>) => { const until = Date.now()+10000; while (Date.now()<until) { if (await predicate()) return; await act(async () => { await pause(50); }); } throw new Error(`Timed out: ${what}`); };
  const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label);
  const click = async (node: HTMLElement | undefined | null) => { assert(node, 'Missing click target'); await act(async () => { node.click(); await pause(50); }); };
  const type = async (node: HTMLInputElement, value: string) => { await act(async () => { input(node,value); }); };
  try {
    const cyclical = { ...cal, eras: [{name:'Dawn',abbr:'D',startYear:1,yearZero:true},{name:'Ash',abbr:'A',startYear:11,yearZero:true},{name:'Return',abbr:'R',startYear:31,yearZero:true}] };
    assert(!validateWorldCalendar(cyclical).length, 'Cyclical calendar invalid');
    for (const year of [-4,0,1,10,11,30,31,100]) {
      const date = {year,month:1,day:4};
      assert(parseWorldDate(cyclical,formatWorldDate(cyclical,date))?.year === year, 'Zero-based era roundtrip failed');
      assert(fromDayNumber(cyclical,toDayNumber(cyclical,date)).year === year, 'Era presentation changed absolute day math');
    }
    assert(eraOf(cyclical,11).year===0 && eraOf(cyclical,10).year===9 && parseWorldDate(cyclical,'10 D')===null, 'Era boundary not respected');
    assert(parseWorldDate({...cyclical,allowNegativeYears:false},'-1 D')===null && parseWorldDate({...cyclical,allowNegativeYears:false},'0 D')?.year===1, 'First-era date domain invalid');
    passed.push('zero-based eras: chronological day roundtrips, era boundaries and optional first-era date domain preserve legacy arithmetic');

    await render(<TimelineEngine projectId={pid} />);
    await wait('timeline settings entry', () => !!id('timeline-settings-open'));
    await click(id('timeline-settings-open'));
    await wait('scoped settings', () => !!id('world-calendar-editor'));
    const editor = () => id('world-calendar-editor')!;
    const own = () => [...editor().querySelectorAll('label')].find(label=>label.textContent?.includes(t('timeline.settings.independent')))!.querySelector<HTMLInputElement>('input')!;
    assert(!own().checked && editor().querySelector('#wc-name')!.matches(':disabled'), 'Inherited calendar silently became independently editable');
    const rangeInput = (label:string) => editor().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await type(rangeInput(t('timeline.settings.fromYear')),'1'); await type(rangeInput(t('timeline.settings.toYear')),'12');
    await click(id('world-calendar-save'));
    await wait('range stored', async () => (await db.timelines.get(first.id))?.yearRange?.end===12);
    assert(!(await db.timelines.get(first.id))!.worldCalendar, 'Changing view bounds accidentally detached saga inheritance');
    await click(id('timeline-settings-open')); await wait('reopened scope',()=>!!id('world-calendar-editor'));
    await click(own()); await type(editor().querySelector<HTMLInputElement>('#wc-name')!,'Dynastic cycle');
    await type(editor().querySelector<HTMLInputElement>('#wc-hours')!,'30');
    await type(editor().querySelector<HTMLInputElement>(`input[aria-label="${t('timeline.world.monthDays').replace('{n}','1')}"]`)!,'15');
    await click([...editor().querySelectorAll('label')].find(label=>label.textContent?.includes(t('timeline.settings.yearZero')))!.querySelector('input'));
    await click(button(t('timeline.world.addEra'),editor()));
    const duration = [...editor().querySelectorAll('label')].find(label=>label.textContent?.includes(t('timeline.settings.duration')))!.querySelector<HTMLInputElement>('input')!;
    await type(duration,'10');
    await click(id('world-calendar-save'));
    await wait('independent calendar saved',async ()=>(await db.timelines.get(first.id))?.worldCalendar?.name==='Dynastic cycle');
    const ownCalendar = (await resolveWorldCalendar(pid,first.id))!;
    assert(ownCalendar.ownerTimelineId===first.id && ownCalendar.calendar.hoursPerDay===30 && ownCalendar.calendar.eras[1].startYear===11 && ownCalendar.calendar.eras[0].yearZero, 'Actual calendar controls lost era duration/zero/hours');
    assert((await resolveWorldCalendar(pid,second.id))!.ownerProjectId===sagaId && (await resolveWorldCalendar(pid))!.calendar.name===cal.name, 'Override changed other timelines or manuscript calendar');
    passed.push('actual scope UI: range edits preserve inheritance; explicit own calendar persists month length, 30h day, zero-based era and duration');

    const created = await whCreateEvent({projectId:pid,timelineId:first.id,title:'The northern signal',dateMode:'world',worldDate:'3 Frost 0 CE',time:'25:30'}) as {id:string};
    let event = (await db.timelineEvents.get(created.id))!;
    assert(event.worldDate?.year===1 && event.time==='25:30', 'MCP used saga instead of timeline calendar');
    let failed=false;
    try { await whCreateEvent({projectId:pid,timelineId:second.id,title:'Impossible hour',dateMode:'world',worldDate:'3 Frost 1 CE',time:'25:30'}); } catch {failed=true;}
    assert(failed, 'Inherited 24h timeline accepted another timeline 30h clock');
    const dateInfo=await whWorldDate({projectId:pid,timelineId:first.id,date:'3 Frost 0 CE'}) as {calendar:string};
    assert(dateInfo.calendar==='Dynastic cycle' && (await whWorldCalendarGet({projectId:pid,timelineId:first.id}) as {ownerTimelineId:string}).ownerTimelineId===first.id, 'Scoped MCP calendar/date reads ignored override');
    await unmount();
    await render(<TimelineView projectId={pid} timelineId={first.id} events={[event]} onAddEvent={()=>{}} onEditEvent={()=>{}} onDeleteEvent={()=>{}} />,`?entity=${event.id}`);
    await wait('scoped event deep-link form',()=>!!id('world-date-start'));
    assert((id('world-date-start') as HTMLInputElement).value==='3 Frost 0 CE' && (id('world-date-start') as HTMLInputElement).getAttribute('aria-invalid') !== 'true', 'List editor opened in wrong calendar');
    await unmount();
    const old = await db.timelines.get(first.id);
    failed=false;
    try { await saveTimelineSettings(pid,first.id,{worldCalendar:{...ownCalendar.calendar,hoursPerDay:24},yearRange:{start:2,end:5}}); } catch {failed=true;}
    assert(failed && JSON.stringify(await db.timelines.get(first.id))===JSON.stringify(old), 'Invalid clock/calendar change partially persisted bounds');
    failed=false; try { await saveTimelineSettings(pid,first.id,{worldCalendar:undefined}); } catch {failed=true;}
    assert(failed, 'Removing override silently invalidated existing clock');
    passed.push('scoped date flows: actual deep-link form and MCP accept local clocks; incompatible calendar edits/removal fail atomically');

    const updatedSaga={...cal,name:'New saga name',months:[{name:'Thaw',days:30}]};
    await db.projects.update(sagaId,{worldCalendar:updatedSaga});
    assert((await resolveWorldCalendar(pid,second.id))!.calendar.months[0].name==='Thaw' && (await resolveWorldCalendar(pid,first.id))!.calendar.months[0].name==='Frost', 'Saga changes crossed timeline override boundary');
    await whWorldCalendarSet({projectId:pid,calendar:{...cal,name:'Child calendar',months:[{name:'Harvest',days:2}]}});
    assert((await resolveWorldCalendar(pid,first.id))!.calendar.months[0].days===15, 'Setting project calendar incorrectly validated/changed overridden events');
    await whWorldCalendarSet({projectId:pid,timelineId:first.id,calendar:{...ownCalendar.calendar,months:[{name:'Aurora',days:15}]}});
    event=(await db.timelineEvents.get(created.id))!;
    const listed=await whListEvents({projectId:pid,timelineId:first.id}) as {events:Array<{date:string}>};
    const bible=buildWorldBible(await loadBibleData(pid),{sections:['timeline'],locale:'en'});
    const exported=await loadWorldDoc(pid);
    assert(listed.events[0].date.includes('Aurora') && bible.html.includes('Aurora') && exported.doc.events?.[0].date.includes('Aurora'), 'Shared export/read labels ignored timeline calendar');
    passed.push('inheritance and readers: saga/project changes preserve overrides; live labels agree across MCP, world bible and local world exchange');

    await saveTimelineSettings(pid,first.id,{yearRange:{start:2,end:5},displayPrecision:'year'});
    assert(!eventWithinYearRange(event,{start:2,end:5}) && eventWithinYearRange({...event,worldDateEnd:{year:3}},{start:2,end:5}), 'Range inclusion mishandles outside events/spanning ages');
    assert(!compactTimelineLabel(event,(await resolveWorldCalendar(pid,first.id))!.calendar,'year').includes('25:30'), 'Year precision leaked clock');
    await render(<TimelineEngine projectId={pid}/>);
    await wait('range inspector',()=>!!id('timeline-range-note'));
    assert(![...document.querySelectorAll('svg [role="button"]')].some(node=>node.getAttribute('aria-label')?.includes(event.title)), 'Outside-range event still rendered');
    assert((await db.timelineEvents.get(event.id))?.time==='25:30', 'Range/precision destroyed original date');
    await click(button(t('timeline.settings.allYears')));
    await wait('event returns after range reset',()=>[...document.querySelectorAll('svg [role="button"]')].some(node=>node.getAttribute('aria-label')?.includes(event.title)));
    passed.push('reversible year views: out-of-range events remain stored, crossing ages included, precision only affects compact display, reset reveals event');
    await unmount();
    const archive=await createProjectZipArchive(pid);
    const expected=(await db.timelines.get(first.id))!;
    await db.timelines.update(first.id,{worldCalendar:undefined,displayPrecision:undefined});
    await importProjectZip(new File([archive.blob],'timeline-scopes.zip'),{replaceProjectIds:[pid]});
    assert(JSON.stringify((await db.timelines.get(first.id))!.worldCalendar)===JSON.stringify(expected.worldCalendar) && (await db.timelines.get(first.id))!.displayPrecision==='year', 'Actual ZIP restore dropped calendar/precision');
    passed.push('real ZIP restore preserves independent timeline calendar and view precision');
    return passed;
  } finally { await unmount(); await db.timelineEvents.where('projectId').equals(pid).delete(); await db.timelines.where('projectId').equals(pid).delete(); await db.projects.bulkDelete([pid,sagaId]); }
}

export async function previewTimelineScopes() {
  useLocaleStore.setState({locale:'en'});
  const now=Date.now(),pid='timeline-scope-preview';
  const calendar=defaultWorldCalendar('Dynastic reckoning');
  calendar.months=[{name:'Frostwane',days:24},{name:'Thawrise',days:20},{name:'Suncrest',days:30}]; calendar.hoursPerDay=30;
  calendar.eras=[{name:'The First Dynasty',abbr:'FD',startYear:1,yearZero:true},{name:'The Ember Dynasty',abbr:'ED',startYear:121,yearZero:true}];
  await db.projects.put({id:pid,title:'The Cartographer’s Debt',description:'',mode:'novelist',type:'standalone',color:'#c4973b',status:'draft',enabledEngines:['timeline'],engineOrder:['timeline'],worldCalendar:defaultWorldCalendar('Common reckoning'),createdAt:now,updatedAt:now});
  await db.timelines.bulkPut([{id:'scope-preview-first',projectId:pid,title:'The northern dynasty',color:'#c4973b',worldCalendar:calendar,yearRange:{start:1,end:240},displayPrecision:'day',createdAt:now,updatedAt:now},{id:'scope-preview-second',projectId:pid,title:'The old kingdom',color:'#3b82f6',createdAt:now,updatedAt:now}]);
  const host=document.getElementById('root')!;
  createRoot(host).render(<MemoryRouter><TimelineEngine projectId={pid}/></MemoryRouter>);
  for(let i=0;i<40&&!id('timeline-settings-open');i++) await pause(50);
  id('timeline-settings-open')?.click(); await pause(250);
}
