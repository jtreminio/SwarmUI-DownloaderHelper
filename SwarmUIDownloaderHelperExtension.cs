using SwarmUI.Core;

namespace DownloaderHelper;

public class SwarmUIDownloaderHelperExtension : Extension
{
    public override void OnPreInit()
    {
        ScriptFiles.Add("Assets/DownloaderHelper.js");
    }
}
