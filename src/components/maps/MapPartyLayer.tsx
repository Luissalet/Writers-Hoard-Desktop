import { Flag } from 'lucide-react';
import type { MapPoint } from '@/types';
import type { useMapExploration } from './useMapExploration';
import { mapExplorationCopy } from './mapExplorationCopy';

type Exploration = ReturnType<typeof useMapExploration>;

/** Pointer capture keeps a drag going outside the picture; a pointer the browser does not know (synthetic events) simply goes without. */
const capture = (element: Element, pointerId: number) => { try { element.setPointerCapture(pointerId); } catch { /* no active pointer to capture */ } };
const release = (element: Element, pointerId: number) => { try { element.releasePointerCapture(pointerId); } catch { /* nothing captured */ } };

/** Trail, party marker and the brush that paints the fog; sits over the pins. */
export default function MapPartyLayer({ exp, toPicture, locale }: { exp: Exploration; toPicture: (clientX: number, clientY: number) => MapPoint | null; locale: 'es' | 'en' }) {
  const copy = mapExplorationCopy[locale];
  const trail = exp.record?.trail ?? [];
  const showTrail = !!exp.record && (exp.record.enabled || exp.open) && trail.length > 0;
  const party = exp.partyAt;
  const draggable = exp.editable && exp.open && !exp.players && !exp.brushActive && !exp.placeActive;
  const sightPercent = exp.sight * 2;

  return (
    <>
      {showTrail && <div data-testid="map-trail" data-steps={trail.length} className="absolute inset-0 pointer-events-none" style={{ position: 'absolute', inset: 0 }}>
        {trail.length > 1 && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true"><polyline points={trail.map(step => `${step.x},${step.y}`).join(' ')} fill="none" stroke="#e4a853" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity=".9" /></svg>}
        {trail.map((step, index) => <span key={index} data-testid={`map-trail-step-${index}`} title={[step.session, new Date(step.at).toLocaleDateString(locale)].filter(Boolean).join(' · ')} className="absolute h-2 w-2 rounded-full border border-black/60 bg-[#e4a853]" style={{ position: 'absolute', left: `${step.x}%`, top: `${step.y}%`, transform: 'translate(-50%, -50%)' }} />)}
      </div>}

      {exp.showParty && party && <>
        {!exp.players && exp.open && <div aria-hidden="true" data-testid="map-party-sight-ring" className="absolute rounded-full border border-dashed border-[#e4a853]/80 pointer-events-none" style={{ position: 'absolute', left: `${party.x}%`, top: `${party.y}%`, width: `${sightPercent}%`, aspectRatio: '1', transform: 'translate(-50%, -50%)' }} />}
        <div
          data-testid="map-party-marker"
          data-x={party.x.toFixed(2)}
          data-y={party.y.toFixed(2)}
          title={copy.partyMarker}
          className={`absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#f3eedf] bg-[#c4463a] shadow-lg shadow-black/60 ${draggable ? 'cursor-move' : 'pointer-events-none'}`}
          style={{ position: 'absolute', left: `${party.x}%`, top: `${party.y}%`, transform: 'translate(-50%, -50%)', touchAction: 'none' }}
          onPointerDown={event => {
            event.stopPropagation();
            if (!draggable || event.button !== 0) return;
            event.preventDefault();
            capture(event.currentTarget, event.pointerId);
            exp.setDrag(party);
          }}
          onPointerMove={event => {
            if (!exp.drag) return;
            event.stopPropagation();
            const at = toPicture(event.clientX, event.clientY);
            if (at) exp.setDrag(at);
          }}
          onPointerUp={event => {
            if (!exp.drag) return;
            event.stopPropagation();
            release(event.currentTarget, event.pointerId);
            const at = toPicture(event.clientX, event.clientY) ?? party, from = exp.record?.party;
            // A click that did not move the marker is not a move.
            if (from && Math.hypot(at.x - from.x, at.y - from.y) < 0.3) exp.setDrag(null);
            else void exp.movePartyTo(at);
          }}
          onPointerCancel={() => exp.setDrag(null)}
          onClick={event => event.stopPropagation()}
        ><Flag size={13} className="text-white" aria-hidden="true" /></div>
      </>}

      {(exp.brushActive || exp.placeActive) && <div
        data-testid={exp.placeActive ? 'map-party-place-layer' : 'map-fog-brush-layer'}
        className="absolute inset-0"
        style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none', zIndex: 20 }}
        onPointerDown={event => {
          event.stopPropagation();
          if (event.button !== 0 || !exp.brushActive) return;
          const at = toPicture(event.clientX, event.clientY);
          if (!at) return;
          event.preventDefault();
          capture(event.currentTarget, event.pointerId);
          exp.beginStroke(at);
        }}
        onPointerMove={event => {
          const at = toPicture(event.clientX, event.clientY);
          if (!at) return;
          if (exp.stroke) { event.stopPropagation(); exp.moveStroke(at); } else exp.setCursor(at);
        }}
        onPointerUp={event => {
          if (!exp.stroke) return;
          event.stopPropagation();
          release(event.currentTarget, event.pointerId);
          void exp.endStroke();
        }}
        onPointerCancel={exp.cancelStroke}
        onPointerLeave={() => exp.setCursor(null)}
        onClick={event => {
          event.stopPropagation();
          if (!exp.placeActive) return;
          const at = toPicture(event.clientX, event.clientY);
          if (at) { exp.setPlacing(false); void exp.movePartyTo(at); }
        }}
      >
        {exp.brushActive && exp.cursor && <div aria-hidden="true" className="pointer-events-none absolute rounded-full border-2" style={{ position: 'absolute', left: `${exp.cursor.x}%`, top: `${exp.cursor.y}%`, width: `${exp.radius * 2}%`, aspectRatio: '1', transform: 'translate(-50%, -50%)', borderColor: exp.tool === 'reveal' ? '#e4a853' : '#9aa3b2', background: 'rgba(255,255,255,.08)' }} />}
      </div>}
    </>
  );
}
