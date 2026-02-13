"use strict";
/// <reference types="chrome" />
class ChromeExtensionConstants {
    static storageTargetUrl = "targetUrl";
    static storageTargetTabId = "targetTabId";
    static storageUsePopupWindow = "usePopupWindow";
    static sourceUrlParamKey = "url";
    static downloaderParamKey = "downloader";
    static downloaderParamValue = "1";
    static swarmUiPathSegment = "Text2Image";
    static inPlaceHashKey = "swarmui-downloader";
    static menuId = "send-to-swarmui";
    static menuTitle = "Send to SwarmUI";
}
class ChromeUrlTools {
    static parseTargetServerUrl(targetUrl) {
        const parsed = this.tryParseHttpOrHttpsUrl(targetUrl);
        if (parsed) {
            return parsed;
        }
        throw new Error("SwarmUI server URL is invalid. Use a full URL including http:// or https://.");
    }
    static tryParseHttpOrHttpsUrl(candidate) {
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
    static buildText2ImagePath(currentPath) {
        const trimmed = currentPath.replace(/\/+$/, "");
        if (!trimmed || trimmed === "/") {
            return `/${ChromeExtensionConstants.swarmUiPathSegment}`;
        }
        if (trimmed.endsWith(`/${ChromeExtensionConstants.swarmUiPathSegment}`)) {
            return trimmed;
        }
        return `${trimmed}/${ChromeExtensionConstants.swarmUiPathSegment}`;
    }
    static normalizePath(pathname) {
        return pathname.replace(/\/+$/, "") || "/";
    }
    static buildForwardUrl(targetUrl, sourceUrl) {
        const parsed = this.parseTargetServerUrl(targetUrl);
        parsed.pathname = this.buildText2ImagePath(parsed.pathname);
        parsed.search = "";
        parsed.hash = "";
        parsed.searchParams.set(ChromeExtensionConstants.downloaderParamKey, ChromeExtensionConstants.downloaderParamValue);
        parsed.searchParams.set(ChromeExtensionConstants.sourceUrlParamKey, sourceUrl);
        return parsed.toString();
    }
    static isTabOnTargetText2Image(tabUrl, targetServerUrl) {
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
    static buildInPlaceHash(sourceUrl) {
        return `${ChromeExtensionConstants.inPlaceHashKey}=${encodeURIComponent(sourceUrl)}&t=${Date.now()}`;
    }
    static buildInPlaceTabUrl(existingTabUrl, sourceUrl) {
        const parsed = this.tryParseHttpOrHttpsUrl(existingTabUrl);
        if (!parsed) {
            return null;
        }
        parsed.hash = this.buildInPlaceHash(sourceUrl);
        return parsed.toString();
    }
}
class ChromeForwarderBackground {
    contextMenuSyncPromise = null;
    constructor() {
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
    async onInstalled(details) {
        await this.initializeExtension();
        if (details.reason === "install") {
            await chrome.runtime.openOptionsPage();
        }
    }
    async onContextMenuClicked(info, tab) {
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
    async getStorageValues(keys) {
        const result = await chrome.storage.local.get(keys);
        return result;
    }
    async ensureDefaultSettings() {
        const { targetUrl, usePopupWindow } = await this.getStorageValues([
            ChromeExtensionConstants.storageTargetUrl,
            ChromeExtensionConstants.storageUsePopupWindow
        ]);
        if (!targetUrl) {
            await chrome.storage.local.set({ [ChromeExtensionConstants.storageTargetUrl]: "" });
        }
        if (typeof usePopupWindow !== "boolean") {
            await chrome.storage.local.set({ [ChromeExtensionConstants.storageUsePopupWindow]: true });
        }
    }
    async initializeExtension() {
        try {
            await this.ensureDefaultSettings();
            await this.ensureContextMenu();
        }
        catch (error) {
            console.error("Failed to initialize extension:", error);
        }
    }
    ensureContextMenu() {
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
    createContextMenu() {
        return new Promise((resolve, reject) => {
            chrome.contextMenus.removeAll(() => {
                const removeError = chrome.runtime.lastError;
                if (removeError) {
                    reject(new Error(removeError.message));
                    return;
                }
                chrome.contextMenus.create({
                    id: ChromeExtensionConstants.menuId,
                    title: ChromeExtensionConstants.menuTitle,
                    contexts: ["all"]
                }, () => {
                    const createError = chrome.runtime.lastError;
                    if (createError) {
                        reject(new Error(createError.message));
                        return;
                    }
                    resolve();
                });
            });
        });
    }
    isDuplicateContextMenuError(error) {
        if (!(error instanceof Error)) {
            return false;
        }
        const normalized = error.message.toLowerCase();
        return normalized.includes("duplicate id") && normalized.includes(ChromeExtensionConstants.menuId.toLowerCase());
    }
    getSourceUrl(info, tab) {
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
    shouldOpenOptionsForError(error) {
        return error instanceof Error && error.message.includes("SwarmUI server URL");
    }
    async handleForwardMessage(sourceUrl) {
        const { targetUrl, usePopupWindow } = await this.getStorageValues([
            ChromeExtensionConstants.storageTargetUrl,
            ChromeExtensionConstants.storageUsePopupWindow
        ]);
        if (!targetUrl) {
            throw new Error("Set a SwarmUI server URL in extension options before forwarding URLs.");
        }
        const forwardUrl = ChromeUrlTools.buildForwardUrl(targetUrl, sourceUrl);
        const tabId = await this.getOrCreateTargetTab(targetUrl, sourceUrl, forwardUrl, usePopupWindow === true);
        await chrome.storage.local.set({ [ChromeExtensionConstants.storageTargetTabId]: tabId });
    }
    async getOrCreateTargetTab(targetUrl, sourceUrl, forwardUrl, usePopupWindow) {
        const { targetTabId } = await this.getStorageValues([ChromeExtensionConstants.storageTargetTabId]);
        if (typeof targetTabId !== "number") {
            return await this.createTargetTab(forwardUrl, usePopupWindow);
        }
        try {
            const existingTab = await chrome.tabs.get(targetTabId);
            if (ChromeUrlTools.isTabOnTargetText2Image(existingTab.url, targetUrl)) {
                const inPlaceUrl = ChromeUrlTools.buildInPlaceTabUrl(existingTab.url, sourceUrl);
                const updateProps = { active: true };
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
    async createTargetTab(forwardUrl, usePopupWindow) {
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
class ChromeForwarderOptions {
    targetUrlInput;
    usePopupWindowInput;
    form;
    status;
    constructor(targetUrlInput, usePopupWindowInput, form, status) {
        this.targetUrlInput = targetUrlInput;
        this.usePopupWindowInput = usePopupWindowInput;
        this.form = form;
        this.status = status;
        this.form.addEventListener("submit", (event) => {
            void this.onSubmit(event);
        });
        void this.loadSettings();
    }
    static tryCreateFromDocument() {
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
    async onSubmit(event) {
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
    async loadSettings() {
        const { targetUrl, usePopupWindow } = await chrome.storage.local.get([
            ChromeExtensionConstants.storageTargetUrl,
            ChromeExtensionConstants.storageUsePopupWindow
        ]);
        this.targetUrlInput.value = typeof targetUrl === "string" ? targetUrl : "";
        this.usePopupWindowInput.checked = usePopupWindow !== false;
    }
    normalizeUrl(value) {
        if (!value) {
            return null;
        }
        const direct = ChromeUrlTools.tryParseHttpOrHttpsUrl(value);
        if (direct) {
            return direct.toString();
        }
        return null;
    }
    setStatus(message, isError = false) {
        this.status.textContent = message;
        this.status.setAttribute("style", `color: ${isError ? "#b00020" : "#146c2e"};`);
    }
}
class ChromeExtensionBootstrap {
    static run() {
        if (typeof document === "undefined") {
            new ChromeForwarderBackground();
            return;
        }
        ChromeForwarderOptions.tryCreateFromDocument();
    }
}
ChromeExtensionBootstrap.run();
