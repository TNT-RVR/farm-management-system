-- Last of all: the same clean-up 090_finish.sql does, repeated after the
-- files that load behind it.
--
-- 090_finish.sql clears the change log on the grounds that the build is not
-- anyone's edit, but every farm file numbered above it has written to the log
-- again since. Keeping this one last is what makes
-- `audit_log  # cleared on purpose` in demo/build/empty-ok.txt true. A new
-- farm file goes before it, not after.

delete from public.audit_log;

-- Calls the farm's triggers queued for the outside world while the files above
-- loaded. The demo never sends them, and a snapshot is no place to ship them.
do $$
begin
  if to_regclass('net.http_request_queue') is not null then
    delete from net.http_request_queue;
  end if;
end
$$;
