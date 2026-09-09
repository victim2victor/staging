-- Victim2Victor — contact form submissions
--
-- The site has two public forms (general enquiry + workshop registration).
-- Each maps to one table. All fields are stored as text: the forms are
-- free-text inputs and no field needs numeric/date semantics server-side.
--
-- Security: row-level security is enabled with an INSERT-only policy for the
-- anon (and authenticated) role. There is deliberately NO select/update/delete
-- policy, so the public publishable key can submit rows but cannot read, edit,
-- or delete them. Read submissions in the Supabase dashboard or via the
-- service role.

-- `environment` records which build wrote the row ('staging' or 'production'),
-- stamped at build time (see the Makefile), so staging activity can be viewed
-- or filtered out separately from production.

create table if not exists public.enquiries (
    id          bigint generated always as identity primary key,
    created_at  timestamptz not null default now(),
    environment text not null check (environment in ('staging', 'production')),
    email       text not null,
    subject     text not null,
    message     text not null
);

create table if not exists public.workshop_registrations (
    id          bigint generated always as identity primary key,
    created_at  timestamptz not null default now(),
    environment text not null check (environment in ('staging', 'production')),
    workshop    text not null,
    name        text not null,
    people      text not null,
    email       text not null,
    phone       text not null
);

alter table public.enquiries              enable row level security;
alter table public.workshop_registrations enable row level security;

-- Public forms may INSERT only.
create policy "anon can submit enquiries"
    on public.enquiries
    for insert to anon, authenticated
    with check (true);

create policy "anon can submit workshop registrations"
    on public.workshop_registrations
    for insert to anon, authenticated
    with check (true);
