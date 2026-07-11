import React, { forwardRef } from 'react';
import './Button.css';

const Button = forwardRef(({
	variant = 'secondary',
	size = 'md',
	icon = null,
	iconOnly = false,
	active = false,
	disabled = false,
	title,
	onClick,
	className = '',
	children,
	...rest
}, ref) => {
	const classes = [
		'ui-btn',
		`ui-btn-${variant}`,
		`ui-btn-${size}`,
		iconOnly ? 'ui-btn-icon-only' : '',
		active ? 'ui-btn-active' : '',
		className,
	].filter(Boolean).join(' ');

	return (
		<button
			ref={ref}
			type="button"
			className={classes}
			onClick={onClick}
			disabled={disabled}
			title={title}
			aria-pressed={active || undefined}
			{...rest}
		>
			{icon}
			{!iconOnly && children}
		</button>
	);
});

export default Button;
