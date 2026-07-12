import React, { useRef } from 'react';
import './Tabs.css';

const Tabs = ({ tabs, activeId, onChange }) => {
	const tabRefs = useRef({});

	const focusTab = (index) => {
		const tab = tabs[index];
		if (tab) tabRefs.current[tab.id]?.focus();
	};

	const handleKeyDown = (e, index) => {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			const next = (index + 1) % tabs.length;
			onChange(tabs[next].id);
			focusTab(next);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			const prev = (index - 1 + tabs.length) % tabs.length;
			onChange(tabs[prev].id);
			focusTab(prev);
		}
	};

	return (
		<div className="ui-tabs" role="tablist">
			{tabs.map((tab, index) => (
				<button
					key={tab.id}
					ref={(node) => { tabRefs.current[tab.id] = node; }}
					type="button"
					role="tab"
					id={`tab-${tab.id}`}
					aria-selected={activeId === tab.id}
					aria-controls={`tabpanel-${tab.id}`}
					tabIndex={activeId === tab.id ? 0 : -1}
					className={`ui-tab ${activeId === tab.id ? 'ui-tab-active' : ''}`}
					onClick={() => onChange(tab.id)}
					onKeyDown={(e) => handleKeyDown(e, index)}
				>
					{tab.icon}
					<span>{tab.label}</span>
				</button>
			))}
		</div>
	);
};

export default Tabs;
