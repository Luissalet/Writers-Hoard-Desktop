import { useMemo } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useExternalLinks } from './hooks';
import ExternalLinksView from '@/components/links/ExternalLinksView';

export default function LinksEngine({ projectId }: EngineComponentProps) {
  const { items: links, addItem: addLink, removeItem: removeLink, loading } = useExternalLinks(projectId);

  const isLoading = useMemo(() => loading, [loading]);

  if (isLoading) return <EngineSpinner />;

  return <ExternalLinksView projectId={projectId} links={links} onAdd={addLink} onDelete={removeLink} />;
}
