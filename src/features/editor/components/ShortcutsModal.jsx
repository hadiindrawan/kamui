import React from 'react';
import Modal from '../../../shared/components/Modal.jsx';
import { SHORTCUT_GROUPS } from '../constants/shortcuts.js';

export default function ShortcutsModal({ open, onClose }) {
	return (
		<Modal open={open} title="Keyboard Shortcuts" onClose={onClose} width={560}>
			<div className="shortcuts-modal">
				{SHORTCUT_GROUPS.map((group) => (
					<div key={group.title} className="shortcuts-group">
						<h4 className="shortcuts-group-title">{group.title}</h4>
						{group.items.map((item) => (
							<div key={item.label} className="shortcuts-row">
								<span className="shortcuts-label">{item.label}</span>
								<span className="shortcuts-keys">
									{item.keys.map((key, i) => (
										<kbd key={i} className="shortcuts-kbd">{key}</kbd>
									))}
								</span>
							</div>
						))}
					</div>
				))}
			</div>
		</Modal>
	);
}
