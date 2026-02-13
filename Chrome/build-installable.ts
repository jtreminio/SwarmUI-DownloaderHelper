import fs from "node:fs";
import path from "node:path";

class ChromeInstallableBuilder
{
    private readonly extensionRootDir: string;
    private readonly chromeSourceDir: string;
    private readonly outputDir: string;
    private readonly outputScriptFile: string;

    public constructor()
    {
        this.extensionRootDir = path.resolve(__dirname, "..");
        this.chromeSourceDir = path.join(this.extensionRootDir, "Chrome");
        this.outputDir = path.join(this.extensionRootDir, "Assets", "Chrome");
        this.outputScriptFile = path.join(this.outputDir, "chrome-extension.js");
    }

    public build(): void
    {
        this.ensureOutputFolder();
        this.ensureCompiledScriptExists();
        this.copyFile("manifest.json");
        this.copyFile("options.html");
        console.log(`Chrome extension install files generated in ${this.outputDir}`);
    }

    private ensureOutputFolder(): void
    {
        fs.mkdirSync(this.outputDir, { recursive: true });
    }

    private ensureCompiledScriptExists(): void
    {
        if (!fs.existsSync(this.outputScriptFile)) {
            throw new Error(`Expected compiled script at ${this.outputScriptFile} but it was not found.`);
        }
    }

    private copyFile(fileName: string): void
    {
        const source = path.join(this.chromeSourceDir, fileName);
        const target = path.join(this.outputDir, fileName);
        fs.copyFileSync(source, target);
    }
}

new ChromeInstallableBuilder().build();
