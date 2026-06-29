-- CEP de origem do fornecedor (cotação de frete via Melhor Envio).
alter table public.leads_fornecedores add column if not exists cep text;
