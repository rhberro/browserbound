-- Create profiles table
create table public.profiles (
  id uuid not null references auth.users on delete cascade,
  display_name text not null,
  created_at timestamp with time zone default now() not null,
  primary key (id)
);

-- Enable RLS
alter table public.profiles enable row level security;

-- Any authenticated user can select all profiles
create policy "Authenticated users can select profiles" on public.profiles
  for select
  to authenticated
  using (true);

-- Users can only insert their own profile
create policy "Users can insert their own profile" on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

-- Users can only update their own profile
create policy "Users can update their own profile" on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Create trigger function to automatically create profile on signup
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Create trigger on auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
