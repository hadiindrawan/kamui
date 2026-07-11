import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button.jsx';
import Tooltip from './Tooltip.jsx';
import Tabs from './Tabs.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

describe('Button', () => {
	it('renders children and responds to click', async () => {
		const onClick = jest.fn();
		render(<Button onClick={onClick}>Save</Button>);
		await userEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('applies variant, size, and active classes', () => {
		render(<Button variant="primary" size="sm" active>Go</Button>);
		const btn = screen.getByRole('button', { name: 'Go' });
		expect(btn.className).toContain('ui-btn-primary');
		expect(btn.className).toContain('ui-btn-sm');
		expect(btn.className).toContain('ui-btn-active');
		expect(btn).toHaveAttribute('aria-pressed', 'true');
	});

	it('does not fire onClick when disabled', async () => {
		const onClick = jest.fn();
		render(<Button onClick={onClick} disabled>Go</Button>);
		await userEvent.click(screen.getByRole('button', { name: 'Go' }));
		expect(onClick).not.toHaveBeenCalled();
	});

	it('hides children in iconOnly mode', () => {
		render(<Button iconOnly aria-label="Close" icon={<span>X</span>}>Close</Button>);
		const btn = screen.getByRole('button', { name: 'Close' });
		expect(btn.textContent).toBe('X');
	});
});

describe('Tooltip', () => {
	it('shows content after hover delay and hides on mouse leave', async () => {
		render(
			<Tooltip content="Play" shortcut="Space">
				<button>Play button</button>
			</Tooltip>
		);
		const trigger = screen.getByRole('button', { name: 'Play button' });
		await userEvent.hover(trigger);
		await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
		expect(screen.getByText('Play')).toBeInTheDocument();
		expect(screen.getByText('Space')).toBeInTheDocument();

		await userEvent.unhover(trigger);
		await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
	});

	it('renders children unchanged when no content is provided', () => {
		render(
			<Tooltip content={null}>
				<button>Plain</button>
			</Tooltip>
		);
		expect(screen.getByRole('button', { name: 'Plain' })).toBeInTheDocument();
	});
});

describe('Tabs', () => {
	const tabs = [
		{ id: 'a', label: 'Alpha' },
		{ id: 'b', label: 'Beta' },
		{ id: 'c', label: 'Gamma' },
	];

	it('marks the active tab as selected', () => {
		render(<Tabs tabs={tabs} activeId="b" onChange={() => {}} />);
		expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
	});

	it('calls onChange when a tab is clicked', async () => {
		const onChange = jest.fn();
		render(<Tabs tabs={tabs} activeId="a" onChange={onChange} />);
		await userEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
		expect(onChange).toHaveBeenCalledWith('c');
	});

	it('navigates between tabs with arrow keys', async () => {
		const onChange = jest.fn();
		render(<Tabs tabs={tabs} activeId="a" onChange={onChange} />);
		screen.getByRole('tab', { name: 'Alpha' }).focus();
		await userEvent.keyboard('{ArrowRight}');
		expect(onChange).toHaveBeenCalledWith('b');
	});
});

describe('ConfirmDialog', () => {
	it('renders title and message when open, and fires callbacks', async () => {
		const onConfirm = jest.fn();
		const onCancel = jest.fn();
		render(
			<ConfirmDialog
				open
				title="Reset timeline?"
				message="This cannot be undone."
				confirmLabel="Reset"
				danger
				onConfirm={onConfirm}
				onCancel={onCancel}
			/>
		);
		expect(screen.getByText('Reset timeline?')).toBeInTheDocument();
		expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
		expect(onConfirm).toHaveBeenCalledTimes(1);

		await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it('renders nothing when closed', () => {
		render(
			<ConfirmDialog
				open={false}
				title="Reset timeline?"
				message="This cannot be undone."
				onConfirm={() => {}}
				onCancel={() => {}}
			/>
		);
		expect(screen.queryByText('Reset timeline?')).not.toBeInTheDocument();
	});
});
