import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Editor from './editor';

// Mock the indexeddb imports
jest.mock('../../storage/indexeddb.js', () => ({
    getRecording: jest.fn().mockResolvedValue({ id: 'mock-id', events: [] }),
    updateRecording: jest.fn().mockResolvedValue(),
    getAllPresets: jest.fn().mockResolvedValue([]),
    getPreset: jest.fn().mockResolvedValue(null),
    savePreset: jest.fn().mockResolvedValue(),
    deletePreset: jest.fn().mockResolvedValue(),
}));

// Mock the canvas player and timeline as they are complex to test directly within the editor
jest.mock('./components/CanvasPlayer.jsx', () => {
    const React = require('react');
    return React.forwardRef((props, ref) => <div data-testid="mock-canvas-player" />);
});

jest.mock('./components/Timeline.jsx', () => {
    const React = require('react');
    return (props) => <div data-testid="mock-timeline" />;
});

// Mock URLSearchParams
const originalLocation = window.location;

describe('Editor', () => {
    beforeEach(() => {
        delete window.location;
        window.location = { search: '?id=mock-id' };
    });

    afterAll(() => {
        window.location = originalLocation;
    });

    it('should render the editor empty state when no id is provided', async () => {
        window.location.search = '';
        render(<Editor />);
        
        await waitFor(() => {
            expect(screen.getByText('Upload a Local Video')).toBeInTheDocument();
            expect(screen.getByText('Drag and drop a .webm, .mp4, or .mov file here')).toBeInTheDocument();
        });
    });

    it('should load recording and render the editor when id is provided', async () => {
        render(<Editor />);
        
        // Wait for the loading state to finish
        await waitFor(() => {
            expect(screen.getByText('Beunta Editor')).toBeInTheDocument();
            expect(screen.getByTestId('mock-canvas-player')).toBeInTheDocument();
            expect(screen.getByTestId('mock-timeline')).toBeInTheDocument();
        });
    });
});
