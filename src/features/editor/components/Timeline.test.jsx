import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Timeline from './Timeline';

// Mock react-rnd because it doesn't render well in jsdom without layout geometry
jest.mock('react-rnd', () => {
    return {
        Rnd: (props) => <div data-testid="rnd-mock">{props.children}</div>
    };
});

describe('Timeline', () => {
    it('should render timeline correctly', () => {
        render(<Timeline duration={100} currentTime={10} segments={[]} />);
        expect(screen.getByTitle('Add segment at current time')).toBeInTheDocument();
        expect(screen.getByTitle('Toggle trim mode - Resize timeline to trim video')).toBeInTheDocument();
        // Time markers usually include "00:10" or similar depending on the step size
        expect(screen.getByText('00:00')).toBeInTheDocument(); 
    });

    it('should show dropdown when clicking add segment', async () => {
        render(<Timeline duration={100} currentTime={10} segments={[]} />);
        
        await userEvent.click(screen.getByTitle('Add segment at current time'));
        expect(screen.getByText('Zoom')).toBeInTheDocument();
        expect(screen.getByText('Crop')).toBeInTheDocument();
    });

    it('should render segments', () => {
        const segments = [
            { id: '1', type: 'zoom', startTime: 10000, duration: 2000 },
            { id: '2', type: 'crop', startTime: 20000, duration: 2000 }
        ];
        render(<Timeline duration={100} currentTime={10} segments={segments} />);

        expect(screen.getByText('Zoom')).toBeInTheDocument();
        expect(screen.getByText('Crop')).toBeInTheDocument();
    });

    it('should render one row per track and only show segments matching that track', () => {
        const segments = [
            { id: '1', type: 'zoom', startTime: 10000, duration: 2000, trackId: 0 },
            { id: '2', type: 'crop', startTime: 10000, duration: 2000, trackId: 1 },
        ];
        const tracks = [{ id: 0, label: 'Track 1' }, { id: 1, label: 'Track 2' }];
        const { container } = render(
            <Timeline duration={100} currentTime={10} segments={segments} tracks={tracks} />
        );

        // Two track rows (plus the hidden ruler row), each holding one segment.
        const trackContents = container.querySelectorAll('.track-content');
        expect(trackContents.length).toBe(tracks.length);
        expect(screen.getByText('Zoom')).toBeInTheDocument();
        expect(screen.getByText('Crop')).toBeInTheDocument();
    });

    it('should call onAddTrack when the add-track button is clicked', async () => {
        const onAddTrack = jest.fn();
        render(<Timeline duration={100} currentTime={10} segments={[]} onAddTrack={onAddTrack} />);

        await userEvent.click(screen.getByText('Add Track'));
        expect(onAddTrack).toHaveBeenCalled();
    });
});
