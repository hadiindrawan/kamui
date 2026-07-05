import React, { useState } from 'react';
import { Rnd } from 'react-rnd';
import { Move } from 'lucide-react';

/**
 * Draggable "cover photo" style handle for crop/pan mode: `videoRect` is the
 * full source video at cover-scale (bigger than the visible frame, from
 * getVideoRect), `frameRect` is the box it fills (from getFrameRect).
 * Dragging the (oversized) video within the frame's bounds pans which part
 * of it is visible.
 *
 * react-rnd's `bounds="parent"` assumes the dragged element is smaller than
 * its container; its internal range calculation inverts (becomes left >
 * right) whenever the child is bigger, which it always is here since the
 * whole point of cover-cropping is an oversized video. So instead of relying
 * on that, we clamp manually in onDrag and drive Rnd as a fully controlled
 * component (its own supported pattern for custom bounds).
 */
export default function CropPanOverlay({ frameRect, videoRect, onUpdatePan }) {
    const maxOffsetX = videoRect.width - frameRect.width;
    const maxOffsetY = videoRect.height - frameRect.height;
    const basePosition = { x: videoRect.x - frameRect.x, y: videoRect.y - frameRect.y };
    const [dragPosition, setDragPosition] = useState(null);

    const clamp = (x, y) => ({
        x: Math.max(-maxOffsetX, Math.min(0, x)),
        y: Math.max(-maxOffsetY, Math.min(0, y)),
    });

    return (
        <div
            className="crop-overlay-container"
            style={{
                position: 'absolute',
                left: frameRect.x,
                top: frameRect.y,
                width: frameRect.width,
                height: frameRect.height,
                overflow: 'hidden',
                pointerEvents: 'none',
                zIndex: 10,
            }}
        >
            <Rnd
                position={dragPosition || basePosition}
                size={{ width: videoRect.width, height: videoRect.height }}
                enableResizing={false}
                onDrag={(e, d) => setDragPosition(clamp(d.x, d.y))}
                onDragStop={(e, d) => {
                    const { x, y } = clamp(d.x, d.y);
                    const normX = maxOffsetX > 0 ? Math.max(0, Math.min(1, -x / maxOffsetX)) : 0.5;
                    const normY = maxOffsetY > 0 ? Math.max(0, Math.min(1, -y / maxOffsetY)) : 0.5;
                    setDragPosition(null);
                    onUpdatePan(normX, normY);
                }}
                style={{
                    border: '2px dashed rgba(255, 255, 255, 0.6)',
                    pointerEvents: 'auto',
                    cursor: 'move',
                }}
            >
                <div className="crop-pan-hint">
                    <Move size={14} /> Drag to reposition
                </div>
            </Rnd>
        </div>
    );
}
