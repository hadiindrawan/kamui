import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Popup from './popup';

jest.mock('../storage/indexeddb.js', () => ({
    getAllRecordings: jest.fn().mockResolvedValue([]),
    getInterruptedRecordings: jest.fn().mockResolvedValue([]),
    deleteRecording: jest.fn().mockResolvedValue(),
    saveRecording: jest.fn().mockResolvedValue(),
    getChunks: jest.fn().mockResolvedValue([]),
    getRecording: jest.fn().mockResolvedValue({}),
}));

describe('Popup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        chrome.runtime.sendMessage.mockResolvedValue({ state: { isRecording: false, currentSessionId: null } });
        chrome.storage.local.get.mockResolvedValue({});
    });

    it('should render the popup correctly', async () => {
        render(<Popup />);
        
        await waitFor(() => {
            expect(screen.getByText('Beunta')).toBeInTheDocument();
            expect(screen.getByText('Start Recording')).toBeInTheDocument();
            expect(screen.getByText('Upload Video')).toBeInTheDocument();
        });
    });

    it('should start recording on click', async () => {
        chrome.runtime.sendMessage.mockImplementation(async (msg) => {
            if (msg.type === 'START_RECORDING') {
                return { success: true, sessionId: '123' };
            }
            if (msg.type === 'GET_STATE') {
                return { state: null };
            }
        });

        render(<Popup />);
        
        const startBtn = await screen.findByText('Start Recording');
        await userEvent.click(startBtn);

        await waitFor(() => {
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
                type: 'START_RECORDING'
            }));
            expect(screen.getByText('Stop Recording')).toBeInTheDocument();
        });
    });

    it('should toggle microphone', async () => {
        render(<Popup />);
        
        const micBtn = await screen.findByTitle('Microphone OFF');
        await userEvent.click(micBtn);

        await waitFor(() => {
            expect(chrome.storage.local.set).toHaveBeenCalledWith({ micEnabled: true });
        });
    });
});
