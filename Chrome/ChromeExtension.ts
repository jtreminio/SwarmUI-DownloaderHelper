/// <reference types="chrome" />

class ChromeExtensionConstants
{
    public static readonly storageTargetUrl = "targetUrl";
    public static readonly storageTargetTabId = "targetTabId";
    public static readonly storageUsePopupWindow = "usePopupWindow";

    public static readonly sourceUrlParamKey = "url";
    public static readonly downloaderParamKey = "downloader";
    public static readonly downloaderParamValue = "1";
    public static readonly swarmUiPathSegment = "Text2Image";
    public static readonly inPlaceHashKey = "swarmui-downloader";

    public static readonly menuId = "send-to-swarmui";
    public static readonly menuTitle = "Send to SwarmUI";
}

interface BackgroundStoredValues
{
    targetUrl?: string;
    targetTabId?: number;
    usePopupWindow?: boolean;
}

interface OptionsStoredValues
{
    targetUrl?: string;
    usePopupWindow?: boolean;
}

type BackgroundStorageKey = keyof BackgroundStoredValues;
type OptionsStorageKey = keyof OptionsStoredValues;

class ChromeUrlTools
{
    public static parseTargetServerUrl(targetUrl: string): URL
    {
        const parsed = this.tryParseHttpOrHttpsUrl(targetUrl);
        if (parsed) {
            return parsed;
        }

        throw new Error("SwarmUI server URL is invalid. Use a full URL including http:// or https://.");
    }

    public static tryParseHttpOrHttpsUrl(candidate: string | undefined): URL | null
    {
        if (!candidate) {
            return null;
        }

        try {
            const parsed = new URL(candidate);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return null;
            }

            return parsed;
        }
        catch {
            return null;
        }
    }

    public static buildText2ImagePath(currentPath: string): string
    {
        const trimmed = currentPath.replace(/\/+$/, "");
        if (!trimmed || trimmed === "/") {
            return `/${ChromeExtensionConstants.swarmUiPathSegment}`;
        }

        if (trimmed.endsWith(`/${ChromeExtensionConstants.swarmUiPathSegment}`)) {
            return trimmed;
        }

        return `${trimmed}/${ChromeExtensionConstants.swarmUiPathSegment}`;
    }

    public static normalizePath(pathname: string): string
    {
        return pathname.replace(/\/+$/, "") || "/";
    }

    public static buildForwardUrl(targetUrl: string, sourceUrl: string): string
    {
        const parsed = this.parseTargetServerUrl(targetUrl);
        parsed.pathname = this.buildText2ImagePath(parsed.pathname);
        parsed.search = "";
        parsed.hash = "";
        parsed.searchParams.set(ChromeExtensionConstants.downloaderParamKey, ChromeExtensionConstants.downloaderParamValue);
        parsed.searchParams.set(ChromeExtensionConstants.sourceUrlParamKey, sourceUrl);

        return parsed.toString();
    }

    public static isTabOnTargetText2Image(tabUrl: string | undefined, targetServerUrl: string): boolean
    {
        const current = this.tryParseHttpOrHttpsUrl(tabUrl);
        if (!current) {
            return false;
        }

        const target = this.parseTargetServerUrl(targetServerUrl);
        if (current.origin !== target.origin) {
            return false;
        }

        return this.normalizePath(current.pathname) === this.normalizePath(this.buildText2ImagePath(target.pathname));
    }

    public static buildInPlaceHash(sourceUrl: string): string
    {
        return `${ChromeExtensionConstants.inPlaceHashKey}=${encodeURIComponent(sourceUrl)}&t=${Date.now()}`;
    }

    public static buildInPlaceTabUrl(existingTabUrl: string | undefined, sourceUrl: string): string | null
    {
        const parsed = this.tryParseHttpOrHttpsUrl(existingTabUrl);
        if (!parsed) {
            return null;
        }

        parsed.hash = this.buildInPlaceHash(sourceUrl);

        return parsed.toString();
    }
}

class ChromeForwarderBackground
{
    private contextMenuSyncPromise: Promise<void> | null = null;

    public constructor()
    {
        chrome.runtime.onInstalled.addListener((details) => {
            void this.onInstalled(details);
        });
        chrome.runtime.onStartup.addListener(() => {
            void this.ensureContextMenu().catch((error) => {
                console.error("Failed to recreate context menu on startup:", error);
            });
        });
        chrome.contextMenus.onClicked.addListener((info, tab) => {
            void this.onContextMenuClicked(info, tab);
        });
        void this.initializeExtension();
    }

    private async onInstalled(details: chrome.runtime.InstalledDetails): Promise<void>
    {
        await this.initializeExtension();
        if (details.reason === "install") {
            await chrome.runtime.openOptionsPage();
        }
    }

