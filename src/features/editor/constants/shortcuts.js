export const SHORTCUT_GROUPS = [
	{
		title: 'Playback',
		items: [
			{ keys: ['Space'], label: 'Play / Pause' },
			{ keys: ['←', '→'], label: 'Skip 5s' },
			{ keys: ['Shift', '←/→'], label: 'Skip 10s' },
		],
	},
	{
		title: 'Editing',
		items: [
			{ keys: ['I'], label: 'Set trim in' },
			{ keys: ['O'], label: 'Set trim out' },
			{ keys: ['⌘', 'Z'], label: 'Undo' },
			{ keys: ['⌘', 'Shift', 'Z'], label: 'Redo' },
			{ keys: ['Del'], label: 'Delete selected segment (last segment if none selected)' },
			{ keys: ['⌘', 'S'], label: 'Save changes' },
		],
	},
	{
		title: 'Timeline',
		items: [
			{ keys: ['Ctrl', 'Scroll'], label: 'Zoom timeline' },
		],
	},
];
