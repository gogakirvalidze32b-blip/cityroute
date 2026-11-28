param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string] $ProjectRef,

  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string] $PsqlPath,

  [Parameter(Mandatory = $true)]
  [string] $ConfirmDisposableProject
)

$ErrorActionPreference = 'Stop'
$expectedHost = "db.$ProjectRef.supabase.co"

if ($ConfirmDisposableProject -cne "CITYROUTE-BOG-TEST-ONLY:$ProjectRef") {
  throw 'Explicit confirmation of the newly created disposable test project is required.'
}
if ($env:PGHOST -cne $expectedHost) {
  throw 'PGHOST must exactly match the temporary test project direct-connection host.'
}
if ($env:PGPORT -cne '5432' -or $env:PGDATABASE -cne 'postgres' -or $env:PGUSER -cne 'postgres') {
  throw 'Use the temporary project direct connection: PGPORT=5432, PGDATABASE=postgres, PGUSER=postgres.'
}
if ($env:PGSSLMODE -notin @('require', 'verify-ca', 'verify-full')) {
  throw 'Set PGSSLMODE=require or stricter for the hosted test connection.'
}
if (-not $env:PGPASSWORD -and -not $env:PGPASSFILE) {
  throw 'Set PGPASSFILE or PGPASSWORD securely for this process; never place credentials in this script or its arguments.'
}

$runId = [guid]::NewGuid().ToString()
$runNoHyphens = $runId.Replace('-', '')
$user032 = [guid]::NewGuid().ToString()
$user034 = [guid]::NewGuid().ToString()
$user035 = [guid]::NewGuid().ToString()
$keys = @()
for ($i = 0; $i -lt 6; $i++) {
  $keys += [guid]::NewGuid().ToString()
}
$payment03299 = "m032-99-$runNoHyphens"
$payment032179 = "m032-179-$runNoHyphens"
$merchant03299 = "cr-$($keys[4])"
$merchant032179 = "cr-$($keys[5])"
$payment035 = "m035-hosted-$runNoHyphens"
$merchant035 = "m035-merchant-$runNoHyphens"
$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "bog-hosted-test-$runNoHyphens"
$supportSchemaCreated = $false
$barrierSqlPath = Join-Path $PSScriptRoot 'bog_concurrency_barrier.sql'
if (-not (Test-Path -LiteralPath $barrierSqlPath -PathType Leaf)) {
  throw 'Missing bog_concurrency_barrier.sql next to the hosted concurrency harness.'
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,
    [string] $RunId
  )

  $arguments = @('-X', '--no-password', '-v', 'ON_ERROR_STOP=1')
  if ($RunId) {
    $arguments += @('-v', "run_id=$RunId")
  }
  $arguments += @('-f', $FilePath)
  & $PsqlPath @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed with exit code $LASTEXITCODE for $([System.IO.Path]::GetFileName($FilePath))."
  }
}

