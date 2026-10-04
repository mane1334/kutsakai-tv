#Requires -Version 5.1
<#
  Restore de um backup feito pelo backup.ps1 (ou pelo workflow do GitHub).

  Uso:
    $env:KUTSAKAI_API = "https://api.kutsakai.dpdns.org/v1"
    $env:KUTSAKAI_ADMIN_EMAIL = "teu-email@gmail.com"
    $env:KUTSAKAI_ADMIN_PASSWORD = "tua-password"
    .\scripts\restore.ps1 -File .\backups\backup-2026-10-04_12-30.json

  NOTA: após um apagamento, regista primeiro a conta admin no site
  (para o login funcionar) e só depois corre o restore.
#>
param(
  [Parameter(Mandatory = $true)][string]$File,
  [string]$ApiBase = $env:KUTSAKAI_API,
  [string]$Email = $env:KUTSAKAI_ADMIN_EMAIL,
  [string]$Password = $env:KUTSAKAI_ADMIN_PASSWORD
)

$ErrorActionPreference = 'Stop'
if (-not $ApiBase) { $ApiBase = 'https://api.kutsakai.dpdns.org/v1' }
if (-not $Email -or -not $Password) { throw 'Define KUTSAKAI_ADMIN_EMAIL e KUTSAKAI_ADMIN_PASSWORD.' }
if (-not (Test-Path $File)) { throw "Ficheiro não encontrado: $File" }

$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
if (-not $login.accessToken) { throw 'Login falhou.' }

$body = Get-Content $File -Raw
$res = Invoke-RestMethod -Method Post -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -ContentType 'application/json' -Body $body -Uri "$ApiBase/admin/restore"
$res.restored.PSObject.Properties | ForEach-Object { Write-Host ("  {0,-20} {1}" -f $_.Name, $_.Value) }
Write-Host 'Restore concluído.'
