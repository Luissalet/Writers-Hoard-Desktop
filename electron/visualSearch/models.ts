/** Fixed, compatible512-dimensional CLIP spaces; no remote inference endpoint. */
export const VISION = { id: 'Xenova/clip-vit-base-patch32', revision: 'd15189d7028b43f1d3e65039190477f6af591c2a' };
export const TEXT = { id: 'sentence-transformers/clip-ViT-B-32-multilingual-v1', revision: '58edf8cada9e398793dca955574a48cbb7f18be2' };
export const VISUAL_MODEL = `clip-b32-q8:${VISION.revision}:multilingual-avx2:${TEXT.revision}:mean-dense-v1`;
