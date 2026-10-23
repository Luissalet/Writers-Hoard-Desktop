import { CloudFog, Eraser, Eye, EyeOff, Flag, Users } from 'lucide-react';
import type { useMapExploration } from './useMapExploration';
import { mapExplorationCopy } from './mapExplorationCopy';
import { BRUSH_RADIUS_RANGE, MAX_SESSION_LENGTH, SIGHT_RADIUS_RANGE } from './mapExploration';

type Exploration = ReturnType<typeof useMapExploration>;

const chip = (active: boolean) => `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition disabled:opacity-50 ${active ? 'border-accent-gold bg-accent-gold text-deep font-semibold' : 'border-border bg-elevated text-text-muted hover:text-text-primary'}`;

/** The "Fog" strip of the map: brush, reveal/hide all, party marker, trail and the player view. */
export default function MapExplorationPanel({ exp, locale }: { exp: Exploration; locale: 'es' | 'en' }) {
  const copy = mapExplorationCopy[locale];
  const enabled = exp.record?.enabled ?? false;
  const toggleTool = (tool: 'reveal' | 'hide') => {
    if (exp.brush && exp.tool === tool) { exp.setBrush(false); return; }
    exp.setTool(tool); exp.setBrush(true); exp.setPlacing(false);
  };
  return (
    <div data-testid="map-fog-panel" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" data-testid="map-fog-toggle" aria-expanded={exp.open} title={copy.fogHint} className={chip(exp.open)} onClick={() => exp.setOpen(!exp.open)}><CloudFog size={14} aria-hidden="true" />{copy.fog}</button>
        {exp.record && <button type="button" data-testid="map-fog-players" aria-pressed={exp.players} className={chip(exp.players)} onClick={() => exp.setPlayers(!exp.players)}><Users size={14} aria-hidden="true" />{copy.playerView}</button>}
        {exp.record && <span data-testid="map-fog-percent" className="text-xs text-text-dim">{copy.explored.replace('{percent}', String(exp.percent))}</span>}
        {exp.failed && <span role="alert" data-testid="map-fog-error" className="text-xs text-danger">{copy.failed}</span>}
      </div>
      {exp.open && exp.editable && !exp.players && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2">
          <label className="inline-flex items-center gap-2 text-xs text-text-primary"><input type="checkbox" data-testid="map-fog-enabled" className="accent-accent-gold" disabled={exp.busy} checked={enabled} onChange={event => void exp.commit({ kind: 'enabled', value: event.target.checked })} />{copy.fogOn}</label>
          <div className="flex items-center gap-2">
            <button type="button" data-testid="map-fog-reveal" aria-pressed={exp.brush && exp.tool === 'reveal'} className={chip(exp.brush && exp.tool === 'reveal')} onClick={() => toggleTool('reveal')}><Eye size={14} aria-hidden="true" />{copy.reveal}</button>
            <button type="button" data-testid="map-fog-hide" aria-pressed={exp.brush && exp.tool === 'hide'} className={chip(exp.brush && exp.tool === 'hide')} onClick={() => toggleTool('hide')}><EyeOff size={14} aria-hidden="true" />{copy.hide}</button>
            <label className="inline-flex items-center gap-2 text-xs text-text-muted">{copy.brushRadius}<input type="range" data-testid="map-fog-radius" min={BRUSH_RADIUS_RANGE.min} max={30} step={0.5} value={exp.radius} onChange={event => exp.setRadius(Number(event.target.value))} /><output className="w-8 text-text-dim">{exp.radius}</output></label>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" data-testid="map-fog-reveal-all" disabled={exp.busy} className={chip(false)} onClick={() => void exp.commit({ kind: 'brush', ops: [{ op: 'all' }] })}>{copy.revealAll}</button>
            <button type="button" data-testid="map-fog-hide-all" disabled={exp.busy} className={chip(false)} onClick={() => void exp.commit({ kind: 'brush', ops: [{ op: 'none' }] })}>{copy.hideAll}</button>
          </div>
          <div className="flex flex-wrap items-center gap-2" title={copy.partyHint}>
            <button type="button" data-testid="map-party-place" aria-pressed={exp.placing} className={chip(exp.placing)} onClick={() => { exp.setPlacing(!exp.placing); exp.setBrush(false); }}><Flag size={14} aria-hidden="true" />{copy.placeParty}</button>
            <label className="inline-flex items-center gap-2 text-xs text-text-muted">{copy.sight}<input type="range" data-testid="map-party-sight" min={SIGHT_RADIUS_RANGE.min} max={30} step={0.5} value={Math.min(30, exp.sight)} onChange={event => exp.setSight(Number(event.target.value))} /><output className="w-8 text-text-dim">{exp.sight}</output></label>
            <label className="inline-flex items-center gap-2 text-xs text-text-primary"><input type="checkbox" data-testid="map-party-trail" className="accent-accent-gold" checked={exp.trail} onChange={event => exp.setTrail(event.target.checked)} />{copy.leaveTrail}</label>
            <input type="text" data-testid="map-party-session" aria-label={copy.session} placeholder={copy.sessionPlaceholder} maxLength={MAX_SESSION_LENGTH} value={exp.session} onChange={event => exp.setSession(event.target.value)} className="h-8 w-28 rounded-lg border border-border bg-deep px-2 text-xs text-text-primary" />
            {(exp.record?.trail?.length ?? 0) > 0 && <button type="button" data-testid="map-party-clear-trail" disabled={exp.busy} className={chip(false)} onClick={() => void exp.commit({ kind: 'clear-trail' })}><Eraser size={14} aria-hidden="true" />{copy.clearTrail}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
