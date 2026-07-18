import React, { useRef, useState } from 'react';
import { Captions, Plus, Trash2, Download, Wand2, Mic, Upload } from 'lucide-react';
import { formatTime } from '../hooks/useEditorState.js';
import { downloadSrt } from '../utils/download.js';
import { extractAudioForTranscription } from '../utils/audio-extract.js';
import { conversionAPI, APIError } from '../../../core/services/api-client.js';
import { useToast } from '../../../shared/hooks/useToast.js';
import Button from '../../../shared/components/Button.jsx';
import ConfirmDialog from '../../../shared/components/ConfirmDialog.jsx';

const MAX_AUDIO_BYTES = 500 * 1024 * 1024; // 500MB (matches backend limit)

// idle -> extracting -> transcribing -> done | error
const STATUS_LABEL = {
	extracting: 'Extracting audio…',
	transcribing: 'Transcribing…',
};

const FONT_OPTIONS = [
	{ value: 'sans', label: 'Sans' },
	{ value: 'serif', label: 'Serif' },
	{ value: 'mono', label: 'Mono' },
	{ value: 'rounded', label: 'Rounded' },
];

const BACKGROUND_OPTIONS = [
	{ value: 'box', label: 'Box' },
	{ value: 'shadow', label: 'Shadow' },
	{ value: 'none', label: 'None' },
];

const POSITION_OPTIONS = [
	{ value: 'top', label: 'Top' },
	{ value: 'middle', label: 'Middle' },
	{ value: 'bottom', label: 'Bottom' },
];

