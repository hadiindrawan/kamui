export function formatTime(seconds, { centiseconds = false } = {}) {
	if (!Number.isFinite(seconds)) return centiseconds ? '00:00.00' : '00:00';
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	const base = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	if (!centiseconds) return base;
	const cs = Math.floor((seconds % 1) * 100);
	return `${base}.${cs.toString().padStart(2, '0')}`;
}
