export type CommandCenterActionIcon =
  | 'home'
  | 'notes'
  | 'overview'
  | 'health'
  | 'edit'
  | 'publishing'
  | 'engine'
  | 'manage';

export interface CommandCenterProjectContext {
  id: string;
  enabledEngines: string[];
  engineOrder: string[];
}

export interface CommandCenterAction {
  type: 'action';
  id: string;
  key: string;
  labelKey: string;
  detailKey: string;
  keywordsKey: string;
  icon: CommandCenterActionIcon;
  target: string;
  engineId?: string;
}

export interface CommandCenterSearchIdentity {
  type: 'project' | 'entity';
  id: string;
  projectId?: string;
  engineId?: string;
}

function action(
  id: string,
  icon: CommandCenterActionIcon,
  target: string,
  projectId?: string,
): CommandCenterAction {
  return {
    type: 'action',
    id,
    key: `action:${id}${projectId ? `:${projectId}` : ''}`,
    labelKey: `search.commandCenter.action.${id}`,
    detailKey: `search.commandCenter.detail.${id}`,
    keywordsKey: `search.commandCenter.keywords.${id}`,
    icon,
    target,
  };
}

export function getOrderedEnabledEngineIds(
  enabledEngines: string[],
  engineOrder: string[],
): string[] {
  const enabled = [...new Set(enabledEngines)];
  const enabledSet = new Set(enabled);
  const ordered = [...new Set(engineOrder)].filter(engineId => enabledSet.has(engineId));
  const orderedSet = new Set(ordered);
  return [...ordered, ...enabled.filter(engineId => !orderedSet.has(engineId))];
}

export function buildCommandCenterActions(
  project?: CommandCenterProjectContext,
): CommandCenterAction[] {
  const actions = [
    action('home', 'home', '/'),
    action('notes', 'notes', '/notes'),
  ];
  if (!project) return actions;

  const projectBase = `/project/${encodeURIComponent(project.id)}`;
  actions.push(
    action('overview', 'overview', `${projectBase}/overview`, project.id),
    action('review', 'health', `${projectBase}/overview?panel=health`, project.id),
    action('edit', 'edit', `${projectBase}/overview?edit=1`, project.id),
    action('publishing', 'publishing', `${projectBase}/overview?panel=publishing`, project.id),
  );

  for (const engineId of getOrderedEnabledEngineIds(project.enabledEngines, project.engineOrder)) {
    actions.push({
      type: 'action',
      id: `engine:${engineId}`,
      key: `action:engine:${project.id}:${engineId}`,
      labelKey: `engines.${engineId}.name`,
      detailKey: 'search.commandCenter.detail.engine',
      keywordsKey: 'search.commandCenter.keywords.engine',
      icon: 'engine',
      engineId,
      target: `${projectBase}/${encodeURIComponent(engineId)}`,
    });
  }

  actions.push(action('manage', 'manage', `${projectBase}/overview?manage=1`, project.id));
  return actions;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

export function filterCommandCenterActions(
  actions: CommandCenterAction[],
  query: string,
  getSearchText: (action: CommandCenterAction) => string,
): CommandCenterAction[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return actions;
  return actions.filter(item => normalize(getSearchText(item)).includes(normalizedQuery));
}

export function commandCenterSearchKey(result: CommandCenterSearchIdentity): string {
  return result.type === 'project'
    ? `project:${result.id}`
    : `entity:${result.projectId ?? 'unknown'}:${result.engineId ?? 'unknown'}:${result.id}`;
}

export function moveCommandCenterSelection(
  current: number,
  itemCount: number,
  direction: 1 | -1,
): number {
  if (itemCount <= 0) return 0;
  return (current + direction + itemCount) % itemCount;
}
