# Support Chat — SQL tests

132 assertions covering RLS, the RPC write path, Storage policies, admin
protection, the e-mail outbox and Realtime publication.

## Run on a THROW-AWAY plain PostgreSQL (never on production)

```bash
createdb crtest
psql -v ON_ERROR_STOP=1 -d crtest -f supabase/tests/support-chat/00_supabase_stubs.sql   # fake auth/storage pieces
psql -v ON_ERROR_STOP=1 -d crtest -f supabase/migrations/001_initial.sql
psql -v ON_ERROR_STOP=1 -d crtest -f supabase/migrations/009_support_chat_schema.sql
psql -v ON_ERROR_STOP=1 -d crtest -f supabase/migrations/010_support_chat_storage.sql
psql -v ON_ERROR_STOP=1 -d crtest -f supabase/tests/support-chat/01_support_chat_rls_tests.sql
```

Success = exit code 0 and `=== ALL SUPPORT CHAT TESTS PASSED ===`.
The test script runs inside one transaction and rolls back.

`00_supabase_stubs.sql` must NOT be run on a real Supabase project. On the
Supabase local stack (`supabase start`) skip it — those objects already exist.
