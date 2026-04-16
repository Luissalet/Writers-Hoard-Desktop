import { useRef } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Library, Lightbulb, Layers, Trash2, Palette } from 'lucide-react';
import { InlineIconPicker, resolveIcon } from '@/components/common/IconPicker';
import type { Project } from '@/types';

const typeIcons = {
  saga: Library,
  standalone: BookOpen,
  collection: Layers,
  idea: Lightbulb,
};

const statusColors = {
  draft: 'bg-text-dim',
  'in-progress': 'bg-accent-amber',
  completed: 'bg-success',
};

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
  onDelete: () => void;
  onColorChange?: (color: string) => void;
  onIconChange?: (icon: string) => void;
  index: number;
}

export default function ProjectCard({ project, onClick, onDelete, onColorChange, onIconChange, index }: ProjectCardProps) {
  const CustomIcon = resolveIcon(project.icon);
  const Icon = CustomIcon || typeIcons[project.type] || BookOpen;
  const colorInputRef = useRef<HTMLInputElement>(null);

  return (
    <motion.div
      className="relative group cursor-pointer"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      whileHover={{ y: -4 }}
      onClick={onClick}
    >
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-surface hover:border-accent-gold/50 transition-all duration-300 animate-pulse-gold"
        style={{
          background: `linear-gradient(135deg, ${project.color}15 0%, var(--color-surface) 50%, var(--color-deep) 100%)`,
        }}
      >
        {/* Glow effect */}
        <div
          className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition"
          style={{ backgroundColor: project.color }}
        />

        <div className="relative p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: `${project.color}25` }}
            >
              <Icon size={24} style={{ color: project.color }} />
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${statusColors[project.status]}`} />
              <span className="text-[10px] text-text-dim uppercase tracking-wider">{project.status}</span>
            </div>
          </div>

          {/* Content */}
          <h3 className="font-serif font-bold text-lg text-text-primary mb-1 group-hover:text-accent-gold transition">
            {project.title}
          </h3>
          <p className="text-sm text-text-muted line-clamp-2 mb-4">
            {project.description || 'No description yet'}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-dim capitalize px-2 py-1 bg-elevated rounded">
              {project.type}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              {onIconChange && (
                <InlineIconPicker
                  value={project.icon}
                  onChange={onIconChange}
                  color={project.color}
                />
              )}
              {onColorChange && (
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); colorInputRef.current?.click(); }}
                    className="p-1.5 rounded-lg hover:bg-accent-gold/20 transition"
                    title="Change color"
                  >
                    <Palette size={14} className="text-accent-gold" />
                  </button>
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={project.color}
                    onChange={(e) => { e.stopPropagation(); onColorChange(e.target.value); }}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute opacity-0 w-0 h-0 pointer-events-none"
                    tabIndex={-1}
                  />
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1.5 rounded-lg hover:bg-danger/20 transition"
              >
                <Trash2 size={14} className="text-danger" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
