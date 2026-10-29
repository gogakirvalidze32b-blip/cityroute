param()

$ErrorActionPreference = 'Stop'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'psql is required to run the local concurrency test.'
}

$allowedHosts = @('localhost', '127.0.0.1', '::1')
if ($allowedHosts -notcontains $env:PGHOST -or $env:PGPORT -ne '54322') {
  throw 'This harness only connects to local Supabase at localhost:54322. Set PGHOST and PGPORT for that local stack.'
}

$profileId = $env:CITYROUTE_DEVICE_TEST_PROFILE_ID
if ($profileId -notmatch '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$') {
  throw 'Set CITYROUTE_DEVICE_TEST_PROFILE_ID to a dedicated local test profile UUID.'
}

$preflight = @"
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM public.profiles p
  WHERE p.id = '$profileId'::uuid
    AND p.subscription_status = 'active'
    AND p.subscription_plan = 'premium'
    AND p.device_slots = 1
    AND p.subscription_expires_at > now()
    AND p.device_fingerprint IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.payment_transactions t
      WHERE t.user_id = p.id
        AND t.provider = 'bog'
        AND t.payment_id = p.subscription_payment_id
        AND t.status = 'success'
        AND t.currency = 'GEL'
        AND t.amount = 99
        AND t.metadata->>'provider' = 'bog'
        AND t.metadata->>'device_slots' = '1'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profile_devices d WHERE d.profile_id = p.id
    )
) THEN 'ready' ELSE 'not-ready' END;
"@

$preflightResult = (& psql -X --no-psqlrc --no-align --tuples-only --set ON_ERROR_STOP=1 --command $preflight 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $preflightResult -ne 'ready') {
  throw 'The local test profile is not clean, active, and backed by a verified 99 GEL payment. No bind calls were made.'
}

$testToken = [guid]::NewGuid().ToString('N')
$fingerprintA = "concurrency-a-$testToken"
$fingerprintB = "concurrency-b-$testToken"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "cityroute-device-concurrency-$testToken"
New-Item -ItemType Directory -Path $tempRoot | Out-Null

$sessionA = Join-Path $tempRoot 'session-a.sql'
$sessionB = Join-Path $tempRoot 'session-b.sql'
$outputA = Join-Path $tempRoot 'session-a.out'
$outputB = Join-Path $tempRoot 'session-b.out'
$errorA = Join-Path $tempRoot 'session-a.err'
$errorB = Join-Path $tempRoot 'session-b.err'

@"
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$profileId', true);
SELECT public.bind_device('$fingerprintA')->>'status';
SELECT pg_sleep(8);
COMMIT;
"@ | Set-Content -Encoding ascii $sessionA

@"
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '$profileId', true);
SELECT public.bind_device('$fingerprintB')->>'status';
COMMIT;
"@ | Set-Content -Encoding ascii $sessionB

$processA = $null
$processB = $null
try {
  $quotedA = '"' + $sessionA + '"'
  $processA = Start-Process -FilePath (Get-Command psql).Source `
    -ArgumentList "-X --no-psqlrc --no-align --tuples-only --set ON_ERROR_STOP=1 --file $quotedA" `
    -PassThru -NoNewWindow -RedirectStandardOutput $outputA -RedirectStandardError $errorA

  $deadline = (Get-Date).AddSeconds(6)
  while ((Get-Date) -lt $deadline) {
    if ((Test-Path $outputA) -and (Get-Content $outputA -Raw).Contains('bound')) { break }
    if ($processA.HasExited) { throw 'First local bind did not complete successfully.' }
    Start-Sleep -Milliseconds 100
  }
  if (-not (Test-Path $outputA) -or -not (Get-Content $outputA -Raw).Contains('bound')) {
    throw 'Timed out waiting for the first local bind to acquire its slot.'
  }

  $quotedB = '"' + $sessionB + '"'
  $processB = Start-Process -FilePath (Get-Command psql).Source `
    -ArgumentList "-X --no-psqlrc --no-align --tuples-only --set ON_ERROR_STOP=1 --file $quotedB" `
    -PassThru -NoNewWindow -RedirectStandardOutput $outputB -RedirectStandardError $errorB

  $processA.WaitForExit()
  $processB.WaitForExit()
  if ($processA.ExitCode -ne 0 -or $processB.ExitCode -ne 0) {
    throw 'A local PostgreSQL bind session failed; inspect local psql stderr output.'
  }

  $resultA = (Get-Content $outputA | Where-Object { $_ -in @('bound', 'blocked', 'ok') } | Select-Object -First 1).Trim()
  $resultB = (Get-Content $outputB | Where-Object { $_ -in @('bound', 'blocked', 'ok') } | Select-Object -First 1).Trim()
  if ($resultA -ne 'bound' -or $resultB -ne 'blocked') {
    throw "Expected concurrent bind results bound/blocked, got '$resultA'/'$resultB'."
  }

  Write-Output 'PASS: concurrent one-slot binds returned one bound and one blocked result.'
}
finally {
  if ($processA -and -not $processA.HasExited) { Stop-Process -Id $processA.Id }
  if ($processB -and -not $processB.HasExited) { Stop-Process -Id $processB.Id }
  $cleanup = @"
DELETE FROM public.profile_devices
WHERE profile_id = '$profileId'::uuid
  AND fingerprint IN ('$fingerprintA', '$fingerprintB');
UPDATE public.profiles
SET device_fingerprint = NULL, device_bound_at = NULL
WHERE id = '$profileId'::uuid
  AND device_fingerprint IN ('$fingerprintA', '$fingerprintB');
"@
  & psql -X --no-psqlrc --set ON_ERROR_STOP=1 --command $cleanup 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'Local test cleanup failed; inspect the dedicated test profile before rerunning.'
  }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
