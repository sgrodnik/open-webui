<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';
	import { getChatById, getChatList } from '$lib/apis/chats';
	import {
		formatShortRelativeTime,
		getChatSummary,
		getMergedTitle,
		getOrderedChatIds,
		normalizeRequest
	} from '$lib/utils/recentChats';
	import { createRecentChatsShortcutController } from '$lib/utils/recentChatsShortcuts';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n: any = getContext('i18n');

	export let show = false;
	export let chatList: any[] | null = null;
	export let onClose: () => void = () => {};
	export let onSelectChat: (id: string) => void = () => {};
	export let currentChatId: string | null = null;
	export let onShortcutPendingChange: (pending: boolean) => void = () => {};

	let recentChats: any[] = [];
	let loading = false;
	let wasOpen = false;
	let loadGeneration = 0;
	let shortcutChatIds: (string | null)[] = [];
	let shortcutChatIdsLoaded = false;
	let cachedCurrentChatId = currentChatId;
	let cachedChatList = chatList;
	let navigationHistoryIds = currentChatId ? [currentChatId] : [];
	$: if (currentChatId !== cachedCurrentChatId || chatList !== cachedChatList) {
		if (currentChatId && currentChatId !== cachedCurrentChatId) {
			navigationHistoryIds = [
				currentChatId,
				...navigationHistoryIds.filter((id) => id !== currentChatId)
			].slice(0, 10);
		}
		cachedCurrentChatId = currentChatId;
		cachedChatList = chatList;
		shortcutChatIdsLoaded = false;
	}

	type SettingKey = 'titleSize' | 'textSize' | 'padding' | 'verticalPadding' | 'width' | 'offset';
	type DisplaySettings = Record<SettingKey, number>;

	const SETTINGS_KEY = 'open-webui-recent-chats-display-v1';
	const SETTING_KEYS: SettingKey[] = [
		'titleSize',
		'textSize',
		'padding',
		'verticalPadding',
		'width',
		'offset'
	];
	const DEFAULT_SETTINGS: DisplaySettings = {
		titleSize: 14,
		textSize: 12,
		padding: 16,
		verticalPadding: 10,
		width: 672,
		offset: 0
	};
	const SETTING_BOUNDS: Record<SettingKey, { min: number; max: number }> = {
		titleSize: { min: 8, max: 32 },
		textSize: { min: 8, max: 24 },
		padding: { min: 4, max: 40 },
		verticalPadding: { min: 0, max: 40 },
		width: { min: 320, max: 1600 },
		offset: { min: -600, max: 600 }
	};
	const SETTING_SCROLL_STEP: Record<SettingKey, number> = {
		titleSize: 1,
		textSize: 1,
		padding: 1,
		verticalPadding: 1,
		width: 8,
		offset: 8
	};
	let displaySettings = { ...DEFAULT_SETTINGS };
	let touchSetting: SettingKey | null = null;
	let touchStartY: number | null = null;

	onMount(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
			displaySettings = Object.fromEntries(
				(Object.keys(DEFAULT_SETTINGS) as SettingKey[]).map((key) => {
					const value = Number(saved[key]);
					const { min, max } = SETTING_BOUNDS[key];
					return [
						key,
						Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : DEFAULT_SETTINGS[key]
					];
				})
			) as DisplaySettings;
		} catch {
			displaySettings = { ...DEFAULT_SETTINGS };
		}
	});

	const setDisplaySetting = (key: SettingKey, value: number) => {
		if (!Number.isFinite(value)) return;
		const { min, max } = SETTING_BOUNDS[key];
		displaySettings = {
			...displaySettings,
			[key]: Math.min(max, Math.max(min, Math.round(value)))
		};
		try {
			localStorage.setItem(SETTINGS_KEY, JSON.stringify(displaySettings));
		} catch {
			// Keep the controls usable if storage is unavailable.
		}
	};

	const handleSettingInput = (event: Event, key: SettingKey) => {
		const input = event.currentTarget as HTMLInputElement;
		if (input.value !== '') setDisplaySetting(key, input.valueAsNumber);
	};

	const adjustDisplaySetting = (key: SettingKey, amount: number) => {
		setDisplaySetting(key, displaySettings[key] + amount * SETTING_SCROLL_STEP[key]);
	};

	const handleSettingWheel = (event: WheelEvent, key: SettingKey) => {
		if (event.deltaY === 0) return;
		event.preventDefault();
		adjustDisplaySetting(key, event.deltaY < 0 ? 1 : -1);
	};

	const handleSettingTouchStart = (event: TouchEvent, key: SettingKey) => {
		if (event.touches.length !== 1) return;
		touchSetting = key;
		touchStartY = event.touches[0]?.clientY ?? null;
	};

	const handleSettingTouchMove = (event: TouchEvent, key: SettingKey) => {
		const touch = event.touches[0];
		if (!touch || touchSetting !== key || touchStartY === null) return;

		const steps = Math.trunc((touchStartY - touch.clientY) / 24);
		if (steps === 0) return;

		event.preventDefault();
		adjustDisplaySetting(key, steps);
		touchStartY -= steps * 24;
	};

	const handleSettingTouchEnd = () => {
		touchSetting = null;
		touchStartY = null;
	};

	const resetDisplaySettings = () => {
		displaySettings = { ...DEFAULT_SETTINGS };
		try {
			localStorage.removeItem(SETTINGS_KEY);
		} catch {
			// Ignore unavailable storage.
		}
	};

	const isRussian = ($i18n.language ?? '').toLowerCase().startsWith('ru');

	const getLatestChatList = async (token: string) => {
		let list = Array.isArray(chatList) ? chatList : [];
		if (list.length < 10) {
			const fetched = await getChatList(token, 1);
			const chatsById = new Map(
				[...(list ?? []), ...(fetched ?? [])].map((chat) => [chat.id, chat])
			);
			list = [...chatsById.values()];
		}

		return [...list]
			.filter((chat) => chat?.id && !chat?.archived)
			.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
	};

	const getShortcutChatIds = async () => {
		if (shortcutChatIdsLoaded) return shortcutChatIds;

		const token = localStorage.token ?? '';
		const latestChats = await getLatestChatList(token);
		shortcutChatIds = [
			currentChatId || null,
			...getOrderedChatIds(latestChats, currentChatId, navigationHistoryIds).filter(
				(id) => id !== currentChatId
			)
		].slice(0, 10);
		shortcutChatIdsLoaded = true;
		return shortcutChatIds;
	};

	const loadRecentChats = async () => {
		const generation = ++loadGeneration;
		loading = true;
		recentChats = [];

		try {
			const token = localStorage.token ?? '';
			const latestChats = await getLatestChatList(token);
			let currentChat = latestChats.find((chat) => chat.id === currentChatId) ?? null;
			const detailsCache = new Map<string, any>();

			if (currentChatId && !currentChat) {
				const details = await getChatById(token, currentChatId).catch(() => null);
				if (details) {
					detailsCache.set(currentChatId, details);
					currentChat = { ...details, id: currentChatId };
				}
			}

			const chatsById = new Map(latestChats.map((chat) => [chat.id, chat]));
			if (currentChat) chatsById.set(currentChat.id, currentChat);
			const orderedCandidates = getOrderedChatIds(latestChats, currentChatId, navigationHistoryIds)
				.map((id) => chatsById.get(id))
				.filter(Boolean);
			const hasCurrentChat = Boolean(currentChatId && orderedCandidates[0]?.id === currentChatId);
			const orderedChats = orderedCandidates.slice(0, hasCurrentChat ? 10 : 9);
			shortcutChatIds = [
				currentChatId || null,
				...orderedChats.filter((chat) => chat.id !== currentChatId).map((chat) => chat.id)
			].slice(0, 10);
			shortcutChatIdsLoaded = true;

			const loadedChats = await Promise.all(
				orderedChats.map(async (chat, index) => {
					const details = detailsCache.has(chat.id)
						? detailsCache.get(chat.id)
						: await getChatById(token, chat.id).catch(() => null);
					const { prompts } = getChatSummary(details);
					return {
						...chat,
						shortcutNumber: hasCurrentChat ? index : index + 1,
						firstRequest: normalizeRequest(prompts[0] ?? ''),
						lastRequest: normalizeRequest(prompts.at(-1) ?? ''),
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

	const selectChatByNumber = async (number: number) => {
		try {
			const chatId = (await getShortcutChatIds())[number];
			if (chatId) onSelectChat(chatId);
		} catch (error) {
			console.error('Failed to select a recent chat by shortcut:', error);
		}
	};

	const shortcutController = createRecentChatsShortcutController({
		isOpen: () => show,
		open: () => (show = true),
		close: () => onClose(),
		onPendingChange: (pending) => onShortcutPendingChange(pending),
		selectChatByNumber: (number) => void selectChatByNumber(number)
	});
	const handleKeydown = shortcutController.handleKeydown;

	onDestroy(() => shortcutController.destroy());
</script>

<svelte:window on:keydown|capture={handleKeydown} />

{#if show}
	<div
		class="fixed inset-0 z-[100] flex h-[100dvh] items-center justify-center overflow-hidden md:p-4"
		style={`--recent-modal-width: ${displaySettings.width}px; --recent-modal-offset: ${displaySettings.offset}px`}
	>
		<button
			type="button"
			class="absolute inset-0 hidden bg-black/20 md:block"
			aria-label={$i18n.t('Close')}
			on:click={onClose}
		></button>
		<div
			class="recent-chats-dialog relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 md:h-[min(80vh,720px)] md:rounded-2xl md:shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label={$i18n.t('Recent chats')}
		>
			<header
				class="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] dark:border-gray-850 md:pt-3"
				style={`padding-inline: ${displaySettings.padding}px`}
			>
				<h1 class="text-lg font-semibold">{$i18n.t('Recent chats')}</h1>
				<div class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
					{#each SETTING_KEYS as key}
						<input
							type="number"
							min={SETTING_BOUNDS[key].min}
							max={SETTING_BOUNDS[key].max}
							step="1"
							value={displaySettings[key]}
							class="{key === 'offset'
								? 'w-14'
								: 'w-11'} appearance-none rounded-md border border-gray-200 bg-transparent px-1 py-1 text-center text-xs text-gray-600 outline-none dark:border-gray-700 dark:text-gray-300 {key ===
								'width' || key === 'offset'
								? 'hidden md:block'
								: ''}"
							style="touch-action: pan-x"
							aria-label={$i18n.t(
								key === 'titleSize'
									? 'Title font size'
									: key === 'textSize'
										? 'Text font size'
										: key === 'padding'
											? 'Padding'
											: key === 'verticalPadding'
												? 'Vertical padding'
												: key === 'width'
													? 'Window width'
													: 'Window offset'
							)}
							on:input={(event) => handleSettingInput(event, key)}
							on:wheel|nonpassive={(event) => handleSettingWheel(event, key)}
							on:touchstart={(event) => handleSettingTouchStart(event, key)}
							on:touchmove|nonpassive={(event) => handleSettingTouchMove(event, key)}
							on:touchend={handleSettingTouchEnd}
							on:touchcancel={handleSettingTouchEnd}
						/>
					{/each}
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-full text-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
						aria-label={$i18n.t('Reset')}
						on:click={resetDisplaySettings}
					>
						↺
					</button>
					<button
						type="button"
						class="flex size-10 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
						aria-label={$i18n.t('Close')}
						on:click={onClose}
					>
						<XMark className="size-5" />
					</button>
				</div>
			</header>

			<main
				class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-4"
				style={`padding-inline: ${displaySettings.padding}px`}
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
							{@const title = chat.title || $i18n.t('New Chat')}
							{@const mergedTitle = getMergedTitle(title, chat.firstRequest)}
							<button
								type="button"
								class="block w-full text-left transition hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-850/60 dark:active:bg-gray-850"
								style={`padding-block: ${displaySettings.verticalPadding}px`}
								on:click={() => onSelectChat(chat.id)}
							>
								<div class="mb-1 flex min-w-0 items-center justify-between gap-2">
									<div
										class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-gray-500 dark:text-gray-400"
										style={`font-size: ${displaySettings.textSize}px`}
										title={`${title}${chat.firstRequest ? ` · ${chat.firstRequest}` : ''}`}
									>
										<span class="mr-1 font-mono font-semibold text-gray-400 dark:text-gray-500"
											>{chat.shortcutNumber}</span
										>
										{#if mergedTitle}
											<span
												class="font-semibold text-gray-900 dark:text-gray-100"
												style={`font-size: ${displaySettings.titleSize}px`}
												>{mergedTitle.firstTitleWord}</span
											>
											{#if mergedTitle.requestWithoutFirstWord}
												<span>{` ${mergedTitle.requestWithoutFirstWord}`}</span>
											{/if}
										{:else}
											<span
												class="font-semibold text-gray-900 dark:text-gray-100"
												style={`font-size: ${displaySettings.titleSize}px`}>{title}</span
											>
											{#if chat.firstRequest}
												<span>{` · ${chat.firstRequest}`}</span>
											{/if}
										{/if}
									</div>
									<div
										class="flex shrink-0 items-center gap-1 whitespace-nowrap text-gray-500 dark:text-gray-400"
										style={`font-size: ${displaySettings.textSize}px`}
									>
										<span>{formatShortRelativeTime(chat.created_at, isRussian)}</span>
										<span aria-hidden="true">·</span>
										<span class="font-medium">{chat.requestNumber}</span>
										<span aria-hidden="true">·</span>
										<span>{formatShortRelativeTime(chat.updated_at, isRussian)}</span>
									</div>
								</div>
								<div
									class="overflow-hidden text-ellipsis whitespace-nowrap leading-snug text-gray-500 dark:text-gray-400"
									style={`font-size: ${displaySettings.textSize}px`}
									title={chat.lastRequest || $i18n.t('No messages yet')}
								>
									{chat.lastRequest || $i18n.t('No messages yet')}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</main>
		</div>
	</div>
{/if}

<style>
	@media (min-width: 768px) {
		.recent-chats-dialog {
			width: min(var(--recent-modal-width), calc(100vw - 2rem));
			--recent-modal-max-offset: max(
				0px,
				calc((100vw - min(var(--recent-modal-width), calc(100vw - 2rem))) / 2 - 1rem)
			);
			transform: translateX(
				clamp(
					calc(0px - var(--recent-modal-max-offset)),
					var(--recent-modal-offset),
					var(--recent-modal-max-offset)
				)
			);
		}
	}
</style>
