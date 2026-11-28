param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string] $PsqlPath,

  [string] $PgHost = '127.0.0.1',
  [string] $PgPort = '55432',
  [string] $PgUser = 'postgres',
  [string] $PgDatabase = 'postgres',
  [string] $PgSslMode = 'disable'
)

$ErrorActionPreference = 'Stop'

foreach ($name in @('PGPASSWORD', 'PGPASSFILE')) {
  if (Get-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue) {
    # Proof uses local trust auth; never inherit hosted secrets into child args/logs.
    Remove-Item -LiteralPath "Env:$name"
  }
}

$env:PGHOST = $PgHost
$env:PGPORT = $PgPort
$env:PGUSER = $PgUser
$env:PGDATABASE = $PgDatabase
$env:PGSSLMODE = $PgSslMode

$tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("bog-barrier-proof-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDirectory | Out-Null
$runId = [guid]::NewGuid().ToString()
$barrierSql = Join-Path $PSScriptRoot 'bog_concurrency_barrier.sql'

function Invoke-Psql {
  param([string[]] $Arguments)
  & $PsqlPath -X --no-password @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed with exit code $LASTEXITCODE"
  }
}

function Start-Worker {
  param(
    [string] $Name,
    [string] $SqlPath
  )
  $stdoutPath = Join-Path $tempDirectory "$Name.out"
  $stderrPath = Join-Path $tempDirectory "$Name.err"
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $PsqlPath
  $quoted = '"' + $SqlPath + '"'
  $startInfo.Arguments = "-X --no-password -v ON_ERROR_STOP=1 -f $quoted"
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['PGHOST'] = $env:PGHOST
  $startInfo.EnvironmentVariables['PGPORT'] = $env:PGPORT
  $startInfo.EnvironmentVariables['PGDATABASE'] = $env:PGDATABASE
  $startInfo.EnvironmentVariables['PGUSER'] = $env:PGUSER
  $startInfo.EnvironmentVariables['PGSSLMODE'] = $env:PGSSLMODE
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Could not start worker $Name"
  }
  return [pscustomobject]@{
    Name = $Name
    Process = $process
    Stdout = $process.StandardOutput.ReadToEndAsync()
    Stderr = $process.StandardError.ReadToEndAsync()
    StdoutPath = $stdoutPath
    StderrPath = $stderrPath
  }
}

function Wait-Workers {
  param(
    [object[]] $Workers,
    [int] $TimeoutSeconds = 45
  )
  $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
  $failures = @()
  foreach ($worker in $Workers) {
    $remaining = [int]([math]::Max(1, ($deadline - [datetime]::UtcNow).TotalMilliseconds))
    if (-not $worker.Process.WaitForExit($remaining)) {
      foreach ($other in $Workers) {
        if (-not $other.Process.HasExited) {
          try { $other.Process.Kill() } catch { }
        }
      }
      $failures += "worker $($worker.Name) timed out"
      break
    }
    if ($worker.Process.ExitCode -ne 0) {
      foreach ($other in $Workers) {
        if (-not $other.Process.HasExited) {
          try { $other.Process.Kill() } catch { }
        }
      }
    }
  }
  foreach ($worker in $Workers) {
    if (-not $worker.Process.HasExited) {
      $worker.Process.WaitForExit(5000) | Out-Null
    }
    $stdout = $worker.Stdout.Result
    $stderr = $worker.Stderr.Result
    if ($stdout) { Set-Content -LiteralPath $worker.StdoutPath -Value $stdout -NoNewline }
    if ($stderr) { Set-Content -LiteralPath $worker.StderrPath -Value $stderr -NoNewline }
    if ($worker.Process.ExitCode -ne 0) {
      $failures += "worker $($worker.Name) exit $($worker.Process.ExitCode): $stderr"
    }
    $worker.Process.Dispose()
  }
  if ($failures.Count -gt 0) {
    throw ($failures -join [Environment]::NewLine)
  }
}

