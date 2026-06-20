-- Endereço editável no perfil do cliente.
alter table public.contas_clientes
  add column if not exists cep text,
  add column if not exists numero text,
  add column if not exists complemento text,
  add column if not exists logradouro text,
  add column if not exists bairro text,
  add column if not exists cidade text,
  add column if not exists uf text;
