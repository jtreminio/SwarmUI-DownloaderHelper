interface ModelDownloaderApi
{
    urlInput: () => void;
}

declare function getRequiredElementById(id: string): HTMLElement;

interface Window
{
    modelDownloader?: ModelDownloaderApi;
}
