import { BEAT_SHEET_TEMPLATES } from '../types';

interface TemplateSelectorProps {
  onSelectTemplate: (templateId: string | undefined) => void;
}

export default function TemplateSelector({ onSelectTemplate }: TemplateSelectorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary mb-2">
          Choose a Beat Sheet Template
        </h3>
        <p className="text-sm text-text-dim mb-6">
          Start with a proven story structure to guide your writing
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Blank Option */}
        <button
          onClick={() => onSelectTemplate(undefined)}
          className="border-2 border-border rounded-xl p-6 text-left hover:border-accent-gold transition bg-surface/50 hover:bg-surface/80"
        >
          <h4 className="font-semibold text-text-primary mb-2">Blank Outline</h4>
          <p className="text-sm text-text-dim mb-4">
            Start with no predefined structure. Build your own beats from scratch.
          </p>
          <div className="text-xs text-text-dim">Custom</div>
        </button>

        {/* Template Cards */}
        {BEAT_SHEET_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelectTemplate(template.id)}
            className="border-2 border-border rounded-xl p-6 text-left hover:border-accent-gold transition bg-surface/50 hover:bg-surface/80"
          >
            <h4 className="font-semibold text-text-primary mb-2">
              {template.name}
            </h4>
            <p className="text-sm text-text-dim mb-4">
              {template.description}
            </p>
            <div className="text-xs text-accent-gold font-medium">
              {template.beats.length} beats
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
