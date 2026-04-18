import { useMemo } from 'react';
import { Copy, Download } from 'lucide-react';
import type { BiographyFact } from '../types';
import { BIOGRAPHY_CATEGORIES } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface NarrativeViewProps {
  facts: BiographyFact[];
  subjectName: string;
}

export default function NarrativeView({ facts, subjectName }: NarrativeViewProps) {
  const { t } = useTranslation();
  // Group facts chronologically, with special handling for birth/death
  const narrativeGroups = useMemo(() => {
    const groups: Array<{ title: string; items: BiographyFact[] }> = [];

    // Birth first
    const birthFacts = facts.filter(f => f.category === 'birth');
    if (birthFacts.length > 0) {
      groups.push({ title: 'Early Life', items: birthFacts });
    }

    // Chronologically ordered other facts
    const chronologicalFacts = facts
      .filter(f => f.category !== 'birth' && f.category !== 'death')
      .sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
      });

    if (chronologicalFacts.length > 0) {
      groups.push({ title: 'Life Events', items: chronologicalFacts });
    }

    // Death last
    const deathFacts = facts.filter(f => f.category === 'death');
    if (deathFacts.length > 0) {
      groups.push({ title: 'Legacy', items: deathFacts });
    }

    return groups;
  }, [facts]);

  const narrativeText = useMemo(() => {
    let text = `Biography of ${subjectName}\n\n`;

    narrativeGroups.forEach(group => {
      text += `${group.title}\n`;
      text += '─'.repeat(group.title.length) + '\n\n';

      group.items.forEach(fact => {
        if (fact.date) {
          text += `[${fact.date}${fact.endDate ? ` – ${fact.endDate}` : ''}] `;
        }
        text += `${fact.title}\n`;
        text += fact.content.replace(/<[^>]*>/g, '') + '\n\n';

        if (fact.sources.length > 0) {
          text += 'Sources:\n';
          fact.sources.forEach(source => {
            text += `  • ${source.description}`;
            if (source.url) text += ` (${source.url})`;
            text += '\n';
          });
          text += '\n';
        }
      });
    });

    return text;
  }, [narrativeGroups, subjectName]);

  const handleCopy = () => {
    navigator.clipboard.writeText(narrativeText);
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const file = new Blob([narrativeText], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${subjectName.replace(/\s+/g, '-')}-biography.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface text-text-muted hover:text-text-primary rounded-lg text-sm font-medium transition"
          title={t('biography.copyToClipboard')}
        >
          <Copy size={14} />
          Copy
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface text-text-muted hover:text-text-primary rounded-lg text-sm font-medium transition"
          title={t('biography.downloadText')}
        >
          <Download size={14} />
          Export
        </button>
      </div>

      {/* Narrative content */}
      <div className="bg-surface/50 border border-border rounded-xl p-6">
        {narrativeGroups.length === 0 ? (
          <p className="text-text-muted text-center py-8">
            No facts to display. Add some facts to generate a narrative.
          </p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none space-y-6">
            <h1 className="text-2xl font-serif font-bold text-text-primary">
              Biography of {subjectName}
            </h1>

            {narrativeGroups.map((group, groupIdx) => (
              <div key={groupIdx}>
                <h2 className="text-xl font-serif font-semibold text-accent-gold border-b border-border/50 pb-2 mb-4">
                  {group.title}
                </h2>

                <div className="space-y-4">
                  {group.items.map((fact, itemIdx) => {
                    const category = BIOGRAPHY_CATEGORIES[fact.category];
                    return (
                      <div key={itemIdx} className="border-l-2 border-accent-gold/30 pl-4">
                        {fact.date && (
                          <div className="text-sm text-text-muted font-semibold mb-1">
                            {fact.date}
                            {fact.endDate && ` – ${fact.endDate}`}
                          </div>
                        )}

                        <h3 className="text-lg font-serif font-bold text-text-primary mb-2">
                          {fact.title}
                        </h3>

                        <div
                          className="text-sm text-text-muted leading-relaxed mb-3"
                          dangerouslySetInnerHTML={{ __html: fact.content }}
                        />

                        <div className="flex items-center gap-2 text-xs text-text-dim">
                          <span className={`inline-block w-2 h-2 rounded-full bg-gradient-to-r ${category.color}`} />
                          {category.label}

                          {fact.sources.length > 0 && (
                            <>
                              <span>•</span>
                              <span>{fact.sources.length} source{fact.sources.length !== 1 ? 's' : ''}</span>
                            </>
                          )}
                        </div>

                        {fact.sources.length > 0 && (
                          <div className="mt-2 text-xs text-text-dim space-y-1">
                            {fact.sources.map((source, srcIdx) => (
                              <div key={srcIdx}>
                                <span className="text-text-muted">{source.description}</span>
                                {source.url && (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent-gold hover:text-accent-amber ml-1"
                                  >
                                    link
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
