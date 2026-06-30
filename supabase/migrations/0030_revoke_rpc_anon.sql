-- LearnSum MVP — Lock the seeker-read RPCs to signed-in users
-- Migration: 0030_revoke_rpc_anon.sql
-- Apply AFTER 0029. Paste and run the WHOLE file.
--
-- Defense-in-depth for the two SECURITY DEFINER seeker reads. They already refuse
-- anonymous callers internally (they RAISE 'not authenticated'), but Postgres
-- grants EXECUTE to PUBLIC by default, so the raw PostgREST RPC endpoints are
-- reachable (and rejected) by `anon`. Remove that grant so a logged-out caller
-- can't even invoke them. `authenticated` keeps EXECUTE — the app calls these as
-- a signed-in user, and the functions still gate non-tutors / privacy internally.

REVOKE EXECUTE ON FUNCTION public.get_seeker_for_tutor(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_seekers(text, uuid, text, text, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_seeker_for_tutor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_seekers(text, uuid, text, text, integer) TO authenticated;
