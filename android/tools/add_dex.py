"""Append classes.dex to the unsigned APK without recompressing existing entries.

Android 11+ refuses to install an APK whose resources.arsc is compressed, so the
package is not rebuilt from scratch: the dex is simply appended to the zip, and
zipalign runs afterwards to align the stored entries.
"""
import sys
import zipfile

apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
    z.write(dex, "classes.dex")
print("classes.dex appended to", apk)
