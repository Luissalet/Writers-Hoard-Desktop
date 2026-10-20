import { useEffect, useState } from 'react';
import { decodeDictionaryFont, type DictionaryFont } from './fonts';

/** A face belongs to its mounted native-form view, and is removed even when an
 * old asynchronous load finishes after replacement or unmount. */
export function useDictionaryFont(font: DictionaryFont | undefined) {
  const [loaded, setLoaded] = useState<{ source: DictionaryFont; family?: string; error?: boolean }>();
  useEffect(() => {
    if (!font) return;
    let active = true;
    let face: FontFace | undefined;
    void Promise.resolve().then(async () => {
      const { bytes } = decodeDictionaryFont(font);
      const family = `wh-language-${crypto.randomUUID()}`;
      face = new FontFace(family, bytes.buffer);
      await face.load();
      if (active) { document.fonts.add(face); setLoaded({ source: font, family }); }
    }).catch(() => { if (active) setLoaded({ source: font, error: true }); });
    return () => { active = false; if (face) document.fonts.delete(face); };
  }, [font]);
  return { fontFamily: loaded && loaded.source === font ? loaded.family : undefined, error: loaded && loaded.source === font && loaded.error };
}
