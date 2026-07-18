import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CaptionsPanel from './CaptionsPanel.jsx';
import { ToastProvider } from '../../../shared/components/Toast.jsx';

jest.mock('../../../core/services/api-client.js', () => {
	class APIError extends Error {
		constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
	}
	return {
		APIError,
		conversionAPI: { transcribeAudio: jest.fn() },
	};
});

jest.mock('../utils/audio-extract.js', () => ({
	extractAudioForTranscription: jest.fn(),
}));

import { conversionAPI } from '../../../core/services/api-client.js';
import { extractAudioForTranscription } from '../utils/audio-extract.js';

const baseProps = () => ({
	recording: { id: 'r1', videoBlob: new Blob(['x']) },
	captions: [],
	captionsEnabled: true,
	setCaptionsEnabled: jest.fn(),
	burnInCaptions: false,
	setBurnInCaptions: jest.fn(),
	addCaptionAtPlayhead: jest.fn(() => 'cap_new'),
	updateCaption: jest.fn(),
	deleteCaption: jest.fn(),
	setAllCaptions: jest.fn(),
	duration: 60,
	trimStart: 0,
	trimEnd: 60,
	onSeek: jest.fn(),
	setHasPendingEdits: jest.fn(),
	captionFontScale: 1,
	setCaptionFontScale: jest.fn(),
	captionFontFamily: 'sans',
	setCaptionFontFamily: jest.fn(),
	captionColor: '#ffffff',
	setCaptionColor: jest.fn(),
	captionBackground: 'box',
	setCaptionBackground: jest.fn(),
	captionPosition: 'bottom',
	setCaptionPosition: jest.fn(),
});

const renderPanel = (overrides = {}) => {
	const props = { ...baseProps(), ...overrides };
	render(
		<ToastProvider>
			<CaptionsPanel {...props} />
		</ToastProvider>
	);
	return props;
};

beforeEach(() => jest.clearAllMocks());

describe('CaptionsPanel', () => {
	it('renders an empty state with no captions', () => {
		renderPanel();
		expect(screen.getByText(/No captions yet/i)).toBeInTheDocument();
		expect(screen.getByText('0 captions')).toBeInTheDocument();
	});

	it('lists captions and seeks when a timestamp is clicked', async () => {
		const props = renderPanel({
			captions: [{ id: 'a', start: 1.5, end: 3, text: 'Hello world' }],
		});
		expect(screen.getByText('Hello world')).toBeInTheDocument();
		await userEvent.click(screen.getByTitle('Jump to this caption'));
		expect(props.onSeek).toHaveBeenCalledWith(1.5);
	});

	it('adds a caption at the playhead', async () => {
		const props = renderPanel();
		await userEvent.click(screen.getByRole('button', { name: /Add/i }));
		expect(props.addCaptionAtPlayhead).toHaveBeenCalled();
	});

	it('confirms before deleting a caption', async () => {
		const props = renderPanel({
			captions: [{ id: 'a', start: 1, end: 2, text: 'Bye' }],
		});
		await userEvent.click(screen.getByTitle('Delete caption'));
		await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
		expect(props.deleteCaption).toHaveBeenCalledWith('a');
	});

	it('transcribes the recording audio and applies segments', async () => {
		extractAudioForTranscription.mockResolvedValue([{ wavBlob: new Blob(['a']), offsetSec: 0, durationSec: 5 }]);
		conversionAPI.transcribeAudio.mockResolvedValue([{ start: 1, end: 2, text: 'Hi' }]);
		const props = renderPanel();

		await userEvent.click(screen.getByRole('button', { name: /Generate captions/i }));

		await waitFor(() => expect(props.setAllCaptions).toHaveBeenCalledWith([
			{ start: 1, end: 2, text: 'Hi' },
		]));
	});

	it('changes caption style and marks the project dirty', async () => {
		const props = renderPanel();
		await userEvent.selectOptions(screen.getByDisplayValue('Sans'), 'serif');
		expect(props.setCaptionFontFamily).toHaveBeenCalledWith('serif');

		await userEvent.click(screen.getByRole('button', { name: 'Top' }));
		expect(props.setCaptionPosition).toHaveBeenCalledWith('top');
		expect(props.setHasPendingEdits).toHaveBeenCalled();
	});

	it('shows a friendly message when the recording has no audio', async () => {
		extractAudioForTranscription.mockRejectedValue(Object.assign(new Error('no audio'), { code: 'no-audio' }));
		const props = renderPanel();

		await userEvent.click(screen.getByRole('button', { name: /Generate captions/i }));

		await waitFor(() => expect(screen.getByText(/has no audio/i)).toBeInTheDocument());
		expect(props.setAllCaptions).not.toHaveBeenCalled();
	});
});
