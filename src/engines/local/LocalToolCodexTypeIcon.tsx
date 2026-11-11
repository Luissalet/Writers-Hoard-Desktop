import { ProjectIcon } from '@/components/common/ProjectIcon';
import { codexTypeColors, codexTypeIcons } from '@/components/codex/codexTypeMeta';
import type { CodexTypeCatalogueRow } from '../codex/typeCatalogue';

export interface LocalToolCodexTypeIconProps {
  type: Pick<CodexTypeCatalogueRow, 'category' | 'icon' | 'color'>;
  size?: number;
  className?: string;
  label?: string;
}

/** Render the effective appearance of a Codex catalogue row. */
export function LocalToolCodexTypeIcon({ type, size = 20, className, label }: LocalToolCodexTypeIconProps) {
  const category = Object.hasOwn(codexTypeIcons, type.category) ? type.category : 'custom';
  return <ProjectIcon
    name={type.icon}
    fallback={codexTypeIcons[category]}
    size={size}
    className={className}
    style={{ color: type.color ?? codexTypeColors[category] }}
    role={label ? 'img' : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : true}
  />;
}
