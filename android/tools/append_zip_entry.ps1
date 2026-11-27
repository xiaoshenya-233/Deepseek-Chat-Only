# Append one STORED entry to an existing APK without touching existing entries.
#
# Equivalent to `add_dex.py`, but dependency-free on Windows PowerShell:
# Python/zipfile is not always available. The entry is written after the old
# central directory; a fresh central directory plus EOCD is appended so that
# existing entries (including the uncompressed resources.arsc) stay byte-identical.
param(
    [Parameter(Mandatory = $true)][string]$Apk,
    [Parameter(Mandatory = $true)][string]$Entry,
    [string]$Name = 'classes.dex'
)

$ErrorActionPreference = 'Stop'

$apkPath = (Resolve-Path -LiteralPath $Apk).Path
$entryPath = (Resolve-Path -LiteralPath $Entry).Path
$bytes = [System.IO.File]::ReadAllBytes($apkPath)
$data = [System.IO.File]::ReadAllBytes($entryPath)

if ($bytes.Length -lt 22) { throw "APK is too small to be a zip archive" }
if ($Name -ne [System.IO.Path]::GetFileName($Name) -or $Name.Contains('\')) {
    throw "Entry name must be a plain file name"
}

# CRC32 (IEEE 802.3, same table as zip).
$table = New-Object 'uint32[]' 256
for ($index = 0; $index -lt 256; $index++) {
    [uint32]$value = [uint32]$index
    for ($bit = 0; $bit -lt 8; $bit++) {
        if (($value -band 1) -ne 0) {
            $value = [uint32]([uint32]3988292384 -bxor ($value -shr 1))
        } else {
            $value = [uint32]($value -shr 1)
        }
    }
    $table[$index] = $value
}
[uint32]$crc = [uint32]::MaxValue
for ($index = 0; $index -lt $data.Length; $index++) {
    $mixed = [int](($crc -bxor [uint32]$data[$index]) -band [uint32]255)
    $shifted = [uint32]($crc -shr 8)
    $crc = [uint32]($table[$mixed] -bxor $shifted)
}
$crc = [uint32]($crc -bxor [uint32]::MaxValue)

# Locate End Of Central Directory.
$eocd = -1
$limit = [Math]::Max(0, $bytes.Length - 65557)
for ($index = $bytes.Length - 22; $index -ge $limit; $index--) {
    if ($bytes[$index] -eq 0x50 -and $bytes[$index + 1] -eq 0x4B `
            -and $bytes[$index + 2] -eq 0x05 -and $bytes[$index + 3] -eq 0x06) {
        $eocd = $index
        break
    }
}
if ($eocd -lt 0) { throw "End of central directory not found; the APK is not a zip" }

$count = [int][System.BitConverter]::ToUInt16($bytes, $eocd + 10)
$cdSize = [int][System.BitConverter]::ToUInt32($bytes, $eocd + 12)
$cdOffset = [int][System.BitConverter]::ToUInt32($bytes, $eocd + 16)
if (($cdOffset + $cdSize) -gt $bytes.Length) { throw "Corrupt central directory offset" }

$nameBytes = [System.Text.Encoding]::UTF8.GetBytes($Name)
[uint32]$size = [uint32]$data.Length
$localOffset = $bytes.Length

# Local file header (STORED, UTF-8 flag, fixed 1980-01-01 timestamp).
$localStream = New-Object System.IO.MemoryStream
$localWriter = New-Object System.IO.BinaryWriter($localStream)
$localWriter.Write([uint32]0x04034B50)
$localWriter.Write([uint16]20)
$localWriter.Write([uint16]0x0800)
$localWriter.Write([uint16]0)
$localWriter.Write([uint16]0)
$localWriter.Write([uint16]0x0021)
$localWriter.Write([uint32]$crc)
$localWriter.Write([uint32]$size)
$localWriter.Write([uint32]$size)
$localWriter.Write([uint16]$nameBytes.Length)
$localWriter.Write([uint16]0)
$localWriter.Write($nameBytes)
$localWriter.Write($data)
$localWriter.Flush()
$localRecord = $localStream.ToArray()
$localWriter.Dispose()

# New central directory record.
$recordStream = New-Object System.IO.MemoryStream
$recordWriter = New-Object System.IO.BinaryWriter($recordStream)
$recordWriter.Write([uint32]0x02014B50)
$recordWriter.Write([uint16]20)
$recordWriter.Write([uint16]20)
$recordWriter.Write([uint16]0x0800)
$recordWriter.Write([uint16]0)
$recordWriter.Write([uint16]0)
$recordWriter.Write([uint16]0x0021)
$recordWriter.Write([uint32]$crc)
$recordWriter.Write([uint32]$size)
$recordWriter.Write([uint32]$size)
$recordWriter.Write([uint16]$nameBytes.Length)
$recordWriter.Write([uint16]0)
$recordWriter.Write([uint16]0)
$recordWriter.Write([uint16]0)
$recordWriter.Write([uint16]0)
$recordWriter.Write([uint32]0)
$recordWriter.Write([uint32]$localOffset)
$recordWriter.Write($nameBytes)
$recordWriter.Flush()
$record = $recordStream.ToArray()
$recordWriter.Dispose()

$newCdOffset = $localOffset + $localRecord.Length
$newCdSize = $cdSize + $record.Length

# End of central directory.
$eocdStream = New-Object System.IO.MemoryStream
$eocdWriter = New-Object System.IO.BinaryWriter($eocdStream)
$eocdWriter.Write([uint32]0x06054B50)
$eocdWriter.Write([uint16]0)
$eocdWriter.Write([uint16]0)
$eocdWriter.Write([uint16]($count + 1))
$eocdWriter.Write([uint16]($count + 1))
$eocdWriter.Write([uint32]$newCdSize)
$eocdWriter.Write([uint32]$newCdOffset)
$eocdWriter.Write([uint16]0)
$eocdWriter.Flush()
$eocdRecord = $eocdStream.ToArray()
$eocdWriter.Dispose()

$output = New-Object System.IO.MemoryStream
$output.Write($bytes, 0, $bytes.Length)
$output.Write($localRecord, 0, $localRecord.Length)
$output.Write($bytes, $cdOffset, $cdSize)
$output.Write($record, 0, $record.Length)
$output.Write($eocdRecord, 0, $eocdRecord.Length)

[System.IO.File]::WriteAllBytes($apkPath, $output.ToArray())
$output.Dispose()

Write-Host ("{0} appended to {1} ({2:N0} bytes, {3} bytes stored)" -f `
        $Name, (Split-Path -Leaf $apkPath), $data.Length, $size)