    private async onContextMenuClicked(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void>
    {
        if (info.menuItemId !== ChromeExtensionConstants.menuId) {
            return;
        }

        const sourceUrl = this.getSourceUrl(info, tab);
        if (!sourceUrl) {
            console.warn("No URL available for right-click context:", info);
            return;
        }

        try {
            await this.handleForwardMessage(sourceUrl);
        }
        catch (error) {
            console.error("Failed to forward source URL:", error);
            if (this.shouldOpenOptionsForError(error)) {
                await chrome.runtime.openOptionsPage();
            }
        }
    }

    private async getStorageValues(keys: BackgroundStorageKey[]): Promise<BackgroundStoredValues>
    {
        const result = await chrome.storage.local.get(keys);
        return result as BackgroundStoredValues;
    }

    private async ensureDefaultSettings(): Promise<void>
    {
        const { targetUrl, usePopupWindow } = await this.getStorageValues([
            ChromeExtensionConstants.storageTargetUrl as BackgroundStorageKey,
            ChromeExtensionConstants.storageUsePopupWindow as BackgroundStorageKey
        ]);
        if (!targetUrl) {
            await chrome.storage.local.set({ [ChromeExtensionConstants.storageTargetUrl]: "" });
        }

        if (typeof usePopupWindow !== "boolean") {
            await chrome.storage.local.set({ [ChromeExtensionConstants.storageUsePopupWindow]: true });
        }
    }

    private async initializeExtension(): Promise<void>
    {
        try {
            await this.ensureDefaultSettings();
            await this.ensureContextMenu();
        }
        catch (error) {
            console.error("Failed to initialize extension:", error);
        }
    }

    private ensureContextMenu(): Promise<void>
    {
        if (this.contextMenuSyncPromise) {
            return this.contextMenuSyncPromise;
        }

        this.contextMenuSyncPromise = this.createContextMenu()
            .catch((error) => {
                if (!this.isDuplicateContextMenuError(error)) {
                    throw error;
                }
            })
            .finally(() => {
                this.contextMenuSyncPromise = null;
            });

        return this.contextMenuSyncPromise;
    }

    private createContextMenu(): Promise<void>
    {
        return new Promise((resolve, reject) => {
            chrome.contextMenus.removeAll(() => {
                const removeError = chrome.runtime.lastError;
                if (removeError) {
                    reject(new Error(removeError.message));
                    return;
                }

                chrome.contextMenus.create(
                    {
                        id: ChromeExtensionConstants.menuId,
                        title: ChromeExtensionConstants.menuTitle,
                        contexts: ["all"]
                    },
                    () => {
                        const createError = chrome.runtime.lastError;
                        if (createError) {
                            reject(new Error(createError.message));
                            return;
                        }
                        resolve();
                    }
                );
            });
        });
    }

    private isDuplicateContextMenuError(error: unknown): boolean
    {
        if (!(error instanceof Error)) {
            return false;
        }

        const normalized = error.message.toLowerCase();
        return normalized.includes("duplicate id") && normalized.includes(ChromeExtensionConstants.menuId.toLowerCase());
    }

    private getSourceUrl(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): string | null
    {
        if (info.linkUrl) {
            return info.linkUrl;
        }

        if (tab?.url) {
            return tab.url;
        }

        if (info.pageUrl) {
            return info.pageUrl;
        }

        if (info.frameUrl) {
            return info.frameUrl;
        }

        return null;
    }

    private shouldOpenOptionsForError(error: unknown): boolean
    {
        return error instanceof Error && error.message.includes("SwarmUI server URL");
    }

    private async handleForwardMessage(sourceUrl: string): Promise<void>
    {
        const { targetUrl, usePopupWindow } = await this.getStorageValues([
            ChromeExtensionConstants.storageTargetUrl as BackgroundStorageKey,
            ChromeExtensionConstants.storageUsePopupWindow as BackgroundStorageKey
        ]);

        if (!targetUrl) {
            throw new Error("Set a SwarmUI server URL in extension options before forwarding URLs.");
        }

        const forwardUrl = ChromeUrlTools.buildForwardUrl(targetUrl, sourceUrl);
        const tabId = await this.getOrCreateTargetTab(targetUrl, sourceUrl, forwardUrl, usePopupWindow === true);
        await chrome.storage.local.set({ [ChromeExtensionConstants.storageTargetTabId]: tabId });
    }

    private async getOrCreateTargetTab(targetUrl: string, sourceUrl: string, forwardUrl: string, usePopupWindow: boolean): Promise<number>
    {
        const { targetTabId } = await this.getStorageValues([ChromeExtensionConstants.storageTargetTabId as BackgroundStorageKey]);

        if (typeof targetTabId !== "number") {
            return await this.createTargetTab(forwardUrl, usePopupWindow);
        }

        try {
            const existingTab = await chrome.tabs.get(targetTabId);
            if (ChromeUrlTools.isTabOnTargetText2Image(existingTab.url, targetUrl)) {
                const inPlaceUrl = ChromeUrlTools.buildInPlaceTabUrl(existingTab.url, sourceUrl);
                const updateProps: chrome.tabs.UpdateProperties = { active: true };
                if (inPlaceUrl) {
                    updateProps.url = inPlaceUrl;
                }
                await chrome.tabs.update(targetTabId, updateProps);
                if (typeof existingTab.windowId === "number") {
                    await chrome.windows.update(existingTab.windowId, { focused: true });
                }
            }
            else {
                await chrome.tabs.update(targetTabId, { url: forwardUrl, active: true });
                if (typeof existingTab.windowId === "number") {
                    await chrome.windows.update(existingTab.windowId, { focused: true });
                }
            }
            return targetTabId;
        }
        catch {
            await chrome.storage.local.remove(ChromeExtensionConstants.storageTargetTabId);
        }

        return await this.createTargetTab(forwardUrl, usePopupWindow);
    }

    private async createTargetTab(forwardUrl: string, usePopupWindow: boolean): Promise<number>
    {
        if (usePopupWindow) {
            const createdWindow = await chrome.windows.create({
                url: forwardUrl,
                type: "popup",
                focused: true,
                width: 1400,
                height: 1000
            });
            const popupTabId = createdWindow.tabs?.[0]?.id;
            if (typeof popupTabId !== "number") {
                throw new Error("Unable to create popup target tab.");
            }

            return popupTabId;
        }

        const tab = await chrome.tabs.create({
            url: forwardUrl,
            active: true
        });
        if (typeof tab.id !== "number") {
            throw new Error("Unable to create target tab.");
        }

        return tab.id;
    }
}

class ChromeForwarderOptions
{
    private readonly targetUrlInput: HTMLInputElement;
    private readonly usePopupWindowInput: HTMLInputElement;
    private readonly form: HTMLFormElement;
    private readonly status: HTMLElement;

