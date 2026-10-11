import { convertMessagesToHistory, createMessagesList } from '$lib/utils';

export const normalizeRequest = (request: string) => request.replace(/\s+/g, ' ').trim();

export const getMergedTitle = (title: string, firstRequest: string) => {
	const normalizedTitle = normalizeRequest(title).toLowerCase();
	if (!normalizedTitle || !normalizeRequest(firstRequest).toLowerCase().includes(normalizedTitle)) {
		return null;
	}

	return {
		firstTitleWord: title.trim().split(/\s+/)[0] ?? '',
		requestWithoutFirstWord: firstRequest.replace(/^\S+\s*/, '')
	};
};

export const formatShortRelativeTime = (
	timestamp: number | null | undefined,
	isRussian: boolean
) => {
	if (!timestamp) return '';

	const secondsAgo = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
	if (secondsAgo < 60) return isRussian ? 'сейчас' : 'now';

	const units = isRussian
		? [
				{ seconds: 365 * 86400, suffix: 'г' },
				{ seconds: 30 * 86400, suffix: 'мес' },
				{ seconds: 86400, suffix: 'д' },
				{ seconds: 3600, suffix: 'ч' },
				{ seconds: 60, suffix: 'м' }
			]
		: [
				{ seconds: 365 * 86400, suffix: 'y' },
				{ seconds: 30 * 86400, suffix: 'mo' },
				{ seconds: 86400, suffix: 'd' },
				{ seconds: 3600, suffix: 'h' },
				{ seconds: 60, suffix: 'm' }
			];
	const unit = units.find(({ seconds }) => secondsAgo >= seconds) ?? units[units.length - 1];
	if (!unit) return '';
	return `${Math.floor(secondsAgo / unit.seconds)}${unit.suffix}`;
};

const getMessageText = (message: any) => {
	const content = message?.content;
	if (typeof content === 'string') return content.trim();
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''
			)
			.filter(Boolean)
			.join(' ')
			.trim();
	}
	return '';
};

export const getChatSummary = (chat: any) => {
	const content = chat?.chat ?? {};
	let history = content.history;
	if (!history?.messages && Array.isArray(content.messages)) {
		history = convertMessagesToHistory(content.messages);
	}

	let messages = Array.isArray(content.messages) ? content.messages : [];
	if (history?.messages) {
		const currentId = chat?.current_message_id ?? history.currentId;
		if (currentId) messages = createMessagesList(history, currentId);
	}

	const prompts = messages.filter((message: any) => message?.role === 'user').map(getMessageText);
	return { prompts };
};

export const getOrderedChatIds = (
	latestChats: any[],
	currentChatId: string | null,
	navigationHistoryIds: string[]
) =>
	[
		...(currentChatId ? [currentChatId] : []),
		...navigationHistoryIds.filter((id) => id !== currentChatId),
		...latestChats.filter((chat) => chat.id !== currentChatId).map((chat) => chat.id)
	].filter((id, index, ids) => ids.indexOf(id) === index);
