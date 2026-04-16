import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RotateCw, ZoomIn, ZoomOut, Check, Maximize } from 'lucide-react';

interface ImagePreviewCropProps {
  /** Base64 image source to preview/crop (should be the ORIGINAL, uncropped image) */
  imageSrc: string | null;
  /** Called with the cropped display image AND the original source (non-destructive) */
  onConfirm: (croppedImage: string, originalImage: string) => void;
  /** Called when the user cancels */
  onCancel: () => void;
}

/**
 * Extracts a cropped region from a loaded <img> element using an offscreen canvas.
 * Supports rotation (applied before crop).
 */
function getCroppedCanvas(
  image: HTMLImageElement,
  crop: PixelCrop,
  rotation: number,
  zoom: number,
): string {
  // The crop coordinates from react-image-crop are in the displayed image's pixel space.
  // We need to scale them to the natural image dimensions before extracting.
  const displayedW = image.width;   // CSS layout width
  const displayedH = image.height;  // CSS layout height
  const scaleX = image.naturalWidth / displayedW;
  const scaleY = image.naturalHeight / displayedH;

  // Scale crop coordinates from displayed space to natural image space
  const naturalCrop = {
    x: crop.x * scaleX,
    y: crop.y * scaleY,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
  };

  // Step 1: Draw rotated + zoomed image onto a working canvas
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const scaledW = image.naturalWidth * zoom;
  const scaledH = image.naturalHeight * zoom;
  const rotW = scaledW * cos + scaledH * sin;
  const rotH = scaledW * sin + scaledH * cos;

  const workCanvas = document.createElement('canvas');
  workCanvas.width = rotW;
  workCanvas.height = rotH;
  const wCtx = workCanvas.getContext('2d')!;
  wCtx.translate(rotW / 2, rotH / 2);
  wCtx.rotate(radians);
  wCtx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);

  // Step 2: Extract the crop region (scaled to work canvas coordinates)
  const cropX = naturalCrop.x * zoom;
  const cropY = naturalCrop.y * zoom;
  const cropW = naturalCrop.width * zoom;
  const cropH = naturalCrop.height * zoom;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = cropW;
  outCanvas.height = cropH;
  const oCtx = outCanvas.getContext('2d')!;
  oCtx.drawImage(
    workCanvas,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    cropW,
    cropH,
  );

  return outCanvas.toDataURL('image/jpeg', 0.92);
}

/**
 * WhatsApp-style image preview + crop modal.
 * Freeform crop — drag any corner or edge to reshape the selection.
 * Includes zoom slider and 90° rotation.
 */
export default function ImagePreviewCrop({ imageSrc, onConfirm, onCancel }: ImagePreviewCropProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const [processing, setProcessing] = useState(false);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    imgRef.current = e.currentTarget;
    // Start with a default crop covering most of the image
    const initial: Crop = {
      unit: '%',
      x: 5,
      y: 5,
      width: 90,
      height: 90,
    };
    setCrop(initial);
  }, []);

  const handleConfirm = async () => {
    if (!imageSrc) return;
    if (!imgRef.current || !completedCrop) {
      // No crop made — pass original as both
      onConfirm(imageSrc, imageSrc);
      return;
    }
    setProcessing(true);
    try {
      const cropped = getCroppedCanvas(imgRef.current, completedCrop, rotation, zoom);
      onConfirm(cropped, imageSrc);
    } catch {
      onConfirm(imageSrc, imageSrc);
    } finally {
      setProcessing(false);
    }
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
    setCrop(undefined);
    setCompletedCrop(undefined);
  };

  const handleResetCrop = () => {
    setCrop({ unit: '%', x: 5, y: 5, width: 90, height: 90 });
    setCompletedCrop(undefined);
  };

  return createPortal(
    <AnimatePresence>
      {imageSrc && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/60 border-b border-white/5">
            <button
              onClick={onCancel}
              className="p-2 rounded-lg hover:bg-white/10 transition text-white/70 hover:text-white"
            >
              <X size={22} />
            </button>
            <span className="text-sm font-medium text-white/80">Adjust Image</span>
            <div className="w-10" />
          </div>

          {/* Custom styles for crop handles — gold theme, high visibility on dark backgrounds */}
          <style>{`
            .image-crop-gold {
              --rc-drag-handle-size: 18px;
              --rc-drag-handle-mobile-size: 28px;
              --rc-drag-handle-bg-colour: #d4a843;
              --rc-border-color: rgba(212, 168, 67, 0.9);
              --rc-drag-bar-size: 8px;
            }
            .image-crop-gold .ReactCrop__drag-handle {
              border: 2px solid #fff;
              border-radius: 2px;
              box-shadow: 0 0 4px rgba(0,0,0,0.5);
            }
          `}</style>

          {/* Crop area */}
          <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden p-2">
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              onComplete={(c) => setCompletedCrop(c)}
              className="image-crop-gold"
              style={{ maxHeight: '100%', maxWidth: '100%' }}
            >
              <img
                src={imageSrc}
                alt="Preview"
                onLoad={onImageLoad}
                style={{
                  maxHeight: 'calc(100vh - 140px)',
                  maxWidth: '100%',
                  objectFit: 'contain',
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                }}
              />
            </ReactCrop>
          </div>

          {/* Controls */}
          <div className="px-6 py-4 bg-black/60 border-t border-white/5 space-y-3">
            {/* Zoom slider */}
            <div className="flex items-center gap-3">
              <ZoomOut size={14} className="text-white/40 flex-shrink-0" />
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 h-1 appearance-none bg-white/20 rounded-full outline-none
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-gold [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-accent-gold [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
              />
              <ZoomIn size={14} className="text-white/40 flex-shrink-0" />
              <span className="text-xs text-white/40 w-12 text-right">{zoom.toFixed(1)}x</span>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRotate}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition text-sm"
                >
                  <RotateCw size={16} />
                  Rotate
                </button>
                <button
                  onClick={handleResetCrop}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition text-sm"
                >
                  <Maximize size={16} />
                  Reset
                </button>
              </div>

              <button
                onClick={handleConfirm}
                disabled={processing}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent-gold hover:bg-accent-amber text-black font-semibold transition text-sm disabled:opacity-50"
              >
                <Check size={16} />
                {processing ? 'Processing...' : 'Attach'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
