#Requires -Version 5.1
<#
  Backup automático da Kutsakai TV (users, favoritos, subs, pagamentos, PREMIUM).
  Os canais re-semeiam sozinhos; o resto é isto que salva.

  Uso:
    $env:KUTSAKAI_API = "https://api.kutsakai.dpdns.org/v1"
    $env:KUTSAKAI_ADMIN_EMAIL = "teu-email@gmail.com"
    $env:KUTSAKAI_ADMIN_PASSWORD = "tua-password"
    .\scripts\backup.ps1

  O ficheiro sai em backups/backup-AAAA-MM-DD_HH-mm.json (guarda em privado:
  contém hashes de passwords — nunca subir para o GitHub).
#>
param(
  [string]$ApiBase = $env:KUTSAKAI_API,
  [string]$Email = $env:KUTSAKAI_ADMIN_EMAIL,
  [string]$Password = $env:KUTSAKAI_ADMIN_PASSWORD,
  [string]$OutDir = (Join-Path $PSScriptRoot '..' 'backups'),
  [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
if (-not $ApiBase) { $ApiBase = 'https://api.kutsakai.dpdns.org/v1' }
if (-not $Email -or -not $Password) { throw 'Define KUTSAKAI_ADMIN_EMAIL e KUTSAKAI_ADMIN_PASSWORD (ou passa -Email/-Password).' }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "A autenticar $Email ..."
$login = Invoke-RestMethod -Method Post -Uri "$ApiBase/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
if (-not $login.accessToken) { throw 'Login falhou (email/password ou API em baixo).' }

$file = Join-Path $OutDir ("backup-{0}.json" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm'))
Write-Host 'A descarregar backup ...'
Invoke-WebRequest -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -Uri "$ApiBase/admin/backup" -OutFile $file | Out-Null

$json = Get-Content $file -Raw | ConvertFrom-Json
foreach ($t in $json.tables.PSObject.Properties) {
  Write-Host ("  {0,-20} {1}" -f $t.Name, @($t.Value).Count)
}
Write-Host "OK: $file"

# rotação: mantém os últimos $Keep
Get-ChildItem $OutDir -Filter 'backup-*.json' | Sort-Object Name -Descending |
  Select-Object -Skip $Keep | Remove-Item -Force
