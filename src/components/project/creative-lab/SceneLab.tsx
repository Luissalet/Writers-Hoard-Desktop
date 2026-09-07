import {
  ArrowRight,
  Check,
  FlaskConical,
  GitBranch,
  Scale,
  Trash2,
} from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import {
  SCENE_VARIABLES,
  buildSceneVariantPromotionPreview,
  createSceneVariant,
  normalizeSceneTension,
  toggleSceneComparison,
  updateSceneVariant,
  type SceneLabSource,
  type SceneLabStructuralTarget,
  type SceneVariable,
  type SceneVariant,
  type SceneVariantPromotionPreview,
  type SceneVariantPromotionResult,
} from '@/services/sceneLab';
import { generateId } from '@/utils/idGenerator';
import { getSceneLabCopy, type SceneLabCopy } from './sceneLabCopy';

export interface SceneLabProps {
  projectId: string;
  scenes: readonly SceneLabSource[];
  structuralTargets: readonly SceneLabStructuralTarget[];
  onPromote: (preview: SceneVariantPromotionPreview) => Promise<SceneVariantPromotionResult>;
  initialVariants?: readonly SceneVariant[];
  createVariantId?: () => string;
  now?: () => number;
  locale?: string;
  copy?: SceneLabCopy;
  className?: string;
}

type ComparisonTake = Pick<SceneVariant, 'id' | 'title' | 'intention' | 'tension' | 'voice' | 'text'> & {
  declaredChange?: string;
};

const fieldClass = 'min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none transition placeholder:text-text-dim focus-visible:border-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold/35 disabled:cursor-not-allowed disabled:opacity-60';
const focusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background';

function sourceAsTake(source: SceneLabSource, label: string): ComparisonTake {
  return {
    id: `source:${source.id}`,
    title: label,
    intention: source.intention,
    tension: normalizeSceneTension(source.tension),
    voice: source.voice,
    text: source.text,
  };
}

function variantAsTake(variant: SceneVariant, variableLabel: string): ComparisonTake {
  return {
    id: variant.id,
    title: variant.title,
    intention: variant.intention,
    tension: variant.tension,
    voice: variant.voice,
    text: variant.text,
    declaredChange: `${variableLabel}: ${variant.variable.value}`,
  };
}

function comparisonRows(copy: SceneLabCopy, left: ComparisonTake, right: ComparisonTake) {
  return [
    { label: copy.comparison.declaredChange, left: left.declaredChange ?? '—', right: right.declaredChange ?? '—', long: false },
    { label: copy.comparison.intention, left: left.intention || '—', right: right.intention || '—', long: false },
    { label: copy.comparison.tension, left: copy.editor.tensionValue(left.tension), right: copy.editor.tensionValue(right.tension), long: false },
    { label: copy.comparison.voice, left: left.voice || '—', right: right.voice || '—', long: false },
    { label: copy.comparison.text, left: left.text || '—', right: right.text || '—', long: true },
  ];
}

function targetKey(target: SceneLabStructuralTarget): string {
  return `${target.kind}:${target.entityId}`;
}

function changedFieldLabels(preview: SceneVariantPromotionPreview, copy: SceneLabCopy): string {
  return preview.changedFields.map((field) => field === 'title'
    ? copy.promotion.structuralTitle
    : copy.promotion.structuralDescription).join(', ');
}

