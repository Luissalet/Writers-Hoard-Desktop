// What the board's assets rail hands the board: the drag type it puts a
// picture under, and the picture itself as a file the board's upload path takes.
export const BOARD_ASSET_MIME = 'application/x-wh-board-asset';

export const imageFile = async (dataUrl: string, name: string) => { const blob = await (await fetch(dataUrl)).blob(); return new File([blob], name || 'imagen', { type: blob.type || 'image/png' }); };
