'use client';

import { useCallback, useMemo } from 'react';

interface BoundingBoxOverlayProps {
    words: string[];
    boundingBoxes: number[][]; // [[x1,y1,x2,y2], ...]
    renderedWidth: number;  // actual rendered width on screen
    renderedHeight: number; // actual rendered height on screen
    hoveredIndex: number | null;
    selectedIndices: Set<number>;
    searchMatchIndices: Set<number>;
    currentSearchIndex: number | null;
    onWordHover: (index: number | null) => void;
    onWordClick: (index: number) => void;
}

export default function BoundingBoxOverlay({
    words,
    boundingBoxes,
    renderedWidth,
    renderedHeight,
    hoveredIndex,
    selectedIndices,
    searchMatchIndices,
    currentSearchIndex,
    onWordHover,
    onWordClick,
}: BoundingBoxOverlayProps) {

    // Compute the OCR coordinate space from the bounding box data itself.
    // The OCR system reports bounding boxes in its own pixel coordinate space.
    // We derive the effective page dimensions from the max extents of all boxes
    // and add a small margin to account for content not reaching the very edge.
    const ocrDimensions = useMemo(() => {
        if (!boundingBoxes || boundingBoxes.length === 0) return { width: 1, height: 1 };
        let maxX = 0;
        let maxY = 0;
        for (const bbox of boundingBoxes) {
            if (bbox.length >= 4) {
                if (bbox[2] > maxX) maxX = bbox[2];
                if (bbox[3] > maxY) maxY = bbox[3];
            }
        }
        // Add ~8% margin since content may not reach the page edge
        return {
            width: Math.ceil(maxX * 1.08),
            height: Math.ceil(maxY * 1.08),
        };
    }, [boundingBoxes]);

    // Scale factor from OCR pixel coords to rendered size
    const scaleX = renderedWidth / ocrDimensions.width;
    const scaleY = renderedHeight / ocrDimensions.height;

    const getBoxStyle = useCallback(
        (index: number, bbox: number[]) => {
            const [x1, y1, x2, y2] = bbox;
            const left = x1 * scaleX;
            const top = y1 * scaleY;
            const width = (x2 - x1) * scaleX;
            const height = (y2 - y1) * scaleY;

            let bg = 'transparent';
            let border = '1px solid transparent';
            let zIndex = 10;
            let boxShadow = 'none';

            if (currentSearchIndex === index) {
                // Current search match — bright orange
                bg = 'rgba(255, 140, 0, 0.4)';
                border = '2px solid rgba(255, 140, 0, 0.9)';
                zIndex = 50;
                boxShadow = '0 0 8px rgba(255, 140, 0, 0.6)';
            } else if (searchMatchIndices.has(index)) {
                // Other search matches — lighter orange
                bg = 'rgba(255, 180, 50, 0.25)';
                border = '1.5px solid rgba(255, 160, 30, 0.7)';
                zIndex = 40;
            } else if (selectedIndices.has(index)) {
                // Selected words — blue
                bg = 'rgba(59, 130, 246, 0.3)';
                border = '2px solid rgba(59, 130, 246, 0.8)';
                zIndex = 30;
                boxShadow = '0 0 6px rgba(59, 130, 246, 0.4)';
            } else if (hoveredIndex === index) {
                // Hovered — yellow glow
                bg = 'rgba(250, 204, 21, 0.35)';
                border = '2px solid rgba(234, 179, 8, 0.9)';
                zIndex = 45;
                boxShadow = '0 0 10px rgba(234, 179, 8, 0.5)';
            }

            return {
                position: 'absolute' as const,
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                background: bg,
                border,
                zIndex,
                boxShadow,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                borderRadius: '2px',
                boxSizing: 'border-box' as const,
            };
        },
        [scaleX, scaleY, hoveredIndex, selectedIndices, searchMatchIndices, currentSearchIndex]
    );

    if (!words || !boundingBoxes || words.length === 0) return null;

    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${renderedWidth}px`,
                height: `${renderedHeight}px`,
                pointerEvents: 'auto',
            }}
            onMouseLeave={() => onWordHover(null)}
        >
            {boundingBoxes.map((bbox, i) => {
                if (!bbox || bbox.length < 4) return null;
                return (
                    <div
                        key={i}
                        style={getBoxStyle(i, bbox)}
                        onMouseEnter={() => onWordHover(i)}
                        onClick={(e) => {
                            e.stopPropagation();
                            onWordClick(i);
                        }}
                        title={words[i] || ''}
                    />
                );
            })}
        </div>
    );
}
