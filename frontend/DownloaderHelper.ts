class DownloaderHelper {
    private readonly urlParamName = 'url';
    private readonly openParamName = 'downloader';
    private readonly hashUrlPrefix = '#swarmui-downloader=';
    private readonly openHashes = new Set(['#model-downloader', '#utilities-modeldownloader-tab']);
    private readonly pollIntervalMs = 300;

    private lastAppliedUrl: string | null = null;
    private lastOpenToken: string | null = null;

    public constructor()
    {
        this.processIncomingUrl();
        setInterval(() => this.processIncomingUrl(), this.pollIntervalMs);
    }

    private trimToUrlOrNull(value: string | null): string | null
    {
        if (!value) {
            return null;
        }

        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    private getIncomingUrlFromHash(parsedUrl: URL): string | null
    {
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

    private hasHashDownloaderTrigger(parsedUrl: URL): boolean
    {
        if (this.openHashes.has(parsedUrl.hash.toLowerCase())) {
            return true;
        }
        
        return this.getIncomingUrlFromHash(parsedUrl) != null;
    }

    private shouldOpenDownloader(parsedUrl: URL, incomingUrl: string | null): boolean
    {
        if (
            parsedUrl.searchParams.has(this.openParamName)
            || this.hasHashDownloaderTrigger(parsedUrl)
        ) {
            return true;
        }

        return incomingUrl != null;
    }

    private getOpenToken(parsedUrl: URL, incomingUrl: string | null): string
    {
        return `${incomingUrl ?? ''}|${parsedUrl.searchParams.has(this.openParamName)}|${parsedUrl.hash}`;
    }

    private isDownloaderReady(): boolean
    {
        return window.modelDownloader != null && typeof window.modelDownloader.urlInput === 'function';
    }

    private openDownloaderTab(): void
    {
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

    private applyIncomingUrl(url: string): void
    {
        if (!this.isDownloaderReady() || url === this.lastAppliedUrl) {
            return;
        }

        const input = getRequiredElementById('model_downloader_url') as HTMLInputElement;
        input.value = url;
        window.modelDownloader?.urlInput();
        this.lastAppliedUrl = url;
    }

    private clearTransientLocationState(parsedUrl: URL, hadHashUrl: boolean, hadQueryUrl: boolean): void
    {
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

    private processIncomingUrl(): void
    {
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
