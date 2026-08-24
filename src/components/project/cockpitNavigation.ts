export type CockpitTab =
  | 'overview'
  | 'health'
  | 'entities'
  | 'spine'
  | 'intelligence'
  | 'assets'
  | 'workflows'
  | 'research'
  | 'templates'
  | 'publishing'
  | 'ai';

export type CockpitGroupId = 'supervise' | 'develop' | 'produce' | 'prepare';
export type CockpitToolTab = 'workflows' | 'research' | 'templates' | 'publishing' | 'ai';

export interface CockpitGroup {
  id: CockpitGroupId;
  labelKey: string;
  defaultTab: CockpitTab;
  tabs: readonly CockpitTab[];
}

export const COCKPIT_TAB_LABEL_KEYS: Record<CockpitTab, string> = {
  overview: 'projectCockpit.tabs.overview',
  health: 'projectCockpit.tabs.health',
  entities: 'projectCockpit.tabs.entities',
  spine: 'projectCockpit.tabs.spine',
  intelligence: 'projectCockpit.tabs.intelligence',
  assets: 'projectCockpit.tabs.assets',
  workflows: 'projectCockpit.tabs.workflows',
  research: 'projectCockpit.tabs.research',
  templates: 'projectCockpit.tabs.templates',
  publishing: 'projectCockpit.tabs.publishing',
  ai: 'projectCockpit.tabs.ai',
};

export const COCKPIT_GROUPS: readonly CockpitGroup[] = [
  {
    id: 'supervise',
    labelKey: 'projectCockpit.groups.supervise',
    defaultTab: 'overview',
    tabs: ['overview', 'health', 'intelligence'],
  },
  {
    id: 'develop',
    labelKey: 'projectCockpit.groups.develop',
    defaultTab: 'entities',
    tabs: ['entities', 'spine', 'ai'],
  },
  {
    id: 'produce',
    labelKey: 'projectCockpit.groups.produce',
    defaultTab: 'workflows',
    tabs: ['workflows', 'research', 'assets'],
  },
  {
    id: 'prepare',
    labelKey: 'projectCockpit.groups.prepare',
    defaultTab: 'templates',
    tabs: ['templates', 'publishing'],
  },
];

const COCKPIT_TABS = new Set<CockpitTab>(
  COCKPIT_GROUPS.flatMap((group) => group.tabs),
);
const COCKPIT_TOOL_TABS = new Set<CockpitTab>([
  'workflows',
  'research',
  'templates',
  'publishing',
  'ai',
]);

export function isCockpitTab(value: string | null): value is CockpitTab {
  return value !== null && COCKPIT_TABS.has(value as CockpitTab);
}

export function resolveCockpitTab(value: string | null): CockpitTab {
  return isCockpitTab(value) ? value : 'overview';
}

export function isCockpitToolTab(tab: CockpitTab): tab is CockpitToolTab {
  return COCKPIT_TOOL_TABS.has(tab);
}

export function getCockpitGroup(tab: CockpitTab): CockpitGroup {
  return COCKPIT_GROUPS.find((group) => group.tabs.includes(tab)) ?? COCKPIT_GROUPS[0];
}
