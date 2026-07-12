import React, { cloneElement, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

const SHOW_DELAY_MS = 200;

const Tooltip = ({ content, shortcut, side = 'top', children }) => {
	const [visible, setVisible] = useState(false);
	const [coords, setCoords] = useState(null);
	const [resolvedSide, setResolvedSide] = useState(side);
	const timerRef = useRef(null);
	const anchorRef = useRef(null);
	const id = useId();

	const show = () => {
		timerRef.current = window.setTimeout(() => {
			const rect = anchorRef.current?.getBoundingClientRect();
			if (!rect) return;
			let placedSide = side;
			if (side === 'top' && rect.top < 48) placedSide = 'bottom';
			setResolvedSide(placedSide);
			setCoords({
				x: rect.left + rect.width / 2,
				y: placedSide === 'top' ? rect.top : rect.bottom,
			});
			setVisible(true);
		}, SHOW_DELAY_MS);
	};

	const hide = () => {
		window.clearTimeout(timerRef.current);
		setVisible(false);
	};

	if (!content) return children;

	const child = cloneElement(children, {
		ref: (node) => {
			anchorRef.current = node;
			const { ref } = children;
			if (typeof ref === 'function') ref(node);
			else if (ref) ref.current = node;
		},
		onMouseEnter: (e) => { show(); children.props.onMouseEnter?.(e); },
		onMouseLeave: (e) => { hide(); children.props.onMouseLeave?.(e); },
		onFocus: (e) => { show(); children.props.onFocus?.(e); },
		onBlur: (e) => { hide(); children.props.onBlur?.(e); },
		'aria-describedby': visible ? id : undefined,
	});

	return (
		<>
			{child}
			{visible && coords && createPortal(
				<div
					className={`ui-tooltip ui-tooltip-${resolvedSide}`}
					role="tooltip"
					id={id}
					style={{
						left: coords.x,
						top: coords.y,
					}}
				>
					<span className="ui-tooltip-content">{content}</span>
					{shortcut && <kbd className="ui-tooltip-kbd">{shortcut}</kbd>}
				</div>,
				document.body,
			)}
		</>
	);
};

export default Tooltip;
