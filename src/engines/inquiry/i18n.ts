import { registerLocaleStrings } from '@/i18n/useTranslation';
import en from './locales/en';
import es from './locales/es';

// Imported for its side effect by every module that asks for `inquiry.*` keys
// (the engine view, the report copy and, through it, the bridge tools), so the
// strings are in place before any of them renders or answers.
registerLocaleStrings({ en, es });