    public constructor(targetUrlInput: HTMLInputElement, usePopupWindowInput: HTMLInputElement, form: HTMLFormElement, status: HTMLElement)
    {
        this.targetUrlInput = targetUrlInput;
        this.usePopupWindowInput = usePopupWindowInput;
        this.form = form;
        this.status = status;

        this.form.addEventListener("submit", (event) => {
            void this.onSubmit(event);
        });

        void this.loadSettings();
    }

    public static tryCreateFromDocument(): ChromeForwarderOptions | null
    {
        const targetUrlInput = document.getElementById("target-url");
        const usePopupWindowInput = document.getElementById("use-popup-window");
        const form = document.getElementById("options-form");
        const status = document.getElementById("status");
        if (!(targetUrlInput instanceof HTMLInputElement)
            || !(usePopupWindowInput instanceof HTMLInputElement)
            || !(form instanceof HTMLFormElement)
            || !status) {
            return null;
        }
        return new ChromeForwarderOptions(targetUrlInput, usePopupWindowInput, form, status);
    }

    private async onSubmit(event: SubmitEvent): Promise<void>
    {
        event.preventDefault();

        const rawValue = this.targetUrlInput.value.trim();
        const normalized = this.normalizeUrl(rawValue);

        if (!normalized) {
            this.setStatus("Enter a full server URL, including http:// or https://.", true);
            return;
        }

        await chrome.storage.local.set({
            [ChromeExtensionConstants.storageTargetUrl]: normalized,
            [ChromeExtensionConstants.storageUsePopupWindow]: this.usePopupWindowInput.checked
        });
        this.setStatus("Saved.");
    }

    private async loadSettings(): Promise<void>
    {
        const { targetUrl, usePopupWindow } = await chrome.storage.local.get([
            ChromeExtensionConstants.storageTargetUrl as OptionsStorageKey,
            ChromeExtensionConstants.storageUsePopupWindow as OptionsStorageKey
        ]) as OptionsStoredValues;
        this.targetUrlInput.value = typeof targetUrl === "string" ? targetUrl : "";
        this.usePopupWindowInput.checked = usePopupWindow !== false;
    }

    private normalizeUrl(value: string): string | null
    {
        if (!value) {
            return null;
        }

        const direct = ChromeUrlTools.tryParseHttpOrHttpsUrl(value);
        if (direct) {
            return direct.toString();
        }

        return null;
    }

    private setStatus(message: string, isError = false): void
    {
        this.status.textContent = message;
        this.status.setAttribute("style", `color: ${isError ? "#b00020" : "#146c2e"};`);
    }
}

class ChromeExtensionBootstrap
{
    public static run(): void
    {
        if (typeof document === "undefined") {
            new ChromeForwarderBackground();
            return;
        }

        ChromeForwarderOptions.tryCreateFromDocument();
    }
}

ChromeExtensionBootstrap.run();
