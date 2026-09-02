import {
  Building,
  Building2,
  Castle,
  Flag,
  Home,
  Landmark,
  LayoutGrid,
  Map,
  MapPin,
  Route,
  Signpost,
  Trees,
  type LucideIcon,
} from 'lucide-react';
import type { AtlasPlaceKind } from '../types';

/**
 * One icon and one colour per kind of place, for the map's pins. The colours
 * are the theme's accents and yarn colours (see `src/index.css`) so the pins
 * read as part of the app and not as a foreign widget; the icons are the
 * same lucide set the fictional-map engine uses for its pins.
 */
export const KIND_STYLE: Record<AtlasPlaceKind, { icon: LucideIcon; color: string }> = {
  country: { icon: Flag, color: '#c4973b' },
  region: { icon: Map, color: '#9b7ed8' },
  city: { icon: Building2, color: '#e4a853' },
  town: { icon: Building, color: '#d4a843' },
  village: { icon: Home, color: '#4a9e6d' },
  district: { icon: LayoutGrid, color: '#4a7ec4' },
  street: { icon: Signpost, color: '#8a8690' },
  building: { icon: Castle, color: '#c4463a' },
  landmark: { icon: Landmark, color: '#7c5cbf' },
  natural: { icon: Trees, color: '#3f9c8a' },
  route: { icon: Route, color: '#6f8fc4' },
  other: { icon: MapPin, color: '#e8e5e0' },
};
