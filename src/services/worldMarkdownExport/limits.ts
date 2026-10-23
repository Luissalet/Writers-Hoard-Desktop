// Memory guards of the media part of the vault. JSZip keeps every file in memory until the archive is
// packed, so one huge sound or a whole library of videos must not be able to take the window down.
const MB = 1024 * 1024;
/** A single picture, sound or video over this is left out, with a warning. */
export const MEDIA_FILE_LIMIT_BYTES = 200 * MB;
/** Once the media written reaches this, no more media is added (the rest is listed as left out). */
export const MEDIA_TOTAL_LIMIT_BYTES = 1024 * MB;
/** With media on, an estimate above this asks the person to confirm before exporting. */
export const MEDIA_CONFIRM_BYTES = 500 * MB;
export interface MediaLimits { perFile: number; total: number }
