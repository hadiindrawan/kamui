import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordingsList from './RecordingsList';

describe('RecordingsList', () => {
    const mockOnDelete = jest.fn();
    const mockOnOpen = jest.fn();
    const mockOnRecover = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRecordings = [
        {
            id: 'rec_123456',
            startTime: Date.now() - 50000, // Just now
            duration: 125, // 2:05
            events: [{}, {}, {}], // 3 events
            isInterrupted: false,
            thumbnail: 'data:image/png;base64,mock',
        },
        {
            id: 'rec_789012',
            startTime: Date.now() - 3600000 * 2, // 2h ago
            chunkCount: 5,
            isInterrupted: true,
            thumbnail: null,
        }
    ];

    it('should render the list of recordings', () => {
        render(
            <RecordingsList 
                recordings={mockRecordings} 
                onDelete={mockOnDelete} 
                onOpen={mockOnOpen} 
                onRecover={mockOnRecover} 
            />
        );

        // Check for normal recording
        expect(screen.getByText('Recording #3456')).toBeInTheDocument();
        expect(screen.getByText('Just now')).toBeInTheDocument();
        expect(screen.getByText('02:05')).toBeInTheDocument();
        expect(screen.getByText('3 events')).toBeInTheDocument();

        // Check for interrupted recording
        expect(screen.getByText('Lost Recording')).toBeInTheDocument();
        expect(screen.getByText('2h ago')).toBeInTheDocument();
        expect(screen.getByText('5 parts (Interrupted)')).toBeInTheDocument();
    });

    it('should call onOpen when edit button or thumbnail is clicked for a normal recording', async () => {
        render(
            <RecordingsList 
                recordings={[mockRecordings[0]]} 
                onDelete={mockOnDelete} 
                onOpen={mockOnOpen} 
                onRecover={mockOnRecover} 
            />
        );

        const editButton = screen.getByTitle('Open in editor');
        await userEvent.click(editButton);
        expect(mockOnOpen).toHaveBeenCalledWith('rec_123456');

        const thumbnail = screen.getByAltText('Preview');
        await userEvent.click(thumbnail);
        expect(mockOnOpen).toHaveBeenCalledTimes(2);
    });

    it('should call onDelete when delete button is clicked', async () => {
        render(
            <RecordingsList 
                recordings={[mockRecordings[0]]} 
                onDelete={mockOnDelete} 
                onOpen={mockOnOpen} 
                onRecover={mockOnRecover} 
            />
        );

        const deleteButton = screen.getByTitle('Delete');
        await userEvent.click(deleteButton);
        expect(mockOnDelete).toHaveBeenCalledWith('rec_123456');
    });

    it('should call onRecover when recover button is clicked for an interrupted recording', async () => {
        render(
            <RecordingsList 
                recordings={[mockRecordings[1]]} 
                onDelete={mockOnDelete} 
                onOpen={mockOnOpen} 
                onRecover={mockOnRecover} 
            />
        );

        const recoverButton = screen.getByTitle('Recover data');
        await userEvent.click(recoverButton);
        expect(mockOnRecover).toHaveBeenCalledWith('rec_789012');
    });

    it('should handle empty recordings gracefully', () => {
        const { container } = render(
            <RecordingsList 
                recordings={[]} 
                onDelete={mockOnDelete} 
                onOpen={mockOnOpen} 
                onRecover={mockOnRecover} 
            />
        );
        
        // No items should be rendered
        expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
        expect(container.firstChild.childNodes.length).toBe(0);
    });
});
