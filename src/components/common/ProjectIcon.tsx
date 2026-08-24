import { createElement, useEffect, useState } from 'react';
import { BookOpen, type LucideIcon, type LucideProps } from 'lucide-react';
import {
  loadFullProjectIconCatalog,
  resolveCuratedProjectIcon,
} from './projectIconCatalog';

interface ProjectIconProps extends LucideProps {
  name?: string;
  fallback?: LucideIcon;
}

/**
 * Renders common project icons synchronously. A persisted icon outside the
 * curated set loads from the complete catalog and replaces the fallback once
 * available, so old projects keep their chosen icon without taxing startup.
 */
export function ProjectIcon({ name, fallback = BookOpen, ...props }: ProjectIconProps) {
  const curatedIcon = resolveCuratedProjectIcon(name);
  const [loadedIcon, setLoadedIcon] = useState<{
    name: string;
    icon: LucideIcon | null;
  } | null>(null);

  useEffect(() => {
    if (!name || curatedIcon) return;
    let active = true;
    void loadFullProjectIconCatalog().then(catalog => {
      if (active) setLoadedIcon({ name, icon: catalog[name] ?? null });
    }).catch(error => {
      console.error(`Failed to load persisted project icon "${name}"`, error);
    });
    return () => { active = false; };
  }, [curatedIcon, name]);

  const deferredIcon = loadedIcon && loadedIcon.name === name ? loadedIcon.icon : null;
  return createElement(curatedIcon ?? deferredIcon ?? fallback, props);
}
