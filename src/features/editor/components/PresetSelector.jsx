import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Settings2, Check } from 'lucide-react';
import Button from '../../../shared/components/Button.jsx';

/**
 * Inline preset dropdown for the editor toolbar. Selecting a preset applies it
 * immediately; the gear button opens the full preset manager.
 */
export default function PresetSelector({ presets, activePresetId, onApplyPreset, onOpenManager }) {
	const [open, setOpen] = useState(false);
	const containerRef = useRef(null);
	const activeName = presets.find((p) => p.id === activePresetId)?.name;

	useEffect(() => {
		if (!open) return;
		const onClickOutside = (e) => {
			if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
		};
		const onKeyDown = (e) => {
			if (e.key === 'Escape') setOpen(false);
		};
		window.addEventListener('mousedown', onClickOutside);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('mousedown', onClickOutside);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [open]);

	return (
		<div className="preset-selector" ref={containerRef}>
			<Button
				variant="secondary"
				onClick={() => setOpen((prev) => !prev)}
				title="Apply a preset"
				aria-expanded={open}
				aria-haspopup="listbox"
			>
				{activeName ? `Preset: ${activeName}` : 'Presets…'}
				<ChevronDown size={14} />
			</Button>

			{open && (
				<div className="preset-popover" role="listbox">
					{presets.length === 0 ? (
						<div className="preset-popover-empty">No presets saved yet</div>
					) : (
						presets.map((p) => (
							<button
								key={p.id}
								type="button"
								role="option"
								aria-selected={p.id === activePresetId}
								className={`preset-popover-item ${p.id === activePresetId ? 'active' : ''}`}
								onClick={() => { onApplyPreset(p.id); setOpen(false); }}
							>
								{p.id === activePresetId && <Check size={13} />}
								<span>{p.name}</span>
							</button>
						))
					)}
				</div>
			)}

			<Button
				variant="ghost"
				iconOnly
				onClick={onOpenManager}
				title="Manage presets"
				aria-label="Manage presets"
				icon={<Settings2 size={16} />}
			/>
		</div>
	);
}
