CREATE OR REPLACE FUNCTION public.strip_rich(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT trim(regexp_replace(coalesce(t, ''), '<[^>]+>', '', 'g'))
$$;