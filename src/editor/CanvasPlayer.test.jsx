import React from 'react';
import { render } from '@testing-library/react';
import CanvasPlayer from './CanvasPlayer';

describe('CanvasPlayer', () => {
    it('should render without crashing', () => {
        const mockRecording = {
            id: 'test',
            videoBlob: new Blob([''], { type: 'video/webm' })
        };
        
        // Mock HTMLVideoElement methods
        window.HTMLMediaElement.prototype.load = () => {};
        window.HTMLMediaElement.prototype.play = () => {};
        window.HTMLMediaElement.prototype.pause = () => {};

        const { container } = render(
            <CanvasPlayer 
                recording={mockRecording} 
                isPlaying={false} 
                currentTime={0} 
                segments={[]} 
            />
        );
        expect(container.querySelector('canvas')).toBeInTheDocument();
    });
});
