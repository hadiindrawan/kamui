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
});