try {
  Invoke-Psql -Arguments @('-v', 'ON_ERROR_STOP=1', '-f', $barrierSql)

  $setupPath = Join-Path $tempDirectory 'setup.sql'
  @'
create table if not exists bog_test_support.barrier_proof (
  run_id uuid not null,
  actor text not null,
  entered_at timestamptz not null,
  left_at timestamptz not null,
  backend_pid integer not null,
  primary key (run_id, actor)
);
truncate bog_test_support.barrier_proof;
'@ | Set-Content -LiteralPath $setupPath -Encoding ASCII
  Invoke-Psql -Arguments @('-v', 'ON_ERROR_STOP=1', '-f', $setupPath)

  # --- Positive: staggered workers still leave barrier within a tight window ---
  foreach ($actor in @('a', 'b')) {
    $delay = if ($actor -eq 'a') { '0.40' } else { '0.05' }
    $sql = @"
begin;
select pg_catalog.pg_sleep($delay);
select bog_test_support.barrier_enter('$runId'::uuid, 'proof_sync', '$actor', 15);
insert into bog_test_support.barrier_proof (run_id, actor, entered_at, left_at, backend_pid)
values (
  '$runId'::uuid,
  '$actor',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp(),
  pg_catalog.pg_backend_pid()
);
-- Both sessions already passed ready+release; brief hold before leave is only for leave-delta measurement.
select pg_catalog.pg_sleep(0.05);
select bog_test_support.barrier_leave('$runId'::uuid, 'proof_sync', '$actor');
update bog_test_support.barrier_proof
   set left_at = pg_catalog.clock_timestamp()
 where run_id = '$runId'::uuid and actor = '$actor';
commit;
"@
    $path = Join-Path $tempDirectory "sync-$actor.sql"
    Set-Content -LiteralPath $path -Value $sql -Encoding ASCII
  }

  $workers = @(
    (Start-Worker -Name 'sync-a' -SqlPath (Join-Path $tempDirectory 'sync-a.sql')),
    (Start-Worker -Name 'sync-b' -SqlPath (Join-Path $tempDirectory 'sync-b.sql'))
  )
  Wait-Workers -Workers $workers -TimeoutSeconds 30

  $assertPath = Join-Path $tempDirectory 'assert-sync.sql'
  @"
do `$assert`$
declare
  v_count integer;
  v_pids integer;
  v_enter_delta interval;
  v_left_delta interval;
begin
  select count(*), count(distinct backend_pid)
    into v_count, v_pids
    from bog_test_support.barrier_proof
   where run_id = '$runId'::uuid;
  if v_count <> 2 or v_pids <> 2 then
    raise exception 'expected two independent barrier sessions, got count=% pids=%', v_count, v_pids;
  end if;

  select max(entered_at) - min(entered_at), max(left_at) - min(left_at)
    into v_enter_delta, v_left_delta
    from bog_test_support.barrier_proof
   where run_id = '$runId'::uuid;

  -- Staggered sleeps were 350ms apart; after barrier, enter timestamps must cluster tightly.
  if v_enter_delta > interval '150 milliseconds' then
    raise exception 'barrier did not synchronize enter timestamps (delta %)', v_enter_delta;
  end if;
  if v_left_delta > interval '200 milliseconds' then
    raise exception 'barrier leave timestamps drifted too far (delta %)', v_left_delta;
  end if;
end
`$assert`$;
select 'barrier_sync_ok' as proof;
"@ | Set-Content -LiteralPath $assertPath -Encoding ASCII
  Invoke-Psql -Arguments @('-v', 'ON_ERROR_STOP=1', '-f', $assertPath)

  # --- Negative: peer absence times out and unlocks ---
  $timeoutPath = Join-Path $tempDirectory 'timeout-a.sql'
  @"
\set ON_ERROR_STOP on
do `$timeout`$
begin
  begin
    perform bog_test_support.barrier_enter('$runId'::uuid, 'proof_timeout', 'a', 2);
    raise exception 'barrier_enter should have timed out without a peer';
  exception
    when others then
      if sqlerrm not like 'Timed out waiting for peer at bog concurrency barrier%' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from pg_catalog.pg_locks l
    where l.locktype = 'advisory'
      and l.classid = bog_test_support.barrier_namespace('$runId'::uuid, 'proof_timeout')
      and l.objid in (1, 2, 3, 4)
      and l.objsubid = 2
      and l.granted
      and l.pid = pg_catalog.pg_backend_pid()
  ) then
    raise exception 'timeout path left a barrier advisory lock held';
  end if;
end
`$timeout`$;
select 'barrier_timeout_ok' as proof;
"@ | Set-Content -LiteralPath $timeoutPath -Encoding ASCII
  Invoke-Psql -Arguments @('-v', 'ON_ERROR_STOP=1', '-f', $timeoutPath)

  # --- Negative contrast: table-row barrier inside an open transaction cannot see peer ---
  $brokenRun = [guid]::NewGuid().ToString()
  $brokenSetup = Join-Path $tempDirectory 'broken-setup.sql'
  @"
create table if not exists bog_test_support.broken_barrier (
  run_id uuid not null,
  actor text not null,
  outcome text not null,
  primary key (run_id, actor)
);
insert into bog_test_support.broken_barrier values
  ('$brokenRun'::uuid, 'a', 'waiting'),
  ('$brokenRun'::uuid, 'b', 'waiting');
"@ | Set-Content -LiteralPath $brokenSetup -Encoding ASCII
  Invoke-Psql -Arguments @('-v', 'ON_ERROR_STOP=1', '-f', $brokenSetup)

  foreach ($actor in @('a', 'b')) {
    $sql = @"
begin;
update bog_test_support.broken_barrier
   set outcome = 'arrived'
 where run_id = '$brokenRun'::uuid and actor = '$actor';
do `$broken`$
declare
  v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '1.5 seconds';
  v_ready integer;
begin
  loop
    select count(*)::integer into v_ready
      from bog_test_support.broken_barrier
     where run_id = '$brokenRun'::uuid and outcome = 'arrived';
    exit when v_ready = 2;
    if pg_catalog.clock_timestamp() >= v_deadline then
      raise exception 'broken_table_barrier_timeout';
    end if;
    perform pg_catalog.pg_sleep(0.05);
  end loop;
end
`$broken`$;
commit;
"@
    Set-Content -LiteralPath (Join-Path $tempDirectory "broken-$actor.sql") -Value $sql -Encoding ASCII
  }

  $brokenWorkers = @(
    (Start-Worker -Name 'broken-a' -SqlPath (Join-Path $tempDirectory 'broken-a.sql')),
    (Start-Worker -Name 'broken-b' -SqlPath (Join-Path $tempDirectory 'broken-b.sql'))
  )
  $brokenFailedAsExpected = $false
  try {
    Wait-Workers -Workers $brokenWorkers -TimeoutSeconds 20
  }
  catch {
    if ("$_" -match 'broken_table_barrier_timeout') {
      $brokenFailedAsExpected = $true
    }
    else {
      throw
    }
  }
  if (-not $brokenFailedAsExpected) {
    throw 'Expected the uncommitted table-row barrier to time out, but both workers succeeded.'
  }

  Write-Output 'Barrier proof passed: advisory lock sync works; uncommitted table-row barrier times out.'
}
finally {
  if (Test-Path -LiteralPath $tempDirectory) {
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
