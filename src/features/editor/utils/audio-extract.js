/**
 * Extract audio from a recording blob as a small 16 kHz mono WAV, suitable for
 * upload to a Whisper transcription backend. Uses mediabunny (already a
 * dependency) entirely client-side, reusing the Input + BlobSource demux
 * pattern from export.js.
 *
 * Recordings may consist of multiple sequential blobs (one per capture
 * segment). Each is transcribed separately; `offsetSec` accumulates the prior
 * blobs' durations so caller can shift segment timestamps into global source
 * time.
 */

/**
 * Thrown when a recording has no audio track at all (e.g. mic off + no system
 * audio). Carries `code: 'no-audio'` so the UI can show a tailored message.
 */
export class NoAudioError extends Error {
	constructor(message = 'This recording has no audio track') {
		super(message);
		this.name = 'NoAudioError';
		this.code = 'no-audio';
	}
}

/**
 * @param {Object} recording - Recording record (with videoBlobs or videoBlob)
 * @returns {Promise<Array<{wavBlob: Blob, offsetSec: number, durationSec: number}>>}
 */
export const extractAudioForTranscription = async (recording) => {
	const {
		Input,
		Output,
		BlobSource,
		BufferTarget,
		WavOutputFormat,
		Conversion,
		ALL_FORMATS,
	} = await import('mediabunny');

	const blobs = recording?.videoBlobs?.length
		? recording.videoBlobs
		: (recording?.videoBlob ? [recording.videoBlob] : []);

	if (!blobs.length) {
		throw new NoAudioError('This recording has no video/audio data');
	}

	const results = [];
	let offsetSec = 0;
	let anyAudio = false;

	for (const blob of blobs) {
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

		// Duration advances the running offset even for audioless blobs so later
		// blobs still line up on the global timeline.
		let durationSec = 0;
		try {
			durationSec = await input.computeDuration();
		} catch {
			durationSec = 0;
		}

		const audioTrack = await input.getPrimaryAudioTrack();
		if (!audioTrack) {
			offsetSec += durationSec;
			continue;
		}
		anyAudio = true;

		const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
		const conversion = await Conversion.init({
			input,
			output,
			video: { discard: true },
			audio: { sampleRate: 16000, numberOfChannels: 1 },
		});
		await conversion.execute();

		const wavBlob = new Blob([output.target.buffer], { type: 'audio/wav' });
		results.push({ wavBlob, offsetSec, durationSec });
		offsetSec += durationSec;
	}

	if (!anyAudio) {
		throw new NoAudioError();
	}

	return results;
};
