type PendingPrefix = {
	target: HTMLElement | null;
	text: string;
	selectionStart?: number;
	selectionEnd?: number;
	range?: Range;
};

type ShortcutControllerOptions = {
	isOpen: () => boolean;
	open: () => void;
	close: () => void;
	onPendingChange: (pending: boolean) => void;
	selectChatByNumber: (number: number) => void;
};

const getEditableTarget = (target: EventTarget | null) => {
	if (!(target instanceof Element)) return null;
	return target.closest(
		'input, textarea, select, [contenteditable="true"], [role="textbox"]'
	) as HTMLElement | null;
};

const isTextInput = (target: HTMLElement | null) => {
	if (!target) return false;
	if (target instanceof HTMLTextAreaElement || target.isContentEditable) return true;
	if (target instanceof HTMLInputElement) {
		return ['text', 'search', 'url', 'tel', 'email', 'password'].includes(target.type);
	}
	return target.getAttribute('role') === 'textbox';
};

const isPrefixKey = (event: KeyboardEvent) =>
	['~', '`', 'ё', 'Ё'].includes(event.key) || event.code === 'Backquote';

const capturePendingPrefix = (event: KeyboardEvent): PendingPrefix => {
	const editableTarget = getEditableTarget(event.target);
	const target = isTextInput(editableTarget) ? editableTarget : null;
	const pending: PendingPrefix = {
		target,
		text: event.key === 'Dead' && event.code === 'Backquote' ? '`' : event.key
	};

	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
		pending.selectionStart = target.selectionStart ?? target.value.length;
		pending.selectionEnd = target.selectionEnd ?? pending.selectionStart;
	} else if (target?.isContentEditable) {
		const selection = window.getSelection();
		if (selection?.rangeCount) {
			const range = selection.getRangeAt(0);
			if (target.contains(range.commonAncestorContainer)) pending.range = range.cloneRange();
		}
	}

	return pending;
};

const insertPendingPrefix = (pending: PendingPrefix) => {
	const { target } = pending;
	if (!target?.isConnected) return;

	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
		const active = document.activeElement === target;
		const start = active ? (target.selectionStart ?? target.value.length) : pending.selectionStart;
		const end = active ? (target.selectionEnd ?? start) : pending.selectionEnd;
		if (start === undefined || end === undefined) return;

		target.setRangeText(pending.text, start, end, 'end');
		target.dispatchEvent(
			new InputEvent('input', {
				bubbles: true,
				inputType: 'insertText',
				data: pending.text
			})
		);
		return;
	}

	if (!target.isContentEditable) return;

	const selection = window.getSelection();
	if (pending.range && selection) {
		selection.removeAllRanges();
		selection.addRange(pending.range);
	}

	const previousText = target.textContent;
	const inserted = document.execCommand('insertText', false, pending.text);
	if (inserted || target.textContent !== previousText) return;

	const range = selection?.rangeCount ? selection.getRangeAt(0) : pending.range;
	if (!range || !target.contains(range.commonAncestorContainer)) return;

	range.deleteContents();
	const text = document.createTextNode(pending.text);
	range.insertNode(text);
	range.setStartAfter(text);
	range.collapse(true);
	selection?.removeAllRanges();
	selection?.addRange(range);
	target.dispatchEvent(
		new InputEvent('input', {
			bubbles: true,
			inputType: 'insertText',
			data: pending.text
		})
	);
};

export const createRecentChatsShortcutController = ({
	isOpen,
	open,
	close,
	onPendingChange,
	selectChatByNumber
}: ShortcutControllerOptions) => {
	let pendingPrefix: PendingPrefix | null = null;
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;
	let prefixPending = false;

	const clearPendingPrefix = () => {
		if (pendingTimer) clearTimeout(pendingTimer);
		pendingTimer = null;
		pendingPrefix = null;
		if (prefixPending) {
			prefixPending = false;
			onPendingChange(false);
		}
	};

	const startPendingPrefix = (event: KeyboardEvent) => {
		pendingPrefix = capturePendingPrefix(event);
		prefixPending = true;
		onPendingChange(true);
		pendingTimer = setTimeout(() => {
			const pending = pendingPrefix;
			clearPendingPrefix();
			if (pending && isTextInput(pending.target)) insertPendingPrefix(pending);
		}, 500);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.repeat) return;

		if (isPrefixKey(event)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			if (pendingPrefix) {
				clearPendingPrefix();
				open();
			} else {
				startPendingPrefix(event);
			}
			return;
		}

		const number = /^\d$/.test(event.key) ? Number(event.key) : null;
		if (pendingPrefix && number !== null) {
			event.preventDefault();
			event.stopImmediatePropagation();
			clearPendingPrefix();
			selectChatByNumber(number);
			return;
		}

		if (pendingPrefix && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
		if (pendingPrefix) {
			const pending = pendingPrefix;
			clearPendingPrefix();
			if (isTextInput(pending.target)) insertPendingPrefix(pending);
		}

		if (isOpen() && event.key === 'Escape') {
			event.preventDefault();
			event.stopImmediatePropagation();
			close();
			return;
		}

		const editableTarget = getEditableTarget(event.target);
		const editingModalSetting = Boolean(editableTarget?.closest('.recent-chats-dialog'));
		if (isOpen() && number !== null && (!editableTarget || !editingModalSetting)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			selectChatByNumber(number);
		}
	};

	return {
		handleKeydown,
		destroy: clearPendingPrefix
	};
};