export function SceneLab({
  projectId,
  scenes,
  structuralTargets,
  onPromote,
  initialVariants = [],
  createVariantId = () => generateId('scene-variant'),
  now = Date.now,
  locale = 'en',
  copy: injectedCopy,
  className = '',
}: SceneLabProps) {
  const copy = injectedCopy ?? getSceneLabCopy(locale);
  const titleId = useId();
  const statusId = useId();
  const scopedScenes = useMemo(
    () => scenes.filter((scene) => scene.projectId === projectId),
    [projectId, scenes],
  );
  const scopedTargets = useMemo(
    () => structuralTargets.filter((target) => target.projectId === projectId),
    [projectId, structuralTargets],
  );
  const [sceneId, setSceneId] = useState(() => scopedScenes[0]?.id ?? '');
  const selectedScene = scopedScenes.find((scene) => scene.id === sceneId) ?? scopedScenes[0] ?? null;
  const [variable, setVariable] = useState<SceneVariable>('pov');
  const [variableValue, setVariableValue] = useState('');
  const [variantTitle, setVariantTitle] = useState('');
  const [variants, setVariants] = useState<SceneVariant[]>(() => initialVariants
    .filter((variant) => variant.projectId === projectId)
    .map((variant) => ({
      ...variant,
      variable: { ...variant.variable },
      provenance: {
        ...variant.provenance,
        source: { ...variant.provenance.source },
        declaredVariable: { ...variant.provenance.declaredVariable },
      },
    })));
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [creatorError, setCreatorError] = useState('');
  const [promotionError, setPromotionError] = useState('');
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<SceneVariantPromotionPreview | null>(null);
  const [selectedTargetKey, setSelectedTargetKey] = useState(() => scopedTargets[0] ? targetKey(scopedTargets[0]) : '');
  const initialTarget = scopedTargets.find((target) => targetKey(target) === selectedTargetKey) ?? scopedTargets[0] ?? null;
  const [structuralTitle, setStructuralTitle] = useState(() => initialTarget?.title ?? '');
  const [structuralDescription, setStructuralDescription] = useState(() => initialTarget?.description ?? '');

  const sceneVariants = selectedScene
    ? variants.filter((variant) => variant.sourceSceneId === selectedScene.id)
    : [];
  const selectedVariant = sceneVariants.find((variant) => variant.id === selectedVariantId) ?? sceneVariants[0] ?? null;
  const selectedTarget = scopedTargets.find((target) => targetKey(target) === selectedTargetKey) ?? scopedTargets[0] ?? null;
  const compared = comparisonIds
    .map((id) => sceneVariants.find((variant) => variant.id === id))
    .filter((variant): variant is SceneVariant => variant !== undefined);
  const comparisonTakes = selectedScene && compared.length > 0
    ? compared.length === 1
      ? [sourceAsTake(selectedScene, copy.comparison.baseline), variantAsTake(compared[0], copy.variables[compared[0].variable.kind].label)]
      : compared.slice(0, 2).map((variant) => variantAsTake(variant, copy.variables[variant.variable.kind].label))
    : [];

  const chooseScene = (nextSceneId: string) => {
    setSceneId(nextSceneId);
    const firstVariant = variants.find((variant) => variant.sourceSceneId === nextSceneId);
    setSelectedVariantId(firstVariant?.id ?? '');
    setComparisonIds([]);
    setPreview(null);
    setCreatorError('');
    setPromotionError('');
  };

  const createVariant = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedScene || !variableValue.trim()) {
      setCreatorError(copy.creator.missingChange);
      return;
    }
    const created = createSceneVariant({
      id: createVariantId(),
      source: selectedScene,
      variable,
      value: variableValue,
      title: variantTitle,
      createdAt: now(),
    });
    setVariants((current) => [created, ...current]);
    setSelectedVariantId(created.id);
    setComparisonIds([created.id]);
    setVariableValue('');
    setVariantTitle('');
    setCreatorError('');
    setPreview(null);
    if (selectedTarget) {
      setStructuralTitle(created.title);
      setStructuralDescription(created.intention);
    }
  };

  const patchVariant = (changes: Parameters<typeof updateSceneVariant>[1]) => {
    if (!selectedVariant) return;
    const changedAt = now();
    setVariants((current) => current.map((variant) => variant.id === selectedVariant.id
      ? updateSceneVariant(variant, changes, changedAt)
      : variant));
    setPreview(null);
    setPromotionError('');
  };

  const removeVariant = (variantId: string) => {
    setVariants((current) => current.filter((variant) => variant.id !== variantId));
    setComparisonIds((current) => current.filter((id) => id !== variantId));
    if (selectedVariantId === variantId) setSelectedVariantId('');
    setPreview(null);
  };

  const chooseTarget = (key: string) => {
    setSelectedTargetKey(key);
    const target = scopedTargets.find((candidate) => targetKey(candidate) === key);
    if (target) {
      setStructuralTitle(selectedVariant?.title || target.title);
      setStructuralDescription(selectedVariant?.intention || target.description);
    }
    setPreview(null);
    setPromotionError('');
  };

  const reviewPromotion = () => {
    if (!selectedVariant || !selectedTarget) return;
    try {
      const nextPreview = buildSceneVariantPromotionPreview({
        variant: selectedVariant,
        target: selectedTarget,
        title: structuralTitle,
        description: structuralDescription,
      });
      setPreview(nextPreview);
      setPromotionError(nextPreview.canPromote ? '' : copy.promotion.noChange);
    } catch (error) {
      setPromotionError(error instanceof Error ? error.message : copy.promotion.failed);
      setPreview(null);
    }
  };

  const confirmPromotion = async () => {
    if (!preview?.canPromote || !selectedVariant) return;
    setPending(true);
    setPromotionError('');
    try {
      const result = await onPromote(preview);
      const promotedAt = now();
      setVariants((current) => current.map((variant) => variant.id === preview.variantId
        ? {
            ...variant,
            status: 'promoted',
            promotion: {
              branchId: result.branchId,
              ...(result.label ? { label: result.label } : {}),
              promotedAt,
            },
            updatedAt: promotedAt,
          }
        : variant));
      setPreview(null);
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() ? error.message : copy.promotion.failed;
      setPromotionError(`${detail} ${copy.promotion.failed}`);
    } finally {
      setPending(false);
    }
  };

  if (!selectedScene) {
    return (
      <section className={`rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center ${className}`}>
        <FlaskConical className="mx-auto text-text-dim" aria-hidden="true" />
        <p className="mt-3 text-sm text-text-muted">{copy.source.empty}</p>
      </section>
    );
  }

  return (
    <section
      className={`overflow-hidden rounded-xl border border-border bg-background text-text-primary selection:bg-accent-gold/30 selection:text-text-primary ${className}`}
      aria-labelledby={titleId}
      data-testid="scene-lab"
    >
      <header className="flex flex-col gap-4 border-b border-border bg-surface px-4 py-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id={titleId} className="font-serif text-xl font-semibold tracking-[-0.02em]">{copy.header.title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{copy.header.description}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-xs font-medium text-text-muted">
            <span className="mb-1 block">{copy.source.label}</span>
            <select
              value={selectedScene.id}
              onChange={(event) => chooseScene(event.target.value)}
              className={`${fieldClass} min-w-64`}
            >
              {scopedScenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
            </select>
          </label>
          <span className="min-h-11 self-stretch rounded-lg border border-accent-gold/25 bg-accent-gold/10 px-3 py-3 text-center text-xs font-medium text-accent-gold">
            {copy.header.sessionBadge}
          </span>
        </div>
      </header>

      <div className="grid xl:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="border-b border-border bg-surface/55 p-4 xl:border-b-0 xl:border-r">
          <form onSubmit={createVariant} className="space-y-4" aria-describedby={statusId}>
            <div>
              <h3 className="font-serif text-base font-semibold">{copy.creator.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{copy.creator.description}</p>
            </div>
            <label className="block text-xs font-medium text-text-muted">
              <span className="mb-1 block">{copy.creator.variable}</span>
              <select value={variable} onChange={(event) => setVariable(event.target.value as SceneVariable)} className={fieldClass}>
                {SCENE_VARIABLES.map((value) => <option key={value} value={value}>{copy.variables[value].label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-muted">
              <span className="mb-1 block">{copy.creator.change}</span>
              <textarea
                value={variableValue}
                onChange={(event) => setVariableValue(event.target.value)}
                placeholder={copy.variables[variable].placeholder}
                className={`${fieldClass} min-h-24 resize-y`}
              />
              <span className="mt-1 block font-normal text-text-dim">{copy.creator.changeHint}</span>
            </label>
            <label className="block text-xs font-medium text-text-muted">
              <span className="mb-1 block">{copy.creator.variantTitle}</span>
              <input
                value={variantTitle}
                onChange={(event) => setVariantTitle(event.target.value)}
                placeholder={copy.creator.variantTitlePlaceholder}
                className={fieldClass}
              />
            </label>
            <button
              type="submit"
              disabled={!variableValue.trim()}
              className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep transition hover:bg-accent-amber disabled:cursor-not-allowed disabled:opacity-45 ${focusClass}`}
            >
              <FlaskConical size={16} aria-hidden="true" />
              {copy.creator.create}
            </button>
            <p id={statusId} role="status" aria-live="polite" className="min-h-5 text-xs text-danger">{creatorError}</p>
          </form>

          <nav className="mt-6 border-t border-border pt-5" aria-label={copy.variants.title}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">{copy.variants.title}</h3>
              <span className="text-xs tabular-nums text-text-dim">{copy.variants.count(sceneVariants.length)}</span>
            </div>
            {sceneVariants.length === 0 ? (
              <div className="border-y border-dashed border-border py-5">
                <p className="text-sm font-medium">{copy.variants.emptyTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{copy.variants.emptyBody}</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {sceneVariants.map((variant) => {
                  const isSelected = selectedVariant?.id === variant.id;
                  const isCompared = comparisonIds.includes(variant.id);
                  return (
                    <li key={variant.id} className={`rounded-lg border ${isSelected ? 'border-accent-gold/60 bg-elevated' : 'border-border bg-background'}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedVariantId(variant.id);
                          setStructuralTitle(variant.title);
                          setStructuralDescription(variant.intention);
                          setPreview(null);
                          setPromotionError('');
                        }}
                        aria-label={copy.variants.select(variant.title)}
                        aria-current={isSelected ? 'page' : undefined}
                        className={`w-full px-3 pb-2 pt-3 text-left ${focusClass}`}
                      >
                        <span className="block truncate text-sm font-medium">{variant.title}</span>
                        <span className="mt-1 block text-xs text-text-muted">
                          {copy.variables[variant.variable.kind].label}: {variant.variable.value}
                        </span>
                        {variant.promotion && (
                          <span className="mt-1 block text-[11px] text-accent-gold">{copy.variants.promoted(variant.promotion.label)}</span>
                        )}
                      </button>
                      <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
                        <button
                          type="button"
                          aria-pressed={isCompared}
                          onClick={() => setComparisonIds((current) => toggleSceneComparison(current, variant.id))}
                          className={`min-h-9 flex-1 rounded-md px-2 text-xs transition ${focusClass} ${isCompared ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-muted hover:bg-elevated hover:text-text-primary'}`}
                        >
                          {isCompared ? copy.variants.comparing : copy.variants.compare}
                        </button>
                        {variant.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => removeVariant(variant.id)}
                            aria-label={copy.variants.remove(variant.title)}
                            className={`grid size-9 place-items-center rounded-md text-text-dim transition hover:bg-danger/10 hover:text-danger ${focusClass}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        </aside>

        <main className="min-w-0 p-4 sm:p-6">
          {comparisonTakes.length === 2 ? (
            <section aria-labelledby={`${titleId}-comparison`} className="border-b border-border pb-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id={`${titleId}-comparison`} className="font-serif text-base font-semibold">{copy.comparison.title}</h3>
                  <p className="mt-1 text-xs text-text-muted">{copy.comparison.description}</p>
                </div>
                <button type="button" onClick={() => setComparisonIds([])} className={`min-h-10 rounded-lg px-3 text-xs text-text-muted hover:bg-elevated hover:text-text-primary ${focusClass}`}>
                  {copy.comparison.clear}
                </button>
              </div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[42rem] table-fixed border-collapse text-left text-sm">
                  <thead className="bg-surface">
                    <tr>
                      <th scope="col" className="w-36 border-b border-border px-3 py-2 text-xs font-medium text-text-dim"><span className="sr-only">Field</span></th>
                      {comparisonTakes.map((take) => <th key={take.id} scope="col" className="border-b border-l border-border px-3 py-2 font-serif font-semibold">{take.title}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonRows(copy, comparisonTakes[0], comparisonTakes[1]).map((row) => (
                      <tr key={row.label} className="align-top">
                        <th scope="row" className="border-t border-border bg-surface/45 px-3 py-3 text-xs font-medium text-text-muted">{row.label}</th>
                        <td className={`border-l border-t border-border px-3 py-3 ${row.long ? 'whitespace-pre-wrap leading-relaxed text-text-muted' : 'text-text-primary'}`}>{row.left}</td>
                        <td className={`border-l border-t border-border px-3 py-3 ${row.long ? 'whitespace-pre-wrap leading-relaxed text-text-muted' : 'text-text-primary'}`}>{row.right}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="border-b border-dashed border-border pb-6 text-sm text-text-muted">
              <Scale size={18} className="mb-2 text-text-dim" aria-hidden="true" />
              {copy.comparison.choose}
            </div>
          )}

          {selectedVariant ? (
            <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_22rem]">
              <section aria-labelledby={`${titleId}-editor`}>
                <div className="mb-4">
                  <h3 id={`${titleId}-editor`} className="font-serif text-base font-semibold">{copy.editor.title}</h3>
                  <p className="mt-1 text-xs text-text-muted">{selectedVariant.status === 'active' ? copy.editor.sessionOnly : copy.editor.readOnly}</p>
                </div>
                <fieldset disabled={selectedVariant.status !== 'active'} className="space-y-4">
                  <label className="block text-xs font-medium text-text-muted">
                    <span className="mb-1 block">{copy.editor.name}</span>
                    <input value={selectedVariant.title} onChange={(event) => patchVariant({ title: event.target.value })} className={fieldClass} />
                  </label>
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
                    <label className="block text-xs font-medium text-text-muted">
                      <span className="mb-1 block">{copy.editor.intention}</span>
                      <textarea value={selectedVariant.intention} onChange={(event) => patchVariant({ intention: event.target.value })} placeholder={copy.editor.intentionPlaceholder} className={`${fieldClass} min-h-24 resize-y`} />
                    </label>
                    <label className="block text-xs font-medium text-text-muted">
                      <span className="mb-1 flex items-center justify-between gap-2">
                        {copy.editor.tension}
                        <output className="tabular-nums text-text-primary">{selectedVariant.tension}/10</output>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="1"
                        value={selectedVariant.tension}
                        onChange={(event) => patchVariant({ tension: Number(event.target.value) })}
                        aria-valuetext={copy.editor.tensionValue(selectedVariant.tension)}
                        className={`min-h-11 w-full accent-accent-gold ${focusClass}`}
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium text-text-muted">
                    <span className="mb-1 block">{copy.editor.voice}</span>
                    <input value={selectedVariant.voice} onChange={(event) => patchVariant({ voice: event.target.value })} placeholder={copy.editor.voicePlaceholder} className={fieldClass} />
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    <span className="mb-1 block">{copy.editor.text}</span>
                    <textarea value={selectedVariant.text} onChange={(event) => patchVariant({ text: event.target.value })} placeholder={copy.editor.textPlaceholder} className={`${fieldClass} min-h-80 resize-y font-serif text-base leading-7`} />
                  </label>
                </fieldset>
              </section>

              <aside className="border-t border-border pt-5 2xl:border-l 2xl:border-t-0 2xl:pl-6 2xl:pt-0" aria-labelledby={`${titleId}-promotion`}>
                <div className="flex items-center gap-2">
                  <GitBranch size={17} className="text-accent-gold" aria-hidden="true" />
                  <h3 id={`${titleId}-promotion`} className="font-serif text-base font-semibold">{copy.promotion.title}</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-text-muted">{copy.promotion.description}</p>

                {scopedTargets.length === 0 ? (
                  <p className="mt-4 border-y border-dashed border-border py-4 text-sm text-text-muted">{copy.promotion.noTargets}</p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <label className="block text-xs font-medium text-text-muted">
                      <span className="mb-1 block">{copy.promotion.target}</span>
                      <select value={selectedTarget ? targetKey(selectedTarget) : ''} onChange={(event) => chooseTarget(event.target.value)} className={fieldClass}>
                        {scopedTargets.map((target) => (
                          <option key={targetKey(target)} value={targetKey(target)}>
                            {copy.promotion.targetKinds[target.kind]} · {target.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-text-muted">
                      <span className="mb-1 block">{copy.promotion.structuralTitle}</span>
                      <input value={structuralTitle} onChange={(event) => { setStructuralTitle(event.target.value); setPreview(null); }} className={fieldClass} />
                    </label>
                    <label className="block text-xs font-medium text-text-muted">
                      <span className="mb-1 block">{copy.promotion.structuralDescription}</span>
                      <textarea value={structuralDescription} onChange={(event) => { setStructuralDescription(event.target.value); setPreview(null); }} placeholder={copy.promotion.structuralDescriptionPlaceholder} className={`${fieldClass} min-h-32 resize-y`} />
                    </label>
                    <button
                      type="button"
                      onClick={reviewPromotion}
                      disabled={selectedVariant.status !== 'active' || !structuralTitle.trim()}
                      className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-accent-gold/50 px-3 text-sm font-medium text-accent-gold transition hover:bg-accent-gold/10 disabled:cursor-not-allowed disabled:opacity-45 ${focusClass}`}
                    >
                      <Scale size={16} aria-hidden="true" />
                      {copy.promotion.review}
                    </button>
                  </div>
                )}

                <p role="alert" aria-live="assertive" className="mt-3 text-xs leading-relaxed text-danger">{promotionError}</p>
              </aside>

              {preview && (
                <section className="border-t border-accent-gold/35 pt-5 2xl:col-span-2" aria-labelledby={`${titleId}-preview`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 id={`${titleId}-preview`} className="font-serif text-base font-semibold">{copy.promotion.previewTitle}</h3>
                      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{copy.promotion.previewDescription}</p>
                    </div>
                    <span className="rounded-md bg-accent-gold/10 px-2 py-1 text-xs text-accent-gold">
                      {preview.canPromote ? copy.promotion.changedFields(changedFieldLabels(preview, copy)) : copy.promotion.unchanged}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
                    <div className="bg-surface p-4">
                      <h4 className="text-xs font-medium text-text-dim">{copy.promotion.before}</h4>
                      <p className="mt-2 font-medium">{preview.before.title}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">{preview.before.description || '—'}</p>
                    </div>
                    <div className="bg-background p-4">
                      <h4 className="text-xs font-medium text-accent-gold">{copy.promotion.after}</h4>
                      <p className="mt-2 font-medium">{preview.after.title}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">{preview.after.description || '—'}</p>
                    </div>
                  </div>
                  <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-[8rem_1fr]">
                    <dt className="font-medium text-text-dim">{copy.promotion.provenance}</dt>
                    <dd className="text-text-muted">{copy.promotion.provenanceValue(
                      preview.provenance.source.title,
                      copy.variables[preview.provenance.declaredVariable.kind].label,
                      preview.provenance.declaredVariable.value,
                    )}</dd>
                  </dl>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" disabled={pending} onClick={() => setPreview(null)} className={`min-h-11 rounded-lg px-4 text-sm text-text-muted hover:bg-elevated hover:text-text-primary ${focusClass}`}>
                      {copy.promotion.cancel}
                    </button>
                    <button
                      type="button"
                      disabled={pending || !preview.canPromote}
                      onClick={() => void confirmPromotion()}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep transition hover:bg-accent-amber disabled:cursor-not-allowed disabled:opacity-45 ${focusClass}`}
                    >
                      {pending ? <GitBranch size={16} className="animate-pulse" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                      {pending ? copy.promotion.confirming : copy.promotion.confirm}
                      {!pending && <ArrowRight size={15} aria-hidden="true" />}
                    </button>
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="grid min-h-96 place-items-center py-12 text-center">
              <div className="max-w-sm">
                <FlaskConical className="mx-auto text-text-dim" aria-hidden="true" />
                <h3 className="mt-3 font-serif text-base font-semibold">{copy.variants.emptyTitle}</h3>
                <p className="mt-1 text-sm leading-relaxed text-text-muted">{copy.variants.emptyBody}</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

export default SceneLab;
