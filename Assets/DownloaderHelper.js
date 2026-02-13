"use strict";
class DownloaderHelper {
    urlParamName = 'url';
    openParamName = 'downloader';
    hashUrlPrefix = '#swarmui-downloader=';
    openHashes = new Set(['#model-downloader', '#utilities-modeldownloader-tab']);
    pollIntervalMs = 300;
    lastAppliedUrl = null;
    lastOpenToken = null;
    constructor() {
        this.processIncomingUrl();
        setInterval(() => this.processIncomingUrl(), this.pollIntervalMs);
    }
    trimToUrlOrNull(value) {
        if (!value) {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    getIncomingUrlFromHash(parsedUrl) {
        const rawHash = parsedUrl.hash || '';
        if (!rawHash.toLowerCase().startsWith(this.hashUrlPrefix)) {
            return null;
        }
        let hashPayload = rawHash.substring(this.hashUrlPrefix.length);
        if (hashPayload.includes('&')) {
            hashPayload = hashPayload.substring(0, hashPayload.indexOf('&'));
        }
        try {
            hashPayload = decodeURIComponent(hashPayload);
        }
        catch { }
        return this.trimToUrlOrNull(hashPayload);
    }
    hasHashDownloaderTrigger(parsedUrl) {
        if (this.openHashes.has(parsedUrl.hash.toLowerCase())) {
            return true;
        }
        return this.getIncomingUrlFromHash(parsedUrl) != null;
    }
    shouldOpenDownloader(parsedUrl, incomingUrl) {
        if (parsedUrl.searchParams.has(this.openParamName)
            || this.hasHashDownloaderTrigger(parsedUrl)) {
            return true;
        }
        return incomingUrl != null;
    }
    getOpenToken(parsedUrl, incomingUrl) {
        return `${incomingUrl ?? ''}|${parsedUrl.searchParams.has(this.openParamName)}|${parsedUrl.hash}`;
    }
    isDownloaderReady() {
        return window.modelDownloader != null && typeof window.modelDownloader.urlInput === 'function';
    }
    openDownloaderTab() {
        const utilitiesTab = document.getElementById('utilitiestabbutton');
        const downloaderTab = document.getElementById('modeldownloadertabbutton');
        if (!utilitiesTab || !downloaderTab) {
            return;
        }
        utilitiesTab.click();
        requestAnimationFrame(() => {
            downloaderTab.click();
            setTimeout(() => downloaderTab.click(), 60);
        });
    }
    applyIncomingUrl(url) {
        if (!this.isDownloaderReady() || url === this.lastAppliedUrl) {
            return;
        }
        const input = getRequiredElementById('model_downloader_url');
        input.value = url;
        window.modelDownloader?.urlInput();
        this.lastAppliedUrl = url;
    }
    clearTransientLocationState(parsedUrl, hadHashUrl, hadQueryUrl) {
        const updated = new URL(parsedUrl.toString());
        let wasChanged = false;
        if (hadHashUrl && updated.hash.toLowerCase().startsWith(this.hashUrlPrefix)) {
            updated.hash = '';
            wasChanged = true;
        }
        if ((hadHashUrl || hadQueryUrl) && updated.searchParams.has(this.urlParamName)) {
            updated.searchParams.delete(this.urlParamName);
            wasChanged = true;
        }
        if ((hadHashUrl || hadQueryUrl) && updated.searchParams.has(this.openParamName)) {
            updated.searchParams.delete(this.openParamName);
            wasChanged = true;
        }
        if (wasChanged) {
            history.replaceState(history.state, '', `${updated.pathname}${updated.search}${updated.hash}`);
        }
    }
    processIncomingUrl() {
        const parsed = new URL(window.location.href);
        const hashIncomingUrl = this.getIncomingUrlFromHash(parsed);
        const queryIncomingUrl = this.trimToUrlOrNull(parsed.searchParams.get(this.urlParamName));
        const incomingUrl = hashIncomingUrl ?? queryIncomingUrl;
        const shouldOpen = this.shouldOpenDownloader(parsed, incomingUrl);
        if (shouldOpen) {
            const token = this.getOpenToken(parsed, incomingUrl);
            if (token !== this.lastOpenToken) {
                this.openDownloaderTab();
                this.lastOpenToken = token;
            }
        }
        else {
            this.lastOpenToken = null;
        }
        if (!incomingUrl) {
            this.lastAppliedUrl = null;
            return;
        }
        this.applyIncomingUrl(incomingUrl);
        this.clearTransientLocationState(parsed, hashIncomingUrl != null, queryIncomingUrl != null);
    }
}
new DownloaderHelper();
//# sourceMappingURL=DownloaderHelper.js.map