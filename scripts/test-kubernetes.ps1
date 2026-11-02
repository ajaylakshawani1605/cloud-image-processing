# Verify the local kind deployment through real port-forwards, then restore Compose.
$ErrorActionPreference='Continue'
$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.local/kubeconfig')) { throw 'Create the project kind cluster with .local/kubeconfig first.' }
$previousKubeconfig=$env:KUBECONFIG
$previousBaseUrl=$env:BASE_URL
$previousLiveE2e=$env:LIVE_E2E
$previousGrafanaPassword=$env:GRAFANA_ADMIN_PASSWORD
$env:KUBECONFIG=(Resolve-Path '.local/kubeconfig').Path
$forwardProcesses=@()
try {
  docker compose --profile monitoring stop
  if ($LASTEXITCODE -ne 0) { throw 'Could not free the Compose host ports.' }
  $kubectlExecutable=(Get-Command kubectl -ErrorAction Stop).Source
  $forwards=@(
    @{Name='frontend';Ports=@('8080:8080')},
    @{Name='api';Ports=@('3000:3000')},
    @{Name='minio';Ports=@('9000:9000','9001:9001')},
    @{Name='prometheus';Ports=@('9090:9090')},
    @{Name='grafana';Ports=@('3002:3000')}
  )
  foreach ($forward in $forwards) {
    $arguments=@('--kubeconfig','.local/kubeconfig','-n','cloudframe','port-forward',('service/'+$forward.Name))+$forward.Ports
    $forwardProcesses+=Start-Process -FilePath $kubectlExecutable -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput ('.local/pf-'+$forward.Name+'.out.log') -RedirectStandardError ('.local/pf-'+$forward.Name+'.err.log')
  }
  $forwardReady=$false
  for ($index=0;$index -lt 20;$index++) {
    try {
      $health=Invoke-RestMethod 'http://localhost:3000/api/v1/health/ready' -TimeoutSec 5 -ErrorAction Stop
      Invoke-WebRequest -UseBasicParsing 'http://localhost:8080/' -TimeoutSec 5 -ErrorAction Stop | Out-Null
      Invoke-WebRequest -UseBasicParsing 'http://localhost:9000/minio/health/live' -TimeoutSec 5 -ErrorAction Stop | Out-Null
      if ($health.services.database -eq 'up') { $forwardReady=$true;break }
    } catch { Start-Sleep -Seconds 2 }
  }
  if (-not $forwardReady) { throw 'Kubernetes port-forward readiness did not succeed.' }
  $env:BASE_URL='http://localhost:8080'
  $env:LIVE_E2E='1'
  npm.cmd run test:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Kubernetes browser verification failed.' }
  $encodedGrafanaPassword=kubectl -n cloudframe get secret app-secrets -o 'jsonpath={.data.GF_SECURITY_ADMIN_PASSWORD}'
  $env:GRAFANA_ADMIN_PASSWORD=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedGrafanaPassword))
  node scripts/monitoring-check.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Kubernetes monitoring verification failed.' }
} finally {
  foreach ($forwardProcess in $forwardProcesses) { Stop-Process -InputObject $forwardProcess -Force -ErrorAction SilentlyContinue }
  $env:KUBECONFIG=$previousKubeconfig
  $env:BASE_URL=$previousBaseUrl
  $env:LIVE_E2E=$previousLiveE2e
  $env:GRAFANA_ADMIN_PASSWORD=$previousGrafanaPassword
  docker compose --profile monitoring up -d --no-build --wait --wait-timeout 180
}
