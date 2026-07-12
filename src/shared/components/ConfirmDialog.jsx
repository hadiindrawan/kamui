import React from 'react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';
import './ConfirmDialog.css';

const ConfirmDialog = ({
	open,
	title,
	message,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	danger = false,
	onConfirm,
	onCancel,
}) => {
	return (
		<Modal open={open} title={title} onClose={onCancel} width={400}>
			<p className="confirm-dialog-message">{message}</p>
			<div className="confirm-dialog-actions">
				<Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
				<Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
			</div>
		</Modal>
	);
};

export default ConfirmDialog;
