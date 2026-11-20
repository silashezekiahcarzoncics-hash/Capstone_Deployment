$ErrorActionPreference = "Stop"

$trustedCertificates = @(
    "Cert:\LocalMachine\Root",
    "Cert:\CurrentUser\Root"
) | ForEach-Object {
    if (Test-Path $_) {
        Get-ChildItem -Path $_ -ErrorAction SilentlyContinue
    }
} | Where-Object { -not $_.HasPrivateKey } | Sort-Object Thumbprint -Unique

if (-not $trustedCertificates) {
    throw "No Windows trusted root certificates were found for Node.js TLS."
}

$pem = [System.Text.StringBuilder]::new()
foreach ($certificate in $trustedCertificates) {
    $encoded = [Convert]::ToBase64String($certificate.RawData)
    [void]$pem.AppendLine("-----BEGIN CERTIFICATE-----")
    for ($offset = 0; $offset -lt $encoded.Length; $offset += 64) {
        $length = [Math]::Min(64, $encoded.Length - $offset)
        [void]$pem.AppendLine($encoded.Substring($offset, $length))
    }
    [void]$pem.AppendLine("-----END CERTIFICATE-----")
}

$caBundlePath = Join-Path ([System.IO.Path]::GetTempPath()) "saipher-node-trusted-roots-$PID.pem"
[System.IO.File]::WriteAllText($caBundlePath, $pem.ToString(), [System.Text.UTF8Encoding]::new($false))
$env:NODE_EXTRA_CA_CERTS = $caBundlePath

try {
    Write-Host "Starting the backend with Windows trusted root certificates."
    # Keep the backend process stable while local data files are reset.
    # Restart this terminal manually when changing backend source files.
    & node server/server.js
    exit $LASTEXITCODE
}
finally {
    Remove-Item -LiteralPath $caBundlePath -Force -ErrorAction SilentlyContinue
}