function Start-RaceSessions {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Scenario,
    [Parameter(Mandatory = $true)]
    [string[]] $WorkerFiles,
    [int] $TimeoutSeconds = 60
  )

  $processes = @()
  $failures = @()
  for ($index = 0; $index -lt $WorkerFiles.Count; $index++) {
    $stdoutPath = Join-Path $tempDirectory "$Scenario-$index.out"
    $stderrPath = Join-Path $tempDirectory "$Scenario-$index.err"
    $quotedFile = '"' + $WorkerFiles[$index] + '"'
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $PsqlPath
    $startInfo.Arguments = "-X --no-password -v ON_ERROR_STOP=1 -f $quotedFile"
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables['PGHOST'] = $env:PGHOST
    $startInfo.EnvironmentVariables['PGPORT'] = $env:PGPORT
    $startInfo.EnvironmentVariables['PGDATABASE'] = $env:PGDATABASE
    $startInfo.EnvironmentVariables['PGUSER'] = $env:PGUSER
    $startInfo.EnvironmentVariables['PGSSLMODE'] = $env:PGSSLMODE
    if ($env:PGPASSWORD) {
      $startInfo.EnvironmentVariables['PGPASSWORD'] = $env:PGPASSWORD
    }
    if ($env:PGPASSFILE) {
      $startInfo.EnvironmentVariables['PGPASSFILE'] = $env:PGPASSFILE
    }

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
      if (-not $process.Start()) {
        throw "Could not start independent psql session $index for $Scenario."
      }
      $stdoutTask = $process.StandardOutput.ReadToEndAsync()
      $stderrTask = $process.StandardError.ReadToEndAsync()
      $processes += [pscustomobject]@{
        Process = $process
        Stdout = $stdoutTask
        Stderr = $stderrTask
        StdoutPath = $stdoutPath
        StderrPath = $stderrPath
      }
    }
    catch {
      $failures += $_.Exception.Message
      $process.Dispose()
    }
  }

  function Stop-SiblingWorkers {
    foreach ($item in $processes) {
      if ($item.Process -and -not $item.Process.HasExited) {
        try { $item.Process.Kill() } catch { }
      }
    }
  }

  $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
  foreach ($item in $processes) {
    $remainingMs = [int]([math]::Max(1, ($deadline - [datetime]::UtcNow).TotalMilliseconds))
    if (-not $item.Process.WaitForExit($remainingMs)) {
      Stop-SiblingWorkers
      $failures += "A $Scenario independent psql session timed out after $TimeoutSeconds seconds."
      break
    }
    if ($item.Process.ExitCode -ne 0) {
      Stop-SiblingWorkers
    }
  }

  foreach ($item in $processes) {
    if ($item.Process -and -not $item.Process.HasExited) {
      $item.Process.WaitForExit(5000) | Out-Null
    }
    $stdout = $null
    $stderr = $null
    try { $stdout = $item.Stdout.Result } catch { }
    try { $stderr = $item.Stderr.Result } catch { }
    if ($stdout) {
      Set-Content -LiteralPath $item.StdoutPath -Value $stdout -NoNewline
    }
    if ($stderr) {
      Set-Content -LiteralPath $item.StderrPath -Value $stderr -NoNewline
    }
    if ($item.Process.ExitCode -ne 0) {
      $failures += "A $Scenario independent psql session failed (exit $($item.Process.ExitCode)): $stderr"
    }
    $item.Process.Dispose()
  }
  if ($failures.Count -gt 0) {
    throw ($failures -join [Environment]::NewLine)
  }
}

function Write-WorkerFile {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Scenario,
    [Parameter(Mandatory = $true)]
    [string] $Actor,
    [Parameter(Mandatory = $true)]
    [string] $Body
  )

  $path = Join-Path $tempDirectory "$Scenario-$Actor.sql"
  # Barrier uses session-level advisory locks (see bog_concurrency_barrier.sql).
  # It must not wait on uncommitted concurrent_results rows.
  $content = @"
begin;
select bog_test_support.barrier_enter('$runId'::uuid, '$Scenario', '$Actor', 30);
$Body
select bog_test_support.barrier_leave('$runId'::uuid, '$Scenario', '$Actor');
commit;
"@
  Set-Content -LiteralPath $path -Value $content -Encoding ASCII

  # Guardrail: generated SQL must never embed password material.
  $generated = Get-Content -LiteralPath $path -Raw
  if ($generated -match '(?i)\bPGPASSWORD\b|(?<![A-Za-z_])password\s*=') {
    throw "Refusing to keep generated worker SQL that appears to contain password material: $path"
  }
  return $path
}

$setupFile = Join-Path $tempDirectory 'setup.sql'
$cleanupFile = Join-Path $tempDirectory 'cleanup.sql'

try {
  New-Item -ItemType Directory -Path $tempDirectory | Out-Null

  $identityQuery = "select current_database() || '|' || current_setting('server_version_num') || '|' || current_user"
  $identity = & $PsqlPath -X --no-password -A -t -q -c $identityQuery
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not verify the temporary project database connection.'
  }
  $identityParts = "$identity".Trim().Split('|')
  if ($identityParts.Count -ne 3 -or $identityParts[0] -cne 'postgres' -or
      [int]$identityParts[1] -lt 170000 -or [int]$identityParts[1] -ge 180000 -or
      $identityParts[2] -cne 'postgres') {
    throw 'Connection identity is not the expected PostgreSQL 17 temporary Supabase project; no fixtures were created.'
  }

  $setupSql = @"
do `$preflight`$
begin
  if current_database() <> 'postgres'
     or current_setting('server_version_num')::integer not between 170000 and 179999
     or to_regclass('public.payment_transactions') is null
     or to_regclass('public.device_slot_packages') is null
     or to_regprocedure('public.create_bog_pending_payment(uuid,text,text,uuid,numeric,integer,jsonb)') is null
     or to_regprocedure('public.acquire_bog_checkout_recovery_lease(text,integer)') is null
     or to_regprocedure('public.update_bog_payment_status(text,text,text,jsonb)') is null
     or not exists (select 1 from pg_catalog.pg_extension where extname = 'pgtap')
  then
    raise exception 'Temporary project prerequisites, extensions, or migrations 029/032-035 are missing';
  end if;
  if to_regnamespace('bog_test_support') is not null then
    raise exception 'bog_test_support already exists; inspect the disposable test project before rerunning';
  end if;
