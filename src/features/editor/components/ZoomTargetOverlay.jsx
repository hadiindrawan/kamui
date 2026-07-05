import React from 'react';
import { Rnd } from 'react-rnd';
import { mapVideoPointToFrame, mapFramePointToVideo, getZoomRegionFrameSize } from '../utils/coordinates.js';

/**
 * Draggable box for positioning a "fixed" zoom segment's target point over the
 * *visible* video area. It lives in frame space (0-1 over the cropped view) and
 * converts to/from source-normalized coordinates, so under crop/reframe the
 * handle sits over the pixels actually shown and the camera lands where placed.
 */
export default function ZoomTargetOverlay({ frameRect, sceneLayout, selectedSegment, onUpdateSegment }) {
    if (!frameRect || !sceneLayout) return null;

    const region = getZoomRegionFrameSize(sceneLayout, selectedSegment.zoomLevel);
    const boxW = region.w * frameRect.width;
    const boxH = region.h * frameRect.height;

    const framePos = mapVideoPointToFrame(selectedSegment.x, selectedSegment.y, sceneLayout);
    const posX = framePos.x * frameRect.width - boxW / 2;
    const posY = framePos.y * frameRect.height - boxH / 2;

    return (
        <div
            className="zoom-overlay-container"
            style={{
                position: 'absolute',
                left: frameRect.x,
                top: frameRect.y,
                width: frameRect.width,
                height: frameRect.height,
                pointerEvents: 'none',
                zIndex: 10,
            }}
        >
            <Rnd
                position={{ x: posX, y: posY }}
                size={{ width: boxW, height: boxH }}
                enableResizing={false}
                onDragStop={(e, d) => {
                    const centerFx = Math.max(0, Math.min(1, (d.x + boxW / 2) / frameRect.width));
                    const centerFy = Math.max(0, Math.min(1, (d.y + boxH / 2) / frameRect.height));
                    const { x, y } = mapFramePointToVideo(centerFx, centerFy, sceneLayout);
                    onUpdateSegment(selectedSegment.id, {
                        x: Math.max(0, Math.min(1, x)),
                        y: Math.max(0, Math.min(1, y)),
                    }, true);
                }}
                bounds="parent"
                style={{
                    border: '2px solid var(--accent)',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                    pointerEvents: 'auto',
                    cursor: 'move',
                }}
            >
                <div className="zoom-target-label">Zoom Target</div>
            </Rnd>
        </div>
    );
}
