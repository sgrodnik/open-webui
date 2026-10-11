<script lang="ts">
	import { getContext } from 'svelte';
	import { getChatById, getChatList } from '$lib/apis/chats';
	import { createMessagesList, convertMessagesToHistory } from '$lib/utils';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n: any = getContext('i18n');

	export let show = false;
	export let chatList: any[] | null = null;
	export let onClose: () => void = () => {};
	export let onSelectChat: (id: string) => void = () => {};

	let recentChats: any[] = [];
	let loading = false;
	let wasOpen = false;
	let loadGeneration = 0;

	const isRussian = ($i18n.language ?? '').toLowerCase().startsWith('ru');

	const formatShortRelativeTime = (timestamp: number | null | undefined) => {
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

	const truncateRequest = (request: string) => {
		const characters = Array.from(request.replace(/\\s+/g, ' ').trim());
		return characters.length > 60 ? `${characters.slice(0, 60).join('')}…` : characters.join('');
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

	const getChatSummary = (chat: any) => {
		const content = chat?.chat ?? {};
		let history = content.history;
		if (!history?.messages && Array.isArray(content.messages)) {
			history = convertMessagesToHistory(content.messages);
		}

		let messages = Array.isArray(content.messages) ? content.messages : [];
		if (history?.messages) {
			const currentId = chat?.current_message_id ?? history.currentId;
			if (currentId) {
				messages = createMessagesList(history, currentId);
			}
		}

		const prompts = messages.filter((message: any) => message?.role === 'user').map(getMessageText);

		return { prompts };
	};

	const loadRecentChats = async () => {
		const generation = ++loadGeneration;
		loading = true;
		recentChats = [];

		try {
			const token = localStorage.token ?? '';
			const list = Array.isArray(chatList) ? chatList : await getChatList(token, 1);
			const latestChats = [...(list ?? [])]
				.filter((chat) => chat?.id && !chat?.archived)
				.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
				.slice(0, 10);

			const loadedChats = await Promise.all(
				latestChats.map(async (chat) => {
					const details = await getChatById(token, chat.id).catch(() => null);
					const { prompts } = getChatSummary(details);
					return {
						...chat,
						firstRequest: truncateRequest(prompts[0] ?? ''),
						lastRequest: truncateRequest(prompts.at(-1) ?? ''),
						requestNumber: prompts.length
					};
				})
			);

			if (generation === loadGeneration) recentChats = loadedChats;
		} catch (error) {
			console.error('Failed to load recent chats:', error);
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	};

	$: if (show !== wasOpen) {
		wasOpen = show;
		if (show) {
			void loadRecentChats();
		} else {
			loadGeneration += 1;
		}
	}

	const handleKeydown = (event: KeyboardEvent) => {
		if (show && event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	};
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
	<div
		class="fixed inset-0 z-[100] flex min-h-[100dvh] flex-col overflow-hidden bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
		role="dialog"
		aria-modal="true"
		aria-label={$i18n.t('Recent chats')}
	>
		<header
			class="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] dark:border-gray-850"
		>
			<h1 class="text-lg font-semibold">{$i18n.t('Recent chats')}</h1>
			<button
				type="button"
				class="flex size-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
				aria-label={$i18n.t('Close')}
				on:click={onClose}
			>
				<XMark className="size-5" />
			</button>
		</header>

		<main
			class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
		>
			{#if loading}
				<div
					class="flex h-full min-h-40 items-center justify-center text-sm text-gray-500 dark:text-gray-400"
				>
					{$i18n.t('Loading chats…')}
				</div>
			{:else if recentChats.length === 0}
				<div
					class="flex h-full min-h-40 items-center justify-center text-sm text-gray-500 dark:text-gray-400"
				>
					{$i18n.t('No recent chats')}
				</div>
			{:else}
				<div class="mx-auto max-w-2xl divide-y divide-gray-100 dark:divide-gray-850">
					{#each recentChats as chat (chat.id)}
						<button
							type="button"
							class="block w-full py-2.5 text-left transition hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-850/60 dark:active:bg-gray-850"
							on:click={() => onSelectChat(chat.id)}
						>
							<div class="mb-1.5 flex items-start justify-between gap-2">
								<span class="min-w-0 flex-1 truncate text-sm font-medium"
									>{chat.title || $i18n.t('New Chat')}</span
								>
								<div
									class="flex shrink-0 items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400"
								>
									<span>{formatShortRelativeTime(chat.created_at)}</span>
									<span aria-hidden="true">·</span>
									<span>{formatShortRelativeTime(chat.updated_at)}</span>
								</div>
							</div>
							<div class="text-xs leading-snug text-gray-500 dark:text-gray-400">
								{#if chat.requestNumber > 0}
									<div class="mb-0.5">{chat.firstRequest}</div>
									<div>
										<span class="font-medium">{chat.requestNumber}:</span>
										<span>{chat.lastRequest || $i18n.t('No messages yet')}</span>
									</div>
								{:else}
									<span>{$i18n.t('No messages yet')}</span>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</main>
	</div>
{/if}