export default function CaptionsPanel({
	recording,
	captions,
	captionsEnabled,
	setCaptionsEnabled,
	burnInCaptions,
	setBurnInCaptions,
	addCaptionAtPlayhead,
	updateCaption,
	deleteCaption,
	setAllCaptions,
	duration,
	trimStart,
	trimEnd,
	onSeek,
	setHasPendingEdits,
	// Caption style (preset-backed appearance)
	captionFontScale,
	setCaptionFontScale,
	captionFontFamily,
	setCaptionFontFamily,
	captionColor,
	setCaptionColor,
	captionBackground,
	setCaptionBackground,
	captionPosition,
	setCaptionPosition,
}) {
	const { showToast } = useToast();
	const fileInputRef = useRef(null);
	const [source, setSource] = useState('recording'); // 'recording' | 'upload'
	const [status, setStatus] = useState('idle');
	const [editingId, setEditingId] = useState(null);
	const [deleteId, setDeleteId] = useState(null);
	const [pendingSegments, setPendingSegments] = useState(null); // overwrite-confirm buffer

	const busy = status === 'extracting' || status === 'transcribing';
	const effectiveTrimEnd = trimEnd || duration || Infinity;

	// Style changes are preset-backed appearance edits; mark the project dirty.
	const changeStyle = (setter, value) => { setter(value); setHasPendingEdits(true); };

	const applySegments = (segments) => {
		setAllCaptions(segments);
		setStatus('done');
		showToast({ type: 'success', message: `Added ${segments.length} caption${segments.length === 1 ? '' : 's'}` });
	};

	// If captions already exist, confirm before replacing them.
	const commitSegments = (segments) => {
		if (!segments.length) {
			setStatus('done');
			showToast({ type: 'info', message: 'No speech detected in the audio' });
			return;
		}
		if (captions.length) {
			setPendingSegments(segments);
			return;
		}
		applySegments(segments);
	};

	const transcribeRecordingAudio = async () => {
		setStatus('extracting');
		const parts = await extractAudioForTranscription(recording);
		setStatus('transcribing');
		const all = [];
		for (const { wavBlob, offsetSec } of parts) {
			const segments = await conversionAPI.transcribeAudio(wavBlob, { filename: 'recording.wav' });
			for (const seg of segments) {
				all.push({ start: seg.start + offsetSec, end: seg.end + offsetSec, text: seg.text });
			}
		}
		commitSegments(all);
	};

	const transcribeUploadedFile = async (file) => {
		if (file.size > MAX_AUDIO_BYTES) {
			showToast({ type: 'error', message: 'Audio file exceeds the 500MB limit' });
			return;
		}
		setStatus('transcribing');
		const segments = await conversionAPI.transcribeAudio(file, { filename: file.name });
		commitSegments(segments.map((s) => ({ start: s.start, end: s.end, text: s.text })));
	};

	const runTranscription = async (uploadedFile = null) => {
		try {
			if (uploadedFile) {
				await transcribeUploadedFile(uploadedFile);
			} else {
				await transcribeRecordingAudio();
			}
		} catch (err) {
			setStatus('error');
			if (err?.code === 'no-audio') {
				showToast({ type: 'error', message: 'This recording has no audio — upload an audio file instead' });
			} else if (err instanceof APIError && err.statusCode === 401) {
				showToast({ type: 'error', message: 'Transcription unauthorized — check the backend API key' });
			} else {
				showToast({ type: 'error', message: `Transcription failed: ${err.message}` });
			}
		}
	};

	const handleGenerate = () => {
		if (source === 'upload') {
			fileInputRef.current?.click();
			return;
		}
		runTranscription();
	};

	const handleFilePicked = (e) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (file) runTranscription(file);
	};

	const handleAdd = () => {
		const id = addCaptionAtPlayhead();
		setEditingId(id);
	};

	return (
		<div className="sidebar-section captions-panel">
			<div className="captions-toolbar-row">
				<label className="captions-toggle">
					<input
						type="checkbox"
						checked={captionsEnabled}
						onChange={(e) => { setCaptionsEnabled(e.target.checked); setHasPendingEdits(true); }}
					/>
					<span><Captions size={13} /> Show captions</span>
				</label>
				<label className="captions-toggle">
					<input
						type="checkbox"
						checked={burnInCaptions}
						onChange={(e) => { setBurnInCaptions(e.target.checked); setHasPendingEdits(true); }}
					/>
					<span>Burn into export</span>
				</label>
			</div>

			{/* Auto-generation */}
			<div className="setting-row captions-generate">
				<div className="setting-label"><span>Auto-generate</span></div>
				<div className="segment-mode-toggle">
					<button
						className={`mode-btn ${source === 'recording' ? 'active' : ''}`}
						onClick={() => setSource('recording')}
						disabled={busy}
						title="Transcribe the recording's own audio track"
					>
						<Mic size={13} /> Recording
					</button>
					<button
						className={`mode-btn ${source === 'upload' ? 'active' : ''}`}
						onClick={() => setSource('upload')}
						disabled={busy}
						title="Transcribe a separate audio file"
					>
						<Upload size={13} /> Upload
					</button>
				</div>
				<Button
					variant="primary"
					className="captions-generate-btn"
					onClick={handleGenerate}
					disabled={busy}
					icon={<Wand2 size={13} />}
				>
					{busy ? STATUS_LABEL[status] : (source === 'upload' ? 'Choose audio & generate' : 'Generate captions')}
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept=".mp3,.wav,.m4a,.ogg,.webm,audio/*"
					style={{ display: 'none' }}
					onChange={handleFilePicked}
				/>
				{source === 'upload' && (
					<p className="captions-hint">The uploaded audio should match the recording's timing.</p>
				)}
			</div>

			{/* Caption list */}
			<div className="captions-list-header">
				<span>{captions.length} caption{captions.length === 1 ? '' : 's'}</span>
				<div className="captions-list-actions">
					<Button
						variant="ghost"
						size="sm"
						onClick={handleAdd}
						title="Add a caption at the current playhead"
						icon={<Plus size={13} />}
					>
						Add
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => downloadSrt(captions, {
							trimStart,
							trimEnd: effectiveTrimEnd,
							filename: `kamui_${Date.now()}.srt`,
						})}
						disabled={!captions.length}
						title="Download captions as an .srt file (matches the trimmed export)"
						icon={<Download size={13} />}
					>
						SRT
					</Button>
				</div>
			</div>

			{captions.length === 0 && (
				<p className="captions-empty">No captions yet. Generate them from audio, or add one manually.</p>
			)}

			<div className="captions-list">
				{captions.map((c) => (
					<div key={c.id} className={`caption-row ${editingId === c.id ? 'editing' : ''}`}>
						<div className="caption-row-head">
							<button
								className="caption-time-btn"
								onClick={() => onSeek?.(c.start)}
								title="Jump to this caption"
							>
								{formatTime(c.start)} → {formatTime(c.end)}
							</button>
							<div className="caption-row-actions">
								<button
									className="caption-icon-btn"
									onClick={() => setEditingId(editingId === c.id ? null : c.id)}
									title={editingId === c.id ? 'Done' : 'Edit caption'}
								>
									{editingId === c.id ? 'Done' : 'Edit'}
								</button>
								<button
									className="caption-icon-btn danger"
									onClick={() => setDeleteId(c.id)}
									title="Delete caption"
								>
									<Trash2 size={13} />
								</button>
							</div>
						</div>

						{editingId === c.id ? (
							<div className="caption-edit">
								<textarea
									className="caption-text-input"
									value={c.text}
									rows={2}
									onChange={(e) => updateCaption(c.id, { text: e.target.value })}
								/>
								<div className="caption-time-inputs">
									<label>
										Start
										<input
											type="number"
											min="0"
											step="0.1"
											value={Number(c.start.toFixed(2))}
											onChange={(e) => updateCaption(c.id, { start: parseFloat(e.target.value) || 0 })}
										/>
									</label>
									<label>
										End
										<input
											type="number"
											min="0"
											step="0.1"
											value={Number(c.end.toFixed(2))}
											onChange={(e) => updateCaption(c.id, { end: parseFloat(e.target.value) || 0 })}
										/>
									</label>
								</div>
							</div>
						) : (
							<p className="caption-text-preview">{c.text || <em>(empty)</em>}</p>
						)}
					</div>
				))}
			</div>

			{/* Appearance / style */}
			<div className="captions-style">
				<div className="captions-list-header"><span>Style</span></div>

				<div className="setting-row">
					<div className="setting-label">
						<span>Size</span>
						<span className="setting-value">{Math.round(captionFontScale * 100)}%</span>
					</div>
					<input
						type="range"
						className="setting-slider"
						min="0.5"
						max="2"
						step="0.05"
						value={captionFontScale}
						onChange={(e) => changeStyle(setCaptionFontScale, parseFloat(e.target.value))}
					/>
				</div>

				<div className="setting-row">
					<div className="setting-label"><span>Font</span></div>
					<select
						className="setting-select"
						value={captionFontFamily}
						onChange={(e) => changeStyle(setCaptionFontFamily, e.target.value)}
					>
						{FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
					</select>
				</div>

				<div className="setting-row">
					<div className="setting-label"><span>Text color</span></div>
					<input
						type="color"
						className="caption-color-input"
						value={captionColor}
						onChange={(e) => changeStyle(setCaptionColor, e.target.value)}
					/>
				</div>

				<div className="setting-row">
					<div className="setting-label"><span>Background</span></div>
					<div className="segment-mode-toggle">
						{BACKGROUND_OPTIONS.map((o) => (
							<button
								key={o.value}
								className={`mode-btn ${captionBackground === o.value ? 'active' : ''}`}
								onClick={() => changeStyle(setCaptionBackground, o.value)}
							>
								{o.label}
							</button>
						))}
					</div>
				</div>

				<div className="setting-row">
					<div className="setting-label"><span>Position</span></div>
					<div className="segment-mode-toggle">
						{POSITION_OPTIONS.map((o) => (
							<button
								key={o.value}
								className={`mode-btn ${captionPosition === o.value ? 'active' : ''}`}
								onClick={() => changeStyle(setCaptionPosition, o.value)}
							>
								{o.label}
							</button>
						))}
					</div>
				</div>
			</div>

			<ConfirmDialog
				open={!!deleteId}
				title="Delete caption"
				message="Remove this caption? This can't be undone from here."
				confirmLabel="Delete"
				danger
				onConfirm={() => { deleteCaption(deleteId); setDeleteId(null); }}
				onCancel={() => setDeleteId(null)}
			/>

			<ConfirmDialog
				open={!!pendingSegments}
				title="Replace existing captions?"
				message={`This will replace your current ${captions.length} caption(s) with ${pendingSegments?.length || 0} generated one(s).`}
				confirmLabel="Replace"
				danger
				onConfirm={() => { applySegments(pendingSegments); setPendingSegments(null); }}
				onCancel={() => { setPendingSegments(null); setStatus('idle'); }}
			/>
		</div>
	);
}
