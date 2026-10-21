import type {Project,CodexEntry,WorldMap,MapPin,Timeline,TimelineEvent} from '@/types';
import type {Board,BoardNode} from '@/engines/board/types';
import type {LocalMediaAsset} from '@/engines/media/types';
import type {ResolvedWorldCalendar} from '@/engines/timeline/worldCalendarStore';
import type {EraDocument,EraDocumentKind} from '@/services/worldEras/types';
export interface ReaderSourceRows{codexEntries:CodexEntry;localMediaAssets:LocalMediaAsset;worldMaps:WorldMap;mapPins:MapPin;boards:Board;boardNodes:BoardNode;timelines:Timeline;timelineEvents:TimelineEvent}
/** Only the data consumed by the existing standalone Reader renderer. No live fallback. */
export interface ReaderSource{
 readonly project:Project;
 rows<K extends keyof ReaderSourceRows>(table:K):ReaderSourceRows[K][];
 calendar(timelineId?:string):ResolvedWorldCalendar|null;
 /** Optional on legacy snapshots; never fall back to live data when absent. */
 documents?(kind:EraDocumentKind):EraDocument[];
}
