import { registerLocaleStrings } from '@/i18n/useTranslation';
import en from './locales/en';
import es from './locales/es';

// Imported for its side effect by the engine view, so the `betaReading.*`
// strings are in place before anything renders.
registerLocaleStrings({ en, es });