end
`$preflight`$;

begin;

create schema bog_test_support;
create table bog_test_support.runs (
  run_id uuid primary key,
  user_032 uuid not null,
  user_034 uuid not null,
  user_035 uuid not null,
  payment_032_99 text not null,
  payment_032_179 text not null,
  merchant_032_99 text not null,
  merchant_032_179 text not null,
  payment_035 text not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table bog_test_support.concurrent_results (
  run_id uuid not null references bog_test_support.runs(run_id) on delete cascade,
  scenario text not null check (scenario in ('settlement', 'pending_claim', 'recovery_lease')),
  actor text not null check (actor in ('a', 'b')),
  outcome text not null,
  backend_pid integer,
  detail text,
  primary key (run_id, scenario, actor)
);

-- Test-only Premium activation accounting (does not alter production RPCs/triggers).
create table bog_test_support.premium_activation_events (
  event_id bigint generated always as identity primary key,
  run_id uuid not null references bog_test_support.runs(run_id) on delete cascade,
  profile_id uuid not null,
  backend_pid integer not null,
  kind text not null check (kind in ('transition')),
  old_status text,
  new_status text,
  old_plan text,
  new_plan text,
  old_expires_at timestamptz,
  new_expires_at timestamptz,
  old_payment_id text,
  new_payment_id text,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

create or replace function bog_test_support.record_premium_activation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, bog_test_support, public
as `$record_activation`$
declare
  v_run_id uuid;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Only the confirmer activation path sets this transaction-local GUC.
  if pg_catalog.current_setting('cityroute.premium_activation', true) is distinct from 'on' then
    return new;
  end if;

  select run.run_id
    into v_run_id
    from bog_test_support.runs run
   where run.user_032 = new.id
      or run.user_034 = new.id
      or run.user_035 = new.id
   limit 1;

  if v_run_id is null then
    return new;
  end if;

  -- Count only the real trial/non-premium -> active premium transition.
  if (old.subscription_status is distinct from 'active'
      or old.subscription_plan is distinct from 'premium')
     and new.subscription_status is not distinct from 'active'
     and new.subscription_plan is not distinct from 'premium'
  then
    insert into bog_test_support.premium_activation_events (
      run_id, profile_id, backend_pid, kind,
      old_status, new_status, old_plan, new_plan,
      old_expires_at, new_expires_at, old_payment_id, new_payment_id
    ) values (
      v_run_id, new.id, pg_catalog.pg_backend_pid(), 'transition',
      old.subscription_status, new.subscription_status,
      old.subscription_plan, new.subscription_plan,
      old.subscription_expires_at, new.subscription_expires_at,
      old.subscription_payment_id, new.subscription_payment_id
    );
  end if;

  return new;
end;
`$record_activation`$;

drop trigger if exists bog_test_support_record_premium_activation on public.profiles;
create trigger bog_test_support_record_premium_activation
  after update on public.profiles
  for each row
  execute function bog_test_support.record_premium_activation();

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('$user032', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bog-test-$runNoHyphens-032@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('$user034', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bog-test-$runNoHyphens-034@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('$user035', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bog-test-$runNoHyphens-035@example.test', '', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now());

insert into public.profiles (
  id, full_name, trial_started_at, subscription_status, subscription_expires_at, subscription_plan
)
select u.id, '', pg_catalog.now(), 'trial', pg_catalog.now() + interval '12 hours', null
from auth.users u
where u.id in ('$user032', '$user034', '$user035')
and not exists (select 1 from public.profiles p where p.id = u.id);

insert into bog_test_support.runs (
  run_id, user_032, user_034, user_035,
  payment_032_99, payment_032_179, merchant_032_99, merchant_032_179,
  payment_035
)
values (
  '$runId', '$user032', '$user034', '$user035',
  '$payment03299', '$payment032179', '$merchant03299', '$merchant032179',
  '$payment035'
);
insert into bog_test_support.concurrent_results (run_id, scenario, actor, outcome)
values
  ('$runId', 'settlement', 'a', 'waiting'),
  ('$runId', 'settlement', 'b', 'waiting'),
  ('$runId', 'pending_claim', 'a', 'waiting'),
  ('$runId', 'pending_claim', 'b', 'waiting'),
  ('$runId', 'recovery_lease', 'a', 'waiting'),
  ('$runId', 'recovery_lease', 'b', 'waiting');

select pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"$user034"}', false);
set local role authenticated;
select public.create_bog_pending_payment(
  '$user034', 'unissued:$($keys[0])', 'cr-$($keys[0])', '$($keys[0])',
  99, 1,
  pg_catalog.jsonb_build_object(
    'provider', 'bog', 'device_slots', 1, 'package_price', 99,
    'checkout_phase', 'claimed',
    'claim_expires_at', (pg_catalog.statement_timestamp() + interval '50 seconds')::text,
    'client_request_ids', pg_catalog.jsonb_build_array('hosted-seed-$runNoHyphens-1')
  )
);
select public.create_bog_pending_payment(
  '$user034', 'unissued:$($keys[1])', 'cr-$($keys[1])', '$($keys[1])',
  99, 1,
  pg_catalog.jsonb_build_object(
    'provider', 'bog', 'device_slots', 1, 'package_price', 99,
    'checkout_phase', 'claimed',
    'claim_expires_at', (pg_catalog.statement_timestamp() + interval '50 seconds')::text,
    'client_request_ids', pg_catalog.jsonb_build_array('hosted-seed-$runNoHyphens-2')
  )
);
reset role;

select pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"$user032"}', false);
set local role authenticated;
select public.create_bog_pending_payment(
  '$user032', '$payment03299', '$merchant03299', '$($keys[4])',
  99, 1,
  pg_catalog.jsonb_build_object(
    'provider', 'bog', 'device_slots', 1, 'package_price', 99,
    'checkout_url', 'https://payment.bog.ge/order/$payment03299'
  )
);
select public.create_bog_pending_payment(
  '$user032', '$payment032179', '$merchant032179', '$($keys[5])',
  179, 2,
  pg_catalog.jsonb_build_object(
    'provider', 'bog', 'device_slots', 2, 'package_price', 179,
    'checkout_url', 'https://payment.bog.ge/order/$payment032179'
  )
);
reset role;

select pg_catalog.set_config('cityroute.bog_payment_create', 'on', false);
insert into public.payment_transactions (
  user_id, provider, payment_id, merchant_payment_id, amount, currency, status, metadata
)
values (
  '$user035', 'bog', '$payment035', '$merchant035', 99, 'GEL', 'pending',
  pg_catalog.jsonb_build_object(
    'provider', 'bog', 'device_slots', 1, 'package_price', 99,
    'checkout_phase', 'bank_call',
    'bank_call_started_at', pg_catalog.statement_timestamp()::text
  )
);
select pg_catalog.set_config('cityroute.bog_payment_create', 'off', false);
commit;
"@
  Set-Content -LiteralPath $setupFile -Value $setupSql -Encoding ASCII
  if ((Get-Content -LiteralPath $setupFile -Raw) -match '(?i)\bPGPASSWORD\b|(?<![A-Za-z_])password\s*=') {
    throw 'Refusing setup SQL that appears to contain password material.'
  }
  Invoke-PsqlFile -FilePath $setupFile
  $supportSchemaCreated = $true
  # Barrier helpers recreate schema if missing; safe after setup created bog_test_support.
  Invoke-PsqlFile -FilePath $barrierSqlPath

  # Same payment/merchant/amount for both workers: real settlement race on one row.
  $settlementWorkers = @()
  foreach ($actor in @('a', 'b')) {
    $outcomeSql = @"
select pg_catalog.set_config('request.jwt.claim.role', 'cityroute_bog_confirmer', true);
select pg_catalog.set_config('request.jwt.claims', '{"role":"cityroute_bog_confirmer"}', true);
set local role cityroute_bog_confirmer;
do `$race`$
declare
  v_result jsonb;
  v_sqlstate text;
begin
  begin
    v_result := public.update_bog_payment_status(
      '$payment03299', 'success', 'hosted-test-bank',
      pg_catalog.jsonb_build_object(
        'bank_status', 'completed',
        'bank_amount', '99.00',
        'bank_currency', 'GEL',
        'bank_external_order_id', '$merchant03299'
      )
    );
    perform pg_catalog.set_config('bog_test.settlement_outcome', 'success', true);
    perform pg_catalog.set_config('bog_test.settlement_detail', v_result::text, true);
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    perform pg_catalog.set_config('bog_test.settlement_outcome', 'unexpected_' || v_sqlstate, true);
    perform pg_catalog.set_config('bog_test.settlement_detail', '', true);
  end;
end
`$race`$;
reset role;
update bog_test_support.concurrent_results
   set outcome = pg_catalog.current_setting('bog_test.settlement_outcome'),
       detail = nullif(pg_catalog.current_setting('bog_test.settlement_detail'), ''),
       backend_pid = pg_catalog.pg_backend_pid()
 where run_id = '$runId'::uuid and scenario = 'settlement' and actor = '$actor';
"@
    $settlementWorkers += Write-WorkerFile -Scenario 'settlement' -Actor $actor -Body $outcomeSql
  }
  Start-RaceSessions -Scenario 'settlement' -WorkerFiles $settlementWorkers
  Invoke-PsqlFile -FilePath (Join-Path $PSScriptRoot '032_bog_payment_hosted_concurrency.test.sql') -RunId $runId

  $claimWorkers = @()
  foreach ($actor in @('a', 'b')) {
    $keyIndex = if ($actor -eq 'a') { 2 } else { 3 }
    $claimKey = $keys[$keyIndex]
    $outcomeSql = @"
select pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"$user034"}', true);
set local role authenticated;
do `$race`$
declare
  v_sqlstate text;
begin
  begin
    perform public.create_bog_pending_payment(
      '$user034', 'unissued:$claimKey', 'cr-$claimKey', '$claimKey',
      99, 1,
      pg_catalog.jsonb_build_object(
        'provider', 'bog', 'device_slots', 1, 'package_price', 99,
        'checkout_phase', 'claimed',
        'claim_expires_at', (pg_catalog.statement_timestamp() + interval '50 seconds')::text,
        'client_request_ids', pg_catalog.jsonb_build_array('hosted-race-$runNoHyphens-$actor')
      )
    );
    perform pg_catalog.set_config('bog_test.pending_claim_outcome', 'created', true);
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    perform pg_catalog.set_config('bog_test.pending_claim_outcome', case
         when v_sqlstate = 'P0001' then 'limit_rejected'
         else 'unexpected_' || v_sqlstate
       end, true);
  end;
end
`$race`$;
reset role;
update bog_test_support.concurrent_results
   set outcome = pg_catalog.current_setting('bog_test.pending_claim_outcome'),
       backend_pid = pg_catalog.pg_backend_pid()
 where run_id = '$runId'::uuid and scenario = 'pending_claim' and actor = '$actor';
"@
    $claimWorkers += Write-WorkerFile -Scenario 'pending_claim' -Actor $actor -Body $outcomeSql
  }
  Start-RaceSessions -Scenario 'pending_claim' -WorkerFiles $claimWorkers
  Invoke-PsqlFile -FilePath (Join-Path $PSScriptRoot '034_bog_pending_claim_concurrency.test.sql') -RunId $runId

  $leaseWorkers = @()
  foreach ($actor in @('a', 'b')) {
    $outcomeSql = @"
select pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do `$race`$
declare
  v_token uuid;
begin
  v_token := public.acquire_bog_checkout_recovery_lease('$payment035', 180);
  perform pg_catalog.set_config(
    'bog_test.recovery_lease_outcome',
    case when v_token is null then 'already_leased' else 'acquired' end,
    true
  );
end
`$race`$;
reset role;
update bog_test_support.concurrent_results
   set outcome = pg_catalog.current_setting('bog_test.recovery_lease_outcome'),
       backend_pid = pg_catalog.pg_backend_pid()
 where run_id = '$runId'::uuid and scenario = 'recovery_lease' and actor = '$actor';
"@
    $leaseWorkers += Write-WorkerFile -Scenario 'recovery_lease' -Actor $actor -Body $outcomeSql
  }
  Start-RaceSessions -Scenario 'recovery_lease' -WorkerFiles $leaseWorkers
  Invoke-PsqlFile -FilePath (Join-Path $PSScriptRoot '035_bog_checkout_recovery_concurrency.test.sql') -RunId $runId
}
finally {
  if ($supportSchemaCreated) {
    $cleanupSql = @"
drop trigger if exists bog_test_support_record_premium_activation on public.profiles;
delete from public.bog_checkout_recovery_leases where claim_payment_id = '$payment035';
delete from public.payment_transactions where user_id in ('$user032', '$user034', '$user035');
delete from public.profiles where id in ('$user032', '$user034', '$user035');
delete from auth.users where id in ('$user032', '$user034', '$user035');
drop schema if exists bog_test_support cascade;
"@
    Set-Content -LiteralPath $cleanupFile -Value $cleanupSql -Encoding ASCII
    try {
      Invoke-PsqlFile -FilePath $cleanupFile
    }
    catch {
      Write-Error 'Test cleanup failed. Inspect only the generated test user IDs and bog_test_support schema in the disposable test project.'
      throw
    }
  }
  if (Test-Path -LiteralPath $tempDirectory) {
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force
  }
}

Write-Output "Hosted PostgreSQL 17 concurrency tests passed for run $runId."
