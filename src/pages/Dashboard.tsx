import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Feather, Upload, Download, Database } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import ProjectCard from '@/components/bubbles/ProjectCard';
import EmptyState from '@/components/common/EmptyState';
import TopBar from '@/components/layout/TopBar';
import CreateProjectModal from '@/components/dashboard/CreateProjectModal';
import { importProjectData, importFullDatabase } from '@/db/operations';
import { exportFullZip, importFullZip } from '@/services/zipBackup';
import { useTranslation } from '@/i18n/useTranslation';
import type { Project } from '@/types';

export default function Dashboard() {
  const { t } = useTranslation();
  const { projects, loading, addProject, editProject, removeProject, refresh } = useProjects();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const fullImportRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);


  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const newId = await importProjectData(data);
      await refresh();
      navigate(`/project/${newId}`);
    } catch (err) {
      console.error('Import failed:', err);
      alert(t('dashboard.import.error'));
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  const handleFullExport = async () => {
    setExporting(true);
    try {
      await exportFullZip();
    } catch (err) {
      console.error('Full export failed:', err);
      alert(t('dashboard.export.error'));
    } finally {
      setExporting(false);
    }
  };

  const handleFullImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(t('dashboard.fullImport.confirm'))) {
      if (fullImportRef.current) fullImportRef.current.value = '';
      return;
    }
    setImporting(true);
    try {
      if (file.name.endsWith('.zip')) {
        // Structured ZIP backup
        await importFullZip(file);
        await refresh();
        window.location.reload();
      } else if (file.name.endsWith('.json')) {
        // Legacy JSON backup
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.fullExport) {
          await importFullDatabase(data);
          await refresh();
          window.location.reload();
        } else {
          const newId = await importProjectData(data);
          await refresh();
          navigate(`/project/${newId}`);
        }
      } else {
        alert(t('dashboard.unsupportedFormat'));
      }
    } catch (err) {
      console.error('Full import failed:', err);
      alert(t('dashboard.import.fullError'));
    } finally {
      setImporting(false);
      if (fullImportRef.current) fullImportRef.current.value = '';
    }
  };

  const handleCreate = async (project: Project) => {
    await addProject(project);
    navigate(`/project/${project.id}`);
  };

  return (
    <>
      <TopBar title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      <div className="flex-1 overflow-y-auto p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold text-accent-gold">{t('dashboard.projects')}</h1>
            <p className="text-text-muted mt-1">
              {projects.length} {projects.length === 1 ? t('dashboard.worldCount.singular') : t('dashboard.worldCount.plural')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <input ref={fullImportRef} type="file" accept=".zip,.json" className="hidden" onChange={handleFullImport} />

            {/* Full backup controls */}
            <button
              onClick={handleFullExport}
              disabled={exporting}
              className="flex items-center gap-2 px-3 py-2.5 border border-accent-plum/30 text-accent-plum-light rounded-xl hover:bg-accent-plum/10 transition text-sm"
              title={t('dashboard.fullExport.title')}
            >
              <Database size={14} />
              <Download size={14} />
              {exporting ? t('dashboard.fullExport.exporting') : t('dashboard.fullExport.button')}
            </button>
            <button
              onClick={() => fullImportRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-3 py-2.5 border border-accent-plum/30 text-accent-plum-light rounded-xl hover:bg-accent-plum/10 transition text-sm"
              title={t('dashboard.fullImport.title')}
            >
              <Database size={14} />
              <Upload size={14} />
              {importing ? t('dashboard.fullImport.restoring') : t('dashboard.fullImport.button')}
            </button>

            <div className="w-px h-8 bg-border" />

            <button
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2.5 border border-border text-text-muted rounded-xl hover:text-text-primary hover:bg-elevated transition"
            >
              <Upload size={16} />
              {importing ? t('dashboard.import.importing') : t('dashboard.import.button')}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent-gold text-deep font-semibold rounded-xl hover:bg-accent-amber transition shadow-lg shadow-accent-gold/20"
            >
              <Plus size={18} />
              {t('dashboard.newProject')}
            </button>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-accent-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<Feather size={48} />}
            title={t('dashboard.empty.title')}
            message={t('dashboard.empty.message')}
            action={{ label: t('dashboard.empty.action'), onClick: () => setShowCreate(true) }}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {projects.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={i}
                onClick={() => navigate(`/project/${project.id}`)}
                onDelete={() => removeProject(project.id)}
                onColorChange={(color) => editProject(project.id, { color })}
                onIconChange={(icon) => editProject(project.id, { icon: icon || undefined })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />
    </>
  );
}
